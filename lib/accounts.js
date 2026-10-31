'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const KDF = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const COOKIE = 'hotpot_session';
const TTL = 2 * 86400000;
const FREE_LIMIT = 10;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
function dayKey(now = Date.now()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
function equal(a, b) { const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex'); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); }
async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const key = await scrypt(password, salt, 64, KDF);
    return 'scrypt$' + salt + '$' + key.toString('hex');
}
async function verifyPassword(password, encoded) {
    if (/^[a-f0-9]{64}$/.test(encoded || '')) return equal(digest(password), encoded);
    const match = String(encoded || '').match(/^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/);
    const salt = match?.[1] || '00000000000000000000000000000000';
    const key = await scrypt(password, salt, 64, KDF);
    return Boolean(match && equal(key.toString('hex'), match[2]));
}
function validatePassword(password) {
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw failure('密码必须为12至128个字符，不会自动去除空格');
}
function validateIdentity(username, nickname) {
    if (typeof username !== 'string' || !/^[\p{L}\p{N}_.@+\-]{3,64}$/u.test(username.trim())) throw failure('账号需为3至64位字母、数字或 _.@+-，不能含空格');
    if (nickname != null && (typeof nickname !== 'string' || !nickname.trim() || nickname.trim().length > 64)) throw failure('昵称需为1至64个字符');
}

function createStore(filename) {
    let initialized = false;
    // Only this process owns these in-flight operations; restart still refunds interrupted work.
    const activeReservations = new Set();
    function write(db) {
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
        try {
            fs.writeFileSync(temporary, JSON.stringify(db, null, 2), { mode: 0o600, flag: 'wx' });
            fs.renameSync(temporary, filename);
        } catch (err) {
            try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
            throw failure('账号数据写入失败，请检查磁盘权限与容量: ' + err.message, 503);
        }
    }
    function read() {
        let db;
        try { db = JSON.parse(fs.readFileSync(filename, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw failure('账号数据读取失败，已停止写入以保护现有数据', 503); db = { users: [], logs: [], sessions: {} }; }
        if (!Array.isArray(db.users) || !Array.isArray(db.logs) || !db.sessions || typeof db.sessions !== 'object') throw failure('账号数据结构损坏，未创建空库覆盖', 503);
        if (!initialized) {
            initialized = true;
            if (db.authVersion !== 2) {
                if (fs.existsSync(filename)) {
                    const backup = path.join(path.dirname(filename), '.cache', 'account-backups');
                    fs.mkdirSync(backup, { recursive: true });
                    fs.copyFileSync(filename, path.join(backup, 'db-before-auth-v2-' + Date.now() + '.json'), fs.constants.COPYFILE_EXCL);
                }
                for (const user of db.users) if (['mediaAdmin', 'mediaPro', 'demo@hotpot.com'].includes(user.username) && !user.registeredAt) {
                    user.disabled = true; user.disabledReason = '旧演示账号已停用，不能作为真实权限账号';
                }
                db.sessions = {}; db.authVersion = 2; db.authMigratedAt = new Date().toISOString();
                db.reservations = {}; write(db);
            } else if (Object.keys(db.reservations || {}).length) {
                // 本进程重启时旧处理中任务中断，未完成的预占不作为成功使用次数。
                db.reservations = {}; write(db);
            }
            let quarantined=false;
            for(const user of db.users) if(['mediaAdmin','mediaPro','demo@hotpot.com'].includes(user.username) && !user.registeredAt && !user.disabled) {
                user.disabled=true; user.disabledReason='旧演示权限来源无法核验，请使用维护命令建立真实账号';
                for(const [id,session] of Object.entries(db.sessions)) if(session.username===user.username)delete db.sessions[id];
                quarantined=true;
            }
            if(quarantined)write(db);
        }
        db.reservations ||= {};
        const now = Date.now();
        let cleanedStale = false;
        for (const [id, r] of Object.entries(db.reservations)) {
            if (!activeReservations.has(id) && (!r.createdAt || now - r.createdAt > 30 * 60 * 1000)) {
                delete db.reservations[id];
                cleanedStale = true;
            }
        }
        if (cleanedStale) {
            try { write(db); } catch {}
        }
        return db;
    }
    function publicUser(user, db = read()) {
        const date = dayKey(), used = Number(user.usage?.[date] || 0);
        const now = Date.now();
        const pending = Object.entries(db.reservations).filter(([id, r]) => r.username === user.username && r.date === date && (activeReservations.has(id) || now - (r.createdAt || 0) <= 30 * 60 * 1000)).length;
        const normRole = String(user.role || 'user').toLowerCase();
        let limit = FREE_LIMIT;
        let vipTier = 'normal';
        if (['admin', 'supervip', 'super_vip'].includes(normRole)) {
            limit = null; // SuperVIP / Admin 无限处理额度
            vipTier = normRole.includes('admin') ? 'admin' : 'supervip';
        } else if (['pro', 'vip'].includes(normRole)) {
            limit = 100; // VIP 会员单日 100 次高额度
            vipTier = 'vip';
        }
        return { username: user.username, nickname: user.nickname || user.username, role: user.role || 'user',
            avatar: user.avatar || '/avatar-placeholder.svg', vipTier, registeredAt: user.registeredAt || null,
            quota: { date, timeZone: 'Asia/Shanghai', used, pending, limit, remaining: limit === null ? null : Math.max(0, limit - used - pending) },
            remaining: limit === null ? null : Math.max(0, limit - used - pending) };
    }
    async function register(input, role = 'user', resetDisabled = false) {
        validateIdentity(input.username, input.nickname); validatePassword(input.password);
        const username = input.username.trim(), password = await hashPassword(input.password);
        const db = read(), old = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (old && !(resetDisabled && old.disabled)) throw failure('该账号已存在，请登录或更换账号', 409);
        const user = { username, password, role, nickname: input.nickname?.trim() || username, avatar: '/avatar-placeholder.svg', registeredAt: new Date().toISOString(), usage: {} };
        if (old) Object.assign(old, user, { disabled: false, disabledReason: undefined }); else db.users.push(user);
        write(db); return publicUser(user, db);
    }
    async function login(username, password) {
        if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 128) throw failure('账号或密码格式错误');
        const user = read().users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
        const valid = await verifyPassword(password, user?.disabled ? '' : user?.password);
        if (!user || user.disabled || !valid) throw failure('账号或密码错误，旧演示账号不能登录', 401);
        if (!user.password.startsWith('scrypt$')) {
            const secure = await hashPassword(password), db = read();
            db.users.find(u => u.username === user.username).password = secure; write(db);
        }
        return publicUser(read().users.find(u => u.username === user.username));
    }
    function issue(username) {
        const db = read(), user = db.users.find(u => u.username === username && !u.disabled);
        if (!user) throw failure('账号不可用', 401);
        for (const [id, session] of Object.entries(db.sessions)) if (session.expireAt <= Date.now()) delete db.sessions[id];
        const token = crypto.randomBytes(32).toString('hex'), expireAt = Date.now() + TTL;
        db.sessions[digest(token)] = { username, expireAt }; write(db);
        return { token, expireAt, user: publicUser(user, db) };
    }
    function identify(token) {
        if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
        const db = read(), session = db.sessions[digest(token)];
        if (!session || session.expireAt <= Date.now()) return null;
        const user = db.users.find(u => u.username === session.username && !u.disabled);
        return user ? publicUser(user, db) : null;
    }
    function logout(token) { const db = read(); delete db.sessions[digest(token || '')]; write(db); }
    function revoke(username) { const db = read(); for (const [id, session] of Object.entries(db.sessions)) if (session.username === username) delete db.sessions[id]; write(db); }
    function reserve(username, action) {
        const db = read(), user = db.users.find(u => u.username === username && !u.disabled);
        if (!user) throw failure('需要真实登录账号', 401);
        const quota = publicUser(user, db).quota;
        if (quota.limit !== null && quota.remaining <= 0) throw failure('今日处理额度已用完（普通用户每日10次，按上海时区每日重置）', 429);
        const id = crypto.randomUUID(); db.reservations[id] = { username, date: quota.date, action, createdAt: Date.now() }; write(db); activeReservations.add(id); return id;
    }
    function settle(id, success) {
        const db = read(), r = db.reservations[id]; if (!r) { activeReservations.delete(id); return; }
        if (success) { const user = db.users.find(u => u.username === r.username); if (user) { user.usage ||= {}; user.usage[r.date] = (user.usage[r.date] || 0) + 1; } }
        delete db.reservations[id]; write(db); activeReservations.delete(id);
    }
    function log(username, event) {
        const db = read();
        db.logs.push({ ...event, id: crypto.randomUUID(), username, eventVersion: 2, timestamp: Date.now() });
        if (event.kind === 'parse' && event.status === 'parsed') {
            db.statistics ||= {};
            const day = db.statistics[dayKey()] ||= { totalCount: 0, platforms: {} };
            day.totalCount++; const platform = event.platform || 'other'; day.platforms[platform] = (day.platforms[platform] || 0) + 1;
        }
        const mine = db.logs.filter(item => item.username === username && item.eventVersion === 2);
        const remove = new Set(mine.slice(0, Math.max(0, mine.length - 500)).map(item => item.id));
        db.logs = db.logs.filter(item => !remove.has(item.id)); write(db);
    }
    function history(username) { return read().logs.filter(e => e.username === username && e.eventVersion === 2).sort((a, b) => b.timestamp - a.timestamp); }
    function statistics() { const date = dayKey(), saved = read().statistics?.[date]; return { success: true, date, timeZone: 'Asia/Shanghai', totalCount: saved?.totalCount || 0, platforms: saved?.platforms || {}, basis: '服务端已成功解析记录，跨重启保存' }; }
    function clearHistory(username, id) { const db = read(); db.logs = db.logs.filter(e => !(e.username === username && e.eventVersion === 2 && (!id || e.id === id))); write(db); }
    function profile(username, nickname) {
        validateIdentity(username, nickname); const db = read(), user = db.users.find(u => u.username === username && !u.disabled);
        if (!user) throw failure('账号不可用', 401); user.nickname = nickname.trim(); write(db); return publicUser(user, db);
    }
    async function changePassword(username, current, password) {
        validatePassword(password); if (typeof current !== 'string' || current.length > 128) throw failure('当前密码格式错误');
        const user = read().users.find(u => u.username === username && !u.disabled);
        if (!user || !await verifyPassword(current, user.password)) throw failure('当前密码错误', 403);
        const encoded = await hashPassword(password), db = read(); db.users.find(u => u.username === username).password = encoded;
        for (const [id, session] of Object.entries(db.sessions)) if (session.username === username) delete db.sessions[id];
        write(db); return issue(username);
    }
    
    function updateUser(username, fields = {}) {
        const db = read();
        const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (!user) return null;
        if (fields.role !== undefined) user.role = fields.role;
        if (fields.nickname !== undefined) user.nickname = String(fields.nickname).trim();
        if (fields.avatar !== undefined) user.avatar = fields.avatar;
        if (fields.badgeMetadata !== undefined) user.badgeMetadata = fields.badgeMetadata;
        write(db);
        return publicUser(user, db);
    }
    read();
    return { register, login, updateUser, issue, identify, logout, revoke, reserve, settle, log, history, clearHistory, profile, changePassword, read, publicUser, statistics };
}

const privateDatabase = process.env.HOTPOT_DB_FILE || path.join(__dirname, '..', '.runtime', 'data', 'accounts.json');
const legacyDatabase = path.join(__dirname, '..', 'db.json');
if (!process.env.HOTPOT_DB_FILE && !fs.existsSync(privateDatabase) && fs.existsSync(legacyDatabase)) {
    fs.mkdirSync(path.dirname(privateDatabase), { recursive: true });
    fs.copyFileSync(legacyDatabase, privateDatabase, fs.constants.COPYFILE_EXCL);
}
const store = createStore(privateDatabase);
function getToken(req) {
    const bearer = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/);
    if (bearer) return bearer[1];
    const cookie = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(COOKIE + '='));
    return cookie ? cookie.slice(COOKIE.length + 1) : '';
}
function auth(req, res, next) {
    try {
        req.token = getToken(req); req.user = store.identify(req.token);
        if (!req.user) return res.status(401).json({ success: false, error: 'AUTH_REQUIRED', message: '请注册或登录真实账号后使用媒体处理与历史功能' });
        res.setHeader('Cache-Control','private, no-store'); next();
    } catch (error) { res.status(error.status || 503).json({ success: false, message: error.message }); }
}
function admin(req, res, next) { return req.user?.role === 'admin' ? next() : res.status(403).json({ success: false, message: '此操作仅限真实管理员' }); }
function sameOrigin(req, res, next) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    try {
        if (req.headers['sec-fetch-site'] === 'cross-site' || req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw failure('拒绝跨站修改请求', 403);
        next();
    } catch { res.status(403).json({ success: false, message: '拒绝跨站修改请求' }); }
}
function sessionResponse(req, res, session) {
    res.cookie(COOKIE, session.token, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/', maxAge: TTL });
    res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, expireAt: session.expireAt, user: session.user });
}
function mount(app) {
    const attempts = new Map();
    function rateLimit(req, res, next) {
        const key = req.ip, now = Date.now(), old = attempts.get(key);
        const entry = old && old.until > now ? old : { count: 0, until: now + 600000 };
        entry.count++; attempts.set(key, entry);
        if (attempts.size > 1000) for (const [id, value] of attempts) if (value.until <= now) attempts.delete(id);
        if (entry.count > 20) return res.status(429).json({ success: false, message: '登录/注册尝试过于频繁，请10分钟后重试' });
        next();
    }
    const route = worker => async (req, res) => { try { await worker(req, res); } catch (error) { res.status(error.status || 500).json({ success: false, message: error.status ? error.message : '账号操作失败，未假报成功' }); } };
    app.post('/api/auth/demo-login', (req, res) => res.status(410).json({ success: false, message: '演示身份与管理员切换已移除，请注册或登录真实账号' }));
    app.post('/api/auth/register', rateLimit, route(async (req, res) => { const user = await store.register(req.body || {}); sessionResponse(req, res, store.issue(user.username)); }));
    app.post('/api/auth/login', rateLimit, route(async (req, res) => {
        const user = await store.login(req.body?.username, req.body?.password);
        store.log(user.username, {
            kind: 'login',
            status: 'success',
            source: 'local_password',
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
            userAgent: req.headers['user-agent']
        });
        sessionResponse(req, res, store.issue(user.username));
    }));
    app.get('/api/auth/me', auth, (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, user: req.user }); });
    app.post('/api/auth/logout', route((req, res) => { store.logout(getToken(req)); res.clearCookie(COOKIE, { path: '/', httpOnly: true, sameSite: 'strict', secure: req.secure }); res.json({ success: true }); }));
    app.patch('/api/account/profile', auth, route((req, res) => res.json({ success: true, user: store.profile(req.user.username, req.body?.nickname) })));
    app.post('/api/account/password', auth, route(async (req, res) => sessionResponse(req, res, await store.changePassword(req.user.username, req.body?.currentPassword, req.body?.password))));
    app.get('/api/account/history', auth, (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ success: true, list: store.history(req.user.username) }); });
    app.delete('/api/account/history/:id?', auth, route((req, res) => { store.clearHistory(req.user.username, req.params.id); res.json({ success: true }); }));
}

module.exports = { store, createStore, auth, admin, sameOrigin, mount, dayKey, hashPassword, verifyPassword, FREE_LIMIT, SESSION_COOKIE: COOKIE, sessionResponse, optionalUser:req=>store.identify(getToken(req)) };
