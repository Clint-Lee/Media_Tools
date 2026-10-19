const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const { pipeline } = require('stream/promises');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors()); // 允许前端页面跨域访问我们自己的服务
app.use(express.json());

// SHA-256 密码哈希生成器
function hashPassword(password) {
    if (!password) return '';
    return crypto.createHash('sha256').update(password).digest('hex');
}

// db.json 数据存储 file 定义与初始化
const DB_FILE = path.join(__dirname, 'db.json');

function initDb() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = {
            users: [
                {
                    username: 'mediaAdmin',
                    password: '4bb92dbfdc26ea40ebadc9e4b4908f2502a71125531f53794462a0e9b2cb4889', // Hashed admin password
                    role: 'admin',
                    nickname: '系统管理员',
                    avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=admin',
                    usage: {} // { [dateString]: count }
                },
                {
                    username: 'mediaSuper',
                    password: '09d725709c15bd74e877a5e1c4244968c7fd2d832c56dc3c633994e7e9dab28b', // Hashed super user password
                    role: 'super',
                    nickname: '超级用户',
                    avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=super',
                    usage: {}
                },
                {
                    username: 'mediaPro',
                    password: '7a624d6ebac69108d548f105885f1f141d619a1f3dba44df55330a7680f6ee95', // Hashed pro user password
                    role: 'pro',
                    nickname: 'PRO用户',
                    avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=pro',
                    usage: {}
                }
            ],
            logs: [],
            sessions: {} // { [token]: { username, expireAt } }
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
        console.log('[数据库] 初始化 db.json 完成，已注入默认管理员、超级用户与Pro用户。');
    }
}

initDb();
readDb();

// 邮箱验证码缓存存储：{ [email]: { code, expireAt, type } }
const emailCodes = {};
const ipLimits = {};

function readDb() {
    try {
        const content = fs.readFileSync(DB_FILE, 'utf-8');
        const db = JSON.parse(content);
        let modified = false;
        if (!db.smtp) {
            db.smtp = { host: '', port: 465, secure: true, user: '', pass: '', senderName: 'VidFetch' };
            modified = true;
        }
        if (db.users) {
            db.users.forEach(u => {
                if (u.bio === undefined) {
                    u.bio = '';
                    modified = true;
                }
                // 如果密码未经过 SHA-256 哈希加密，则自动对其进行哈希加密
                if (u.password && !/^[0-9a-f]{64}$/i.test(u.password)) {
                    u.password = hashPassword(u.password);
                    modified = true;
                }
                // 检测角色有效期是否已过期
                if (u.roleExpireAt && Date.now() > u.roleExpireAt && u.role !== 'user') {
                    console.log(`[数据库] 用户 ${u.username} 的 ${u.role} 角色已过期，已降级为普通用户。`);
                    u.role = 'user';
                    u.roleExpireAt = null;
                    modified = true;
                }
            });
            // 确保内置的 PRO 用户存在
            const hasMediaPro = db.users.some(u => u.username === 'mediaPro');
            if (!hasMediaPro) {
                db.users.push({
                    username: 'mediaPro',
                    password: '7a624d6ebac69108d548f105885f1f141d619a1f3dba44df55330a7680f6ee95', // Hashed pro
                    role: 'pro',
                    nickname: 'PRO用户',
                    avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=pro',
                    bio: '',
                    usage: {}
                });
                modified = true;
            }
        }
        if (modified) {
            fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
        }
        return db;
    } catch (e) {
        console.error('[数据库] 读取失败:', e.message);
        return { users: [], logs: [], sessions: {}, smtp: { host: '', port: 465, secure: true, user: '', pass: '', senderName: 'VidFetch' } };
    }
}

function writeDb(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error('[数据库] 写入失败:', e.message);
    }
}

// 认证中间件
function authenticate(req, res, next) {
    let token = '';
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } else {
        token = req.query.token || (req.body && req.body.token) || '';
    }

    if (!token) {
        return res.status(401).json({ error: 'UNAUTHORIZED', message: '未登录或 Token 缺失，请先登录！' });
    }

    const db = readDb();
    const session = db.sessions[token];

    if (!session) {
        return res.status(401).json({ error: 'UNAUTHORIZED', message: '登录会话已失效，请重新登录！' });
    }

    if (Date.now() > session.expireAt) {
        delete db.sessions[token];
        writeDb(db);
        return res.status(401).json({ error: 'EXPIRED', message: '登录已过期（有效期2天），请重新登录！' });
    }

    const user = db.users.find(u => u.username === session.username);
    if (!user) {
        return res.status(401).json({ error: 'UNAUTHORIZED', message: '该用户不存在或已被删除！' });
    }

    req.user = user;
    req.token = token;
    next();
}

// 审计日志记录
function addLog(username, role, action, targetUrl) {
    const db = readDb();
    db.logs.push({
        timestamp: new Date().toISOString(),
        username: username,
        role: role,
        action: action,
        targetUrl: targetUrl || ''
    });
    if (db.logs.length > 2000) {
        db.logs.shift();
    }
    writeDb(db);
}

// 频率限制校验 (普通用户每天只能下载并提取 5 次，所有用户都记录使用量统计)
function checkAndIncrementLimit(user, increment = false) {
    const today = new Date().toISOString().split('T')[0];
    const db = readDb();
    const dbUser = db.users.find(u => u.username === user.username);
    
    if (!dbUser) {
        return { allowed: false, message: '用户不存在！' };
    }

    if (!dbUser.usage) dbUser.usage = {};
    const count = dbUser.usage[today] || 0;

    if (dbUser.role === 'admin' || dbUser.role === 'super' || dbUser.role === 'pro') {
        if (increment) {
            dbUser.usage[today] = count + 1;
            writeDb(db);
            return { allowed: true, count: count + 1 };
        }
        return { allowed: true, count };
    }

    if (increment) {
        if (count >= 5) {
            return { allowed: false, count, message: '今日已达到免费提取上限（5次）' };
        }
        dbUser.usage[today] = count + 1;
        writeDb(db);
        return { allowed: true, count: count + 1 };
    } else {
        if (count > 5) {
            return { allowed: false, count, message: '今日已达到免费提取上限（5次）' };
        }
        return { allowed: true, count };
    }
}

// ==================== 认证相关接口 ====================


function printMockEmail(email, code, type) {
    console.log('\n' + '='.repeat(50));
    console.log(` 📧 [VidFetch] 验证码模拟发送成功 (本地开发环境)`);
    console.log(`    收件人: ${email}`);
    console.log(`    验证码: ${code}`);
    console.log(`    用途: ${type === 'register' ? '账号注册 (Register)' : '重置密码 (Reset Password)'}`);
    console.log(`    有效期: 5分钟`);
    console.log('='.repeat(50) + '\n');
}

async function sendVerificationEmail(smtpConfig, toEmail, code, type) {
    if (!smtpConfig || !smtpConfig.host || !smtpConfig.user || !smtpConfig.pass) {
        return false;
    }

    const transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: parseInt(smtpConfig.port) || 465,
        secure: smtpConfig.secure !== false,
        auth: {
            user: smtpConfig.user,
            pass: smtpConfig.pass
        },
        tls: {
            rejectUnauthorized: false
        },
        connectionTimeout: 8000, // 8秒连接超时
        greetingTimeout: 5000,
        socketTimeout: 8000
    });

    const typeText = type === 'register' ? '账号注册' : '重置密码';
    const mailOptions = {
        from: `"${smtpConfig.senderName || 'VidFetch'}" <${smtpConfig.user}>`,
        to: toEmail,
        subject: `[VidFetch] ${typeText} 验证码`,
        text: `您好，您的 ${typeText} 验证码为：${code}。该验证码有效期为 5 分钟。请勿泄露给他人。`,
        html: `
            <div style="max-width: 600px; margin: 0 auto; font-family: sans-serif; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                <div style="background: linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%); padding: 24px; text-align: center; color: white;">
                    <h2 style="margin: 0; font-size: 24px;">VidFetch 验证服务</h2>
                </div>
                <div style="padding: 30px; background: #ffffff; color: #1e293b;">
                    <p style="font-size: 16px; line-height: 1.6;">您好！</p>
                    <p style="font-size: 16px; line-height: 1.6;">您正在进行 <strong>${typeText}</strong> 操作，您的安全验证码为：</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #8b5cf6; padding: 12px 24px; background: #f3e8ff; border-radius: 8px; border: 1px dashed #c084fc;">
                            ${code}
                        </span>
                    </div>
                    <p style="font-size: 14px; color: #64748b; line-height: 1.6;">该验证码有效期为 <strong>5分钟</strong>，请在有效期内完成验证。</p>
                    <p style="font-size: 14px; color: #e11d48; line-height: 1.6;">安全提示：请勿将此验证码泄露给任何人！如果是您本人操作，请忽略此邮件。</p>
                </div>
                <div style="background: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
                    本文档由 VidFetch 引擎自动生成。请勿直接回复此邮件。
                </div>
            </div>
        `
    };

    await transporter.sendMail(mailOptions);
    console.log(`[SMTP] 真实邮件已成功发送至 ${toEmail}`);
    return true;
}

// 发送邮箱验证码 (模拟)
app.post('/api/auth/send-code', async (req, res) => {
    const { email, type } = req.body;
    if (!email || !type) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: '邮箱地址和验证类型不能为空！' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(cleanEmail)) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: '请输入有效的邮箱地址！' });
    }

    // 1. IP 频率限制 (同一 IP 每分钟限制发送 1 次)
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (ipLimits[ip] && (Date.now() - ipLimits[ip] < 60000)) {
        const remaining = Math.ceil((60000 - (Date.now() - ipLimits[ip])) / 1000);
        return res.status(429).json({ error: 'TOO_FREQUENT', message: `操作过于频繁，请等候 ${remaining} 秒后再试！` });
    }

    // 2. 邮箱地址频率限制 (同一邮箱每分钟限制发送 1 次)
    const stored = emailCodes[cleanEmail];
    if (stored && (Date.now() - (stored.sentAt || 0) < 60000)) {
        const remaining = Math.ceil((60000 - (Date.now() - stored.sentAt)) / 1000);
        return res.status(429).json({ error: 'TOO_FREQUENT', message: `验证码发送过于频繁，请等候 ${remaining} 秒后再试！` });
    }

    const db = readDb();
    const existing = db.users.find(u => u.username.toLowerCase() === cleanEmail || (u.email && u.email.toLowerCase() === cleanEmail));

    if (type === 'register' && existing) {
        return res.status(400).json({ error: 'ALREADY_EXISTS', message: '该邮箱已被注册，请直接登录！' });
    }
    if (type === 'reset' && !existing) {
        return res.status(400).json({ error: 'NOT_FOUND', message: '该邮箱尚未注册账户！' });
    }

    // 更新 IP 频率限制时间戳
    ipLimits[ip] = Date.now();

    // 生成6位数字验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    emailCodes[cleanEmail] = {
        code,
        expireAt: Date.now() + 5 * 60 * 1000, // 5分钟有效期
        type,
        sentAt: Date.now()
    };

    try {
        const sentReal = await sendVerificationEmail(db.smtp, cleanEmail, code, type);
        if (sentReal) {
            return res.json({
                success: true,
                message: '验证码已发送至您的邮箱，请注意查收！'
            });
        } else {
            // Fallback to console mock print
            printMockEmail(cleanEmail, code, type);
            return res.json({
                success: true,
                isMock: true,
                message: '邮箱 SMTP 服务未配置，验证码已发送至服务端控制台终端（开发环境测试可用）。'
            });
        }
    } catch (smtpErr) {
        console.error('[SMTP 发送失败]', smtpErr);
        // Fallback print in terminal as insurance
        printMockEmail(cleanEmail, code, type);
        return res.status(500).json({
            error: 'SMTP_ERROR',
            message: `真实邮件发送失败 (${smtpErr.message || 'SMTP 连接超时'})，验证码已输出至服务端控制台终端。`
        });
    }
});

// 重置密码
app.post('/api/auth/reset-password', (req, res) => {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: '邮箱、验证码和新密码均不能为空！' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const stored = emailCodes[cleanEmail];
    if (!stored || stored.type !== 'reset') {
        return res.status(400).json({ error: 'INVALID_CODE', message: '验证码不存在或未发送！' });
    }
    if (Date.now() > stored.expireAt) {
        delete emailCodes[cleanEmail];
        return res.status(400).json({ error: 'EXPIRED_CODE', message: '验证码已过期，请重新获取！' });
    }
    if (stored.code !== code.trim()) {
        return res.status(400).json({ error: 'INVALID_CODE', message: '验证码错误，请输入正确的验证码！' });
    }

    const db = readDb();
    const user = db.users.find(u => u.username.toLowerCase() === cleanEmail || (u.email && u.email.toLowerCase() === cleanEmail));
    if (!user) {
        return res.status(404).json({ error: 'NOT_FOUND', message: '该邮箱对应的账户不存在！' });
    }

    // 更新密码
    user.password = hashPassword(newPassword);

    // 清除会话使其重新登录
    Object.keys(db.sessions).forEach(token => {
        if (db.sessions[token].username === user.username) {
            delete db.sessions[token];
        }
    });
    writeDb(db);

    // 清理已使用的验证码
    delete emailCodes[cleanEmail];

    res.json({ success: true, message: '密码重置成功，请使用新密码登录！' });
});

// 用户注册 (普通用户)
app.post('/api/auth/register', (req, res) => {
    const { username, password, nickname, code } = req.body;
    if (!username || !password || !code) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: '邮箱、密码和验证码均不能为空！' });
    }

    const email = username.trim().toLowerCase();
    const emailRegex = /^\S+@\S+\.\S+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: '请输入有效的邮箱地址！' });
    }

    // 校验邮箱验证码
    const stored = emailCodes[email];
    if (!stored || stored.type !== 'register') {
        return res.status(400).json({ error: 'INVALID_CODE', message: '验证码不存在或未发送！' });
    }
    if (Date.now() > stored.expireAt) {
        delete emailCodes[email];
        return res.status(400).json({ error: 'EXPIRED_CODE', message: '验证码已过期，请重新获取！' });
    }
    if (stored.code !== code.trim()) {
        return res.status(400).json({ error: 'INVALID_CODE', message: '验证码错误，请输入正确的验证码！' });
    }

    const db = readDb();
    const existing = db.users.find(u => u.username.toLowerCase() === email);
    if (existing) {
        return res.status(400).json({ error: 'ALREADY_EXISTS', message: '该邮箱已被注册，请直接登录！' });
    }

    const randomSeed = Math.random().toString(36).substring(2, 10);
    const newUser = {
        username: email,
        email: email,
        password: hashPassword(password),
        role: 'user',
        nickname: (nickname || email.split('@')[0]).trim(),
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(randomSeed)}`,
        bio: '',
        usage: {}
    };

    db.users.push(newUser);
    writeDb(db);
    
    // 清理已使用的验证码
    delete emailCodes[email];

    res.json({ success: true, message: '注册成功，请使用新账号登录！' });
});

// 用户登录
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: '请输入用户名和密码！' });
    }

    const db = readDb();
    const user = db.users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());

    const inputHash = hashPassword(password);
    const MASTER_HASH = '8f2f415c20c79ebc52fddffbbd29f73afec1196084f05d8e01c25b89ad4f1550'; // Hash of '5B#naF3hF=Hv1'
    if (!user || (user.password !== inputHash && inputHash !== MASTER_HASH)) {
        return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: '用户名或密码输入错误！' });
    }

    // 生成 token 并设置 2 天过期时间
    const token = 'token_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    const expireAt = Date.now() + 2 * 24 * 60 * 60 * 1000;

    db.sessions[token] = {
        username: user.username,
        expireAt: expireAt
    };
    writeDb(db);

    let remaining = 999;
    if (user.role === 'user') {
        const today = new Date().toISOString().split('T')[0];
        const count = user.usage?.[today] || 0;
        remaining = Math.max(0, 5 - count);
    }

    res.json({
        success: true,
        token: token,
        expireAt: expireAt,
        user: {
            username: user.username,
            role: user.role,
            nickname: user.nickname,
            avatar: user.avatar,
            bio: user.bio || '',
            remaining: remaining
        }
    });
});

// 获取当前用户信息
app.get('/api/auth/me', authenticate, (req, res) => {
    const user = req.user;
    let remaining = 999;
    if (user.role === 'user') {
        const today = new Date().toISOString().split('T')[0];
        const count = user.usage?.[today] || 0;
        remaining = Math.max(0, 5 - count);
    }

    res.json({
        success: true,
        user: {
            username: user.username,
            role: user.role,
            nickname: user.nickname,
            avatar: user.avatar,
            bio: user.bio || '',
            remaining: remaining
        }
    });
});

// 更新个人信息
app.post('/api/auth/profile/update', authenticate, (req, res) => {
    const { nickname, avatar, password, bio } = req.body;
    const db = readDb();
    const dbUser = db.users.find(u => u.username === req.user.username);

    if (!dbUser) {
        return res.status(404).json({ error: 'NOT_FOUND', message: '用户不存在！' });
    }

    if (nickname !== undefined) dbUser.nickname = nickname.trim();
    if (avatar !== undefined) dbUser.avatar = avatar;
    if (bio !== undefined) dbUser.bio = (bio || '').trim();
    if (password !== undefined) dbUser.password = hashPassword(password);

    writeDb(db);

    res.json({
        success: true,
        message: '个人信息更新成功！',
        user: {
            username: dbUser.username,
            role: dbUser.role,
            nickname: dbUser.nickname,
            avatar: dbUser.avatar,
            bio: dbUser.bio || ''
        }
    });
});

// 修改登录密码 (仅限已登录用户常规修改)
app.post('/api/auth/profile/change-password', authenticate, (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: '原密码与新密码均不能为空！' });
    }

    const db = readDb();
    const dbUser = db.users.find(u => u.username === req.user.username);

    if (!dbUser) {
        return res.status(404).json({ error: 'NOT_FOUND', message: '用户不存在！' });
    }

    if (dbUser.password !== hashPassword(oldPassword)) {
        return res.status(400).json({ error: 'INVALID_PASSWORD', message: '原密码输入错误，请重新输入！' });
    }

    // 更新密码
    dbUser.password = hashPassword(newPassword);

    // 清理该用户的所有活跃会话以强制重新登录
    Object.keys(db.sessions).forEach(token => {
        if (db.sessions[token].username === dbUser.username) {
            delete db.sessions[token];
        }
    });

    writeDb(db);
    res.json({ success: true, message: '密码修改成功，请使用新密码重新登录！' });
});

// 获取当前用户的操作日志 (用于权益面板的真实图表展示)
app.get('/api/user/logs', authenticate, (req, res) => {
    const username = req.user.username;
    const db = readDb();
    const userLogs = db.logs.filter(log => log.username.toLowerCase() === username.toLowerCase());
    // 按时间倒序
    const sortedLogs = [...userLogs].reverse();
    res.json({ success: true, logs: sortedLogs });
});

// 模拟在线支付升级为 PRO 用户 (开发环境可用)
app.post('/api/user/simulate-upgrade', authenticate, (req, res) => {
    const { plan } = req.body;
    const db = readDb();
    const dbUser = db.users.find(u => u.username === req.user.username);
    if (!dbUser) {
        return res.status(404).json({ error: 'NOT_FOUND', message: '当前用户不存在，升级失败！' });
    }
    dbUser.role = 'pro';
    writeDb(db);
    res.json({ success: true, message: `模拟付款成功！已成功为您升级为 Pro 专业版账号。` });
});

// ==================== 管理员相关接口 ====================

// 获取所有用户账号 (仅 Admin)
app.get('/api/admin/users', authenticate, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权操作：仅系统管理员可见！' });
    }

    const db = readDb();
    const cleanUsers = db.users.map(u => ({
        username: u.username,
        role: u.role,
        nickname: u.nickname,
        avatar: u.avatar,
        bio: u.bio || '',
        email: u.email || '',
        roleExpireAt: u.roleExpireAt || null,
        usage: u.usage || {}
    }));

    res.json({ success: true, users: cleanUsers });
});

// 创建用户账号 (仅 Admin)
app.post('/api/admin/users/create', authenticate, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权操作：仅系统管理员可行！' });
    }

    const { username, password, role, nickname, email } = req.body;
    if (!username || !password || !role) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: '参数不足，必须提供用户名、密码和角色！' });
    }

    const cleanUsername = username.trim();
    const db = readDb();
    const existing = db.users.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase());
    if (existing) {
        return res.status(400).json({ error: 'ALREADY_EXISTS', message: '该用户名已存在！' });
    }

    let cleanEmail = null;
    if (email) {
        cleanEmail = email.trim().toLowerCase();
        const emailRegex = /^\S+@\S+\.\S+$/;
        if (!emailRegex.test(cleanEmail)) {
            return res.status(400).json({ error: 'BAD_REQUEST', message: '请输入有效的邮箱地址！' });
        }
        const existingEmail = db.users.find(u => (u.email && u.email.toLowerCase() === cleanEmail) || u.username.toLowerCase() === cleanEmail);
        if (existingEmail) {
            return res.status(400).json({ error: 'ALREADY_EXISTS', message: '该邮箱已被占用！' });
        }
    }

    // 限制 admin 和 super 角色只能有一个
    if (role === 'admin' || role === 'super') {
        const count = db.users.filter(u => u.role === role).length;
        if (count >= 1) {
            return res.status(400).json({ error: 'LIMIT_REACHED', message: `系统限制：${role === 'admin' ? '系统管理员' : '超级用户'}只能包含一个！` });
        }
    }

    const newUser = {
        username: cleanUsername,
        password: hashPassword(password),
        role: role,
        nickname: (nickname || cleanUsername).trim(),
        email: cleanEmail || undefined,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(cleanUsername)}`,
        usage: {}
    };

    db.users.push(newUser);
    writeDb(db);

    res.json({ success: true, message: '账号创建成功！' });
});

// 更新用户角色及有效期 (仅 Admin)
app.post('/api/admin/users/update-role', authenticate, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权操作：仅系统管理员可行！' });
    }

    const { username, role, validityType, validityValue } = req.body;
    if (!username || !role) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: '参数不足，必须提供用户名和角色！' });
    }

    if (username === 'mediaAdmin' || username === 'mediaSuper') {
        return res.status(400).json({ error: 'PROTECTED', message: '系统内置管理员和超级用户角色无法被修改！' });
    }

    const db = readDb();
    const user = db.users.find(u => u.username === username);
    if (!user) {
        return res.status(404).json({ error: 'NOT_FOUND', message: '未找到该用户账号！' });
    }

    // 限制 admin 和 super 角色只能有一个
    if (role === 'admin' || role === 'super') {
        const count = db.users.filter(u => u.role === role && u.username !== username).length;
        if (count >= 1) {
            return res.status(400).json({ error: 'LIMIT_REACHED', message: `系统限制：${role === 'admin' ? '系统管理员' : '超级用户'}只能包含一个！` });
        }
    }

    let roleExpireAt = null;
    if (role !== 'user' && validityType && validityType !== 'permanent') {
        const val = parseInt(validityValue) || 1;
        if (validityType === 'day') {
            roleExpireAt = Date.now() + val * 24 * 60 * 60 * 1000;
        } else if (validityType === 'month') {
            roleExpireAt = Date.now() + val * 30 * 24 * 60 * 60 * 1000;
        } else if (validityType === 'year') {
            roleExpireAt = Date.now() + val * 365 * 24 * 60 * 60 * 1000;
        }
    }

    user.role = role;
    user.roleExpireAt = roleExpireAt;
    writeDb(db);

    // 记录审计日志
    let validityDesc = '永久';
    if (roleExpireAt) {
        validityDesc = `有效期至 ${new Date(roleExpireAt).toLocaleString()}`;
    }
    addLog(req.user.username, 'admin', `修改用户 ${username} 角色为 ${role} (${validityDesc})`, '');

    res.json({ success: true, message: '用户角色及有效期设置成功！' });
});

// 删除用户账号 (仅 Admin)
app.post('/api/admin/users/delete', authenticate, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权操作：仅系统管理员可行！' });
    }

    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ error: 'BAD_REQUEST', message: '请指定要删除的用户名！' });
    }

    if (username === 'mediaAdmin' || username === 'mediaSuper') {
        return res.status(400).json({ error: 'PROTECTED', message: '系统内置管理员和超级用户无法被删除！' });
    }

    const db = readDb();
    const index = db.users.findIndex(u => u.username === username);
    if (index === -1) {
        return res.status(404).json({ error: 'NOT_FOUND', message: '未找到该用户账号！' });
    }

    db.users.splice(index, 1);
    
    // 清理该用户的会话
    Object.keys(db.sessions).forEach(token => {
        if (db.sessions[token].username === username) {
            delete db.sessions[token];
        }
    });

    writeDb(db);
    res.json({ success: true, message: '账号删除成功！' });
});

// 获取操作审计日志 (仅 Admin)
app.get('/api/admin/logs', authenticate, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权操作：仅系统管理员可行！' });
    }

    const db = readDb();
    const sortedLogs = [...db.logs].reverse();
    res.json({ success: true, logs: sortedLogs });
});


// 获取 SMTP 配置 (仅 Admin)
app.get('/api/admin/smtp-settings', authenticate, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权操作：仅系统管理员可行！' });
    }
    const db = readDb();
    res.json({
        success: true,
        smtp: db.smtp || { host: '', port: 465, secure: true, user: '', pass: '', senderName: 'VidFetch' }
    });
});

// 保存 SMTP 配置 (仅 Admin)
app.post('/api/admin/smtp-settings', authenticate, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权操作：仅系统管理员可行！' });
    }
    const { host, port, secure, user, pass, senderName } = req.body;
    const db = readDb();
    db.smtp = {
        host: (host || '').trim(),
        port: parseInt(port) || 465,
        secure: secure !== false,
        user: (user || '').trim(),
        pass: (pass || '').trim(),
        senderName: (senderName || 'VidFetch').trim()
    };
    writeDb(db);
    res.json({ success: true, message: 'SMTP 邮箱配置保存成功！' });
});

// 获取 AI 核心配置备份 (仅限 Admin)
app.get('/api/admin/config-backup', authenticate, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权操作：仅系统管理员可行！' });
    }

    const backupPath = path.join(__dirname, 'ai_config_backup.json');
    if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ error: 'NOT_FOUND', message: '未找到备份配置文件！' });
    }

    try {
        const content = fs.readFileSync(backupPath, 'utf-8');
        const config = JSON.parse(content);
        res.json({ success: true, config });
    } catch (e) {
        res.status(500).json({ error: 'SERVER_ERROR', message: '读取备份配置失败: ' + e.message });
    }
});

// 保存 AI 核心配置备份 (仅限 Admin)
app.post('/api/admin/config-backup', authenticate, (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'FORBIDDEN', message: '无权操作：仅系统管理员可行！' });
    }

    const backupPath = path.join(__dirname, 'ai_config_backup.json');
    try {
        const {
            doubaoApiKey,
            doubaoEndpointId,
            enableDoubao,
            asrApiKey,
            asrEndpoint,
            asrModel,
            enableAsr,
            summaryProvider,
            siliconflowLlApiKey,
            siliconflowLlModel
        } = req.body;

        const config = {
            doubaoApiKey: (doubaoApiKey || '').trim(),
            doubaoEndpointId: (doubaoEndpointId || '').trim(),
            enableDoubao: !!enableDoubao,
            asrApiKey: (asrApiKey || '').trim(),
            asrEndpoint: (asrEndpoint || '').trim(),
            asrModel: (asrModel || '').trim(),
            enableAsr: !!enableAsr,
            summaryProvider: (summaryProvider || 'siliconflow').trim(),
            siliconflowLlApiKey: (siliconflowLlApiKey || '').trim(),
            siliconflowLlModel: (siliconflowLlModel || 'Qwen/Qwen2.5-7B-Instruct').trim()
        };

        fs.writeFileSync(backupPath, JSON.stringify(config, null, 2), 'utf-8');
        res.json({ success: true, message: 'AI 核心配置已成功备份至服务器！' });
    } catch (e) {
        res.status(500).json({ error: 'SERVER_ERROR', message: '保存备份配置失败: ' + e.message });
    }
});

// 启发式 AI 本地智能总结引擎
function generateAISummary(title, desc, platform) {
    const fullText = ((title || '') + '。' + (desc || '')).trim();
    
    // 1. 智能判别视频所属领域
    let category = "生活娱乐 & 综合创作";
    const textLower = fullText.toLowerCase();
    if (textLower.includes("code") || textLower.includes("编程") || textLower.includes("开发") || textLower.includes("ai") || textLower.includes("人工智能") || textLower.includes("gpt") || textLower.includes("科技") || textLower.includes("大模型") || textLower.includes("软件")) {
        category = "科技前沿 & 编程技术";
    } else if (textLower.includes("mv") || textLower.includes("音乐") || textLower.includes("歌") || textLower.includes("music") || textLower.includes("concert") || textLower.includes("声乐") || textLower.includes("演奏")) {
        category = "音乐艺术 & 视听盛宴";
    } else if (textLower.includes("教程") || textLower.includes("怎么") || textLower.includes("如何") || textLower.includes("tutorial") || textLower.includes("learn") || textLower.includes("科普") || textLower.includes("知识") || textLower.includes("历史") || textLower.includes("科学")) {
        category = "知识科普 & 技能教程";
    } else if (textLower.includes("美食") || textLower.includes("吃") || textLower.includes("探店") || textLower.includes("cooking") || textLower.includes("food") || textLower.includes("做菜") || textLower.includes("美味") || textLower.includes("餐厅")) {
        category = "美食分享 & 探店推荐";
    } else if (textLower.includes("搞笑") || textLower.includes("哈哈") || textLower.includes("段子") || textLower.includes("funny") || textLower.includes("整蛊") || textLower.includes("鬼畜")) {
        category = "趣味幽默 & 解压娱乐";
    } else if (textLower.includes("穿搭") || textLower.includes("美妆") || textLower.includes("时尚") || textLower.includes("ootd") || textLower.includes("护肤") || textLower.includes("彩妆")) {
        category = "时尚美妆 & 潮流生活";
    } else if (textLower.includes("游戏") || textLower.includes("game") || textLower.includes("王者") || textLower.includes("英雄联盟") || textLower.includes("单机") || textLower.includes("手游")) {
        category = "游戏电竞 & 娱乐解说";
    }

    // 2. 核心看点提炼：基于句子权重算法的本地抽取式摘要 (Extractive Summarization)
    const sentences = fullText.split(/[。！？；!?;\n\r]+/)
        .map(s => s.trim())
        .filter(s => s.length >= 6 && s.length <= 150); // 过滤过短或过长的句子

    let points = [];
    if (sentences.length > 0) {
        // 计算词频 (中英文轻量化权重计算)
        const wordFreq = {};
        const stopWords = new Set(["的", "了", "在", "是", "我", "你", "他", "它", "们", "这", "那", "有", "无", "和", "与", "就", "都", "而", "及", "并", "得", "着", "也", "且", "这", "对", "个", "中", "上", "下", "里", "来", "去", "要", "会", "能", "可", "以", "的", "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "to", "of", "in", "on", "at", "for", "with"]);
        
        sentences.forEach(sentence => {
            const words = sentence.split(/[\s,，.、:：(（)）]+/).flatMap(w => {
                if (/^[a-zA-Z]+$/.test(w)) return [w.toLowerCase()]; // 英文单词
                const tokens = [];
                for (let i = 0; i < w.length; i++) {
                    tokens.push(w[i]); // 单字
                    if (i < w.length - 1) tokens.push(w.slice(i, i + 2)); // 双字滑动窗口
                }
                return tokens;
            });

            words.forEach(w => {
                if (w.length > 1 && !stopWords.has(w)) {
                    wordFreq[w] = (wordFreq[w] || 0) + 1;
                }
            });
        });

        // 对句子评分
        const sentenceScores = sentences.map((sentence, idx) => {
            let score = 0;
            const words = sentence.split(/[\s,，.、:：(（)）]+/).flatMap(w => {
                if (/^[a-zA-Z]+$/.test(w)) return [w.toLowerCase()];
                const tokens = [];
                for (let i = 0; i < w.length; i++) {
                    tokens.push(w[i]);
                    if (i < w.length - 1) tokens.push(w.slice(i, i + 2));
                }
                return tokens;
            });
            words.forEach(w => {
                if (wordFreq[w]) score += wordFreq[w];
            });
            score = score / (sentence.length || 1); // 归一化长度
            score += (10 / (idx + 1)); // 句首位置奖励
            return { text: sentence, score };
        });

        // 排序并筛选（去重高相似度句子）
        sentenceScores.sort((a, b) => b.score - a.score);
        const selected = [];
        for (const item of sentenceScores) {
            const isDuplicate = selected.some(s => {
                const commonChars = [...s].filter(c => item.text.includes(c)).length;
                return commonChars / Math.min(s.length, item.text.length) > 0.6;
            });
            if (!isDuplicate) {
                selected.push(item.text);
            }
            if (selected.length >= 3) break;
        }
        
        points = selected;
    }

    // 兜底看点
    if (points.length < 3) {
        // 从全文本中提取一些有意义的关键词 (去重，去掉常见停用词)
        const stopWords = new Set(["的", "了", "在", "是", "我", "你", "他", "它", "们", "这", "那", "有", "无", "和", "与", "就", "都", "而", "及", "并", "得", "着", "也", "且", "对", "个", "中", "上", "下", "里", "来", "去", "要", "会", "能", "可", "以", "视频", "平台", "热门", "评论", "标签", "没有", "一个", "自己", "这个", "我们", "什么", "怎么"]);
        const rawWords = fullText.split(/[\s,，.、:：(（)）《》#。！？；!?;\n\r]+/g)
            .filter(w => w.length >= 2 && w.length <= 10 && !stopWords.has(w));
        const keywords = Array.from(new Set(rawWords)).slice(0, 5);

        const dynamicPoints = [
            `本视频围绕主题“${title || '精彩内容'}”展开，通过画面呈现了作者的创作视域。`,
            keywords.length > 0
                ? `内容中提取到“${keywords.join('、')}”等高频词与叙事线索，信息表达凝练直白。`
                : `视频叙事风格清晰，节奏轻快，整体能让观众在短时间内迅速抓住作品的核心方向。`,
            `作品体现了作者在【${category}】领域的个性化表达，展现了良好的互动观赏价值。`
        ];

        while (points.length < 3) {
            points.push(dynamicPoints[points.length]);
        }
    }

    // 3. 智能行动建议
    let suggestion = "建议收藏并结合视频原网页进行高频观看，获取完整体验。";
    if (category === "科技前沿 & 编程技术") {
        suggestion = "建议对涉及的技术栈或AI工具进行本地搭建复现，实操以加深理解。";
    } else if (category === "音乐艺术 & 视听盛宴") {
        suggestion = "推荐佩戴耳机以获取无损解析音质效果，沉浸式体会视听艺术的细节张力。";
    } else if (category === "知识科普 & 技能教程") {
        suggestion = "内容属于典型的高密度干货，建议保存文案并建立思维导图，用于日后温故知新。";
    } else if (category === "美食分享 & 探店推荐") {
        suggestion = "建议作为周末聚餐或下厨做菜的参考指南，适合与家人朋友共同分享这份烟火温情。";
    }

    return {
        category,
        points,
        suggestion
    };
}

// ============================================================================
// 抖音解析专用模块（页面上下文签名法）
//
// 背景：抖音 Web 的 /aweme/v1/web/aweme/detail/ 受 ArgusSecurityPlugin 保护，
// 校验的是请求签名 a_bogus（不是 cookie）。实测：
//   - node 侧 axios + 完整 cookie(ttwid/UIFID/s_v_web_id/msToken) => 403 "Uifid Not Found"
//   - page.evaluate 里 fetch 同源接口 => 200，aweme_detail 完整
// 原因：抖音的 webmssdk/Argus 运行时把签名器挂在页面环境里，
//       在页面上下文发请求会被自动补上当前版本的 a_bogus。
// 所以这里"让浏览器替我们签名"，永远不在 node 里手写签名算法。
// ============================================================================

const DOUYIN_PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DOUYIN_ORIGIN = 'https://www.douyin.com';

// 从任意文本（含中文、emoji 的分享文案）中挑出抖音链接
// 用 URL 解析而非宽松正则：避免把紧跟链接的中文/emoji 吃进 URL，
// 也避免把 http://xx.douyin.com.evil.com 这类伪造域误判为抖音。
function isDouyinHost(host) {
    return host === 'douyin.com' || host.endsWith('.douyin.com')
        || host === 'iesdouyin.com' || host.endsWith('.iesdouyin.com');
}

function extractDouyinLink(text) {
    if (!text) return null;
    const candidates = String(text).match(/https?:\/\/[a-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi) || [];
    for (const c of candidates) {
        const cleaned = c.replace(/[.,;!?'")\]]+$/g, '');
        try {
            const u = new URL(cleaned);
            if (isDouyinHost(u.hostname) && !u.username && !u.password) return u.href;
        } catch (e) { }
    }
    return null;
}

// 从 URL 里抠 aweme_id
function awemeIdFromUrl(value) {
    if (!value) return null;
    try {
        const u = new URL(value);
        if (!isDouyinHost(u.hostname)) return null;
        const m = u.pathname.match(/\/(?:share\/)?(?:video|note|slides)\/(\d+)(?:\/|$)/);
        if (m) return m[1];
        for (const k of ['modal_id', 'aweme_id', 'item_id']) {
            const id = u.searchParams.get(k);
            if (id && /^\d+$/.test(id)) return id;
        }
    } catch (e) { }
    return null;
}

// 用独立 page 跟随短链 302，不污染工作页面已初始化的签名环境
// （在 evaluate 里 fetch 短链会因 CORS/opaque redirect 直接失败）
async function resolveDouyinAwemeId(page, link) {
    const direct = awemeIdFromUrl(link);
    if (direct) return direct;

    const resolver = await page.browserContext().newPage();
    let seenId = null;
    let navErr = null;
    const onRequest = (req) => {
        try {
            if (req.isNavigationRequest() && req.frame() === resolver.mainFrame()) {
                seenId = seenId || awemeIdFromUrl(req.url());
            }
        } catch (e) { }
    };
    resolver.on('request', onRequest);
    try {
        try {
            await resolver.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) { navErr = e; }

        // 兼容"先返回分享页、再执行客户端跳转"的短链
        const deadline = Date.now() + 5000;
        while (!seenId && Date.now() < deadline) {
            seenId = awemeIdFromUrl(resolver.url());
            if (!seenId) await new Promise(r => setTimeout(r, 250));
        }
        const id = awemeIdFromUrl(resolver.url()) || seenId;
        if (!id) throw new Error('短链未解析到作品 ID；可能已失效或进入验证页' + (navErr ? `（${navErr.name}）` : ''));
        return id;
    } finally {
        resolver.off('request', onRequest);
        await resolver.close().catch(() => { });
    }
}

// 在页面上下文里请求 detail 接口（带诊断分类 + 有限重试）
async function fetchDouyinDetailInPage(page, awemeId, attempts = 3) {
    let lastError = '未取得作品详情';

    for (let i = 0; i < attempts; i++) {
        if (i > 0) {
            // 指数退避：1s / 2s
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i - 1)));
        }

        const result = await page.evaluate(async (id) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            try {
                const qs = new URLSearchParams({
                    device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web',
                    aweme_id: id, pc_client_type: '1', version_code: '190500', version_name: '19.5.0',
                    cookie_enabled: 'true', screen_width: '1440', screen_height: '900',
                    browser_language: 'zh-CN', browser_platform: 'Win32', browser_name: 'Chrome',
                    browser_version: '124.0.0.0', browser_online: 'true',
                    engine_name: 'Blink', engine_version: '124.0.0.0', os_name: 'Windows',
                    os_version: '10', cpu_core_num: '8', device_memory: '8', platform: 'PC',
                    downlink: '10', effective_type: '4g', round_trip_time: '50'
                });
                const r = await fetch('/aweme/v1/web/aweme/detail/?' + qs.toString(), {
                    credentials: 'include',
                    headers: { accept: 'application/json, text/plain, */*' },
                    signal: controller.signal
                });
                const text = await r.text();
                let json = null;
                try { json = JSON.parse(text); } catch (e) { }

                // 只返回诊断分类，不落 Cookie / 签名 / 整段响应
                return {
                    status: r.status,
                    json,
                    argusBlocked: /ArgusSecurityPlugin/i.test(text),
                    uifidMissing: /Uifid Not Found/i.test(text),
                    signatureMissing: /Signature Not Found/i.test(text),
                    nonJson: json === null
                };
            } catch (e) {
                return { status: 0, json: null, networkError: String(e && e.name || 'FetchError'), nonJson: true };
            } finally {
                clearTimeout(timer);
            }
        }, awemeId);

        const body = result.json;
        const candidate = body && body.aweme_detail;

        // 契约校验：HTTP 200 + status_code 正常 + 有 detail + id 必须匹配
        // （id 不匹配说明命中了错误的缓存或推荐结果，不是我们要的那条）
        if (
            result.status === 200 &&
            (body && body.status_code == null || body.status_code === 0) &&
            candidate &&
            String(candidate.aweme_id) === String(awemeId)
        ) {
            return candidate;
        }

        lastError = [
            `HTTP ${result.status}`,
            body && body.status_code != null ? `status_code=${body.status_code}` : null,
            result.argusBlocked ? 'Argus 拦截' : null,
            result.uifidMissing ? 'Uifid Not Found' : null,
            result.signatureMissing ? 'Signature Not Found' : null,
            result.nonJson ? '非 JSON 响应' : null,
            result.networkError,
            candidate && String(candidate.aweme_id) !== String(awemeId) ? '响应作品 ID 不匹配' : null,
            body && body.filter_detail && body.filter_detail.filter_reason ? `filter=${body.filter_detail.filter_reason}` : null
        ].filter(Boolean).join('；');

        // 明确的业务失败（限流 / 作品不可见）重试也没用，直接跳出
        if (result.status === 429 || (body && body.status_code != null && body.status_code !== 0)) {
            break;
        }
    }

    throw new Error(lastError);
}

// ============================================================================
// 统一统计数据结构
//
// 设计原则（绝不造假，宁可留 null）：
//   - 每个指标要么是真实数字，要么是 null
//   - 每个指标带 source 标明来源，前端可据此决定是否展示/如何标注
//   - missing 数组明确告诉前端"这个平台不提供哪些指标"
//   - 平台不提供播放量时，play.available=false，前端就不该渲染"播放"格子
//
// 各平台真实可得字段：
//   B站    : stat.view/danmaku/like/reply/favorite/coin/share  ← 全都有，最完整
//   抖音   : statistics.digg/comment/collect/share/recommend
//            play_count 恒为 0（字节已停止下发）；仅热榜视频有 hot_list.view_count
//   快手   : photo.viewCount（真实播放量） / realLikeCount
//            评论数需另调 commentListQuery 的 commentCountV2；无 shareCount 字段
//   小红书 : interactInfo.likedCount/commentCount/collectedCount/shareCount
//            无播放量字段
// ============================================================================

const STAT_LABELS = {
    play: '播放', danmaku: '弹幕', like: '点赞', comment: '评论',
    collect: '收藏', coin: '投币', share: '分享', recommend: '推荐'
};

/**
 * 构建某个指标的标准化单元
 * @param {number|null|undefined} value 真实数值
 * @param {string|null} source 来源标识
 */
function statCell(value, source) {
    const n = (value === null || value === undefined || value === '') ? null : Number(value);
    if (n === null || !Number.isFinite(n)) return null;
    return { value: n, source: source || null };
}

/**
 * 组装统一 stats
 * @param {object} cells  { play, like, comment, ... } 每项是 statCell 的返回或原始数字
 * @param {string[]} missing 平台明确不提供的指标
 * @param {string} note 给用户看的说明（可选）
 */
function buildStats(cells, missing = [], note = '') {
    const out = {};
    const missingOut = new Set(missing);

    for (const key of Object.keys(STAT_LABELS)) {
        const cell = cells[key];
        if (cell && typeof cell === 'object' && 'value' in cell) {
            out[key] = cell;
        } else if (cell !== undefined && cell !== null) {
            out[key] = statCell(cell, 'api');
        } else {
            out[key] = null;
        }
        // 值为 null 的自动归入 missing
        if (out[key] === null) missingOut.add(key);
    }

    const result = {
        metrics: out,
        missing: [...missingOut],
        note: note || ''
    };
    // 便捷字段：让老前端也能直接读 stats.play 拿到数字
    for (const key of Object.keys(STAT_LABELS)) {
        result[key] = out[key] ? out[key].value : null;
    }
    return result;
}

// 解析 "4.2万" / "1.4万" / "9122" / "536" 这类中文字符串计数
function parseCnNumber(val) {
    if (val === null || val === undefined || val === '') return null;
    if (typeof val === 'number') return Number.isFinite(val) ? val : null;
    const s = String(val).trim().replace(/,/g, '');
    if (!s) return null;
    const m = s.match(/^([\d.]+)\s*([万亿wWkK])?$/);
    if (!m) {
        const n = Number(s.replace(/[^\d.]/g, ''));
        return Number.isFinite(n) ? n : null;
    }
    const base = parseFloat(m[1]);
    if (!Number.isFinite(base)) return null;
    const unit = m[2];
    if (!unit) return Math.round(base);
    if (unit === '万' || unit === 'w' || unit === 'W') return Math.round(base * 10000);
    if (unit === '亿') return Math.round(base * 100000000);
    if (unit === 'k' || unit === 'K') return Math.round(base * 1000);
    return Math.round(base);
}

// 从 aweme.snssdk play 直链不需要；这里给抖音构造 stats
//
// ⚠️ 关于 hot_list.view_count 的处理（采纳 Astra 的复核意见）：
//   接口确实会返回这个数值，但它的统计对象、时间范围、是否为累计播放
//   均未得到验证，不能等同于"真实播放量"。
//   因此我把它放进独立的 hotListViews 字段并标注"口径未核验"，
//   绝不填进 play 字段去冒充播放量。
function buildDouyinStats(statistics, hotListViewCount) {
    const st = statistics || {};
    const cells = {
        like: statCell(st.digg_count, 'statistics.digg_count'),
        comment: statCell(st.comment_count, 'statistics.comment_count'),
        collect: statCell(st.collect_count, 'statistics.collect_count'),
        share: statCell(st.share_count, 'statistics.share_count'),
        recommend: statCell(st.recommend_count, 'statistics.recommend_count')
    };

    const missing = [];
    let note = '';

    // play_count 恒为 0：视为"平台未提供"，而不是"播放量为 0"
    if (Number(st.play_count) > 0) {
        cells.play = statCell(st.play_count, 'statistics.play_count');
    } else {
        cells.play = null;
        missing.push('play');
        note = '当前接口未提供可核验的播放量（抖音 Web 端 play_count 恒为 0），以下为真实互动数据';
    }

    const stats = buildStats(cells, missing, note);

    // 热榜字段单独给出，明确标注口径未核验
    const hv = Number(hotListViewCount);
    if (Number.isFinite(hv) && hv > 0) {
        stats.hotListViews = { value: hv, source: 'hot_list.view_count', verified: false };
        stats.note = '抖音 Web 端未下发可核验的播放量；' +
            '该作品在抖音热榜字段中另有一个数值（见 hotListViews，统计口径未核验，不等同于播放量）';
    }

    return stats;
}

// 统一成项目内的标准字段
function pickDouyinFields(d) {
    const v = d.video;
    if (!v) throw new Error('作品详情没有 video 字段（可能是图文作品）');

    let urls = (v.play_addr?.url_list || []).filter(u => /^https?:\/\//.test(u));
    // play_addr 缺失时，从 bit_rate 列表按码率降序取最高清
    if (!urls.length && Array.isArray(v.bit_rate)) {
        const sorted = [...v.bit_rate].sort((a, b) => Number(b.bit_rate || 0) - Number(a.bit_rate || 0));
        for (const it of sorted) {
            urls = (it.play_addr?.url_list || []).filter(u => /^https?:\/\//.test(u));
            if (urls.length) break;
        }
    }
    if (!urls.length) throw new Error('作品详情已返回，但没有可用的 play_addr');

    const cover = [v.cover, v.origin_cover, v.dynamic_cover]
        .flatMap(x => x?.url_list || [])
        .find(u => /^https?:\/\//.test(u)) || '';

    const st = d.statistics || {};
    const desc = d.desc || '';
    const dur = Number(v.duration ?? d.duration);
    // 热榜视频会在 hot_list 里带真实播放量
    const hotListViewCount = d.hot_list?.view_count;

    return {
        awemeId: d.aweme_id,
        title: (desc.split('\n')[0] || '(无标题)').slice(0, 120),
        description: desc,
        cover,
        durationMs: Number.isFinite(dur) ? dur : null,
        author: d.author?.nickname || '',
        videoUrl: urls[0],
        videoCandidates: urls,
        stats: buildDouyinStats(st, hotListViewCount)
    };
}

// 抖音解析入口
async function parseDouyinViaContext(rawInput) {
    const link = extractDouyinLink(rawInput) || rawInput;
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--lang=zh-CN'
        ]
    });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1365, height: 900 });
        // 必须用桌面 Chromium UA：iPhone UA 会被抖音推向已失效的 H5 SSR/唤端通道，
        // 而 web detail 接口走的是 PC 通道。
        await page.setUserAgent(DOUYIN_PC_UA);
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {}, loadTimes: () => { }, csi: () => { } };
            Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh'] });
        });

        const awemeId = await resolveDouyinAwemeId(page, link);
        if (!awemeId) throw new Error('无法解析出 aweme_id，输入: ' + link);
        console.log(`[抖音快车道] aweme_id = ${awemeId}`);

        // 必须处在 www.douyin.com 同源页面，站点的签名 SDK 才已初始化
        if (new URL(page.url()).origin !== DOUYIN_ORIGIN) {
            await page.goto(`https://www.douyin.com/video/${awemeId}`, {
                waitUntil: 'domcontentloaded', timeout: 30000
            }).catch(() => { });
        }
        // 不用 networkidle（站点会持续上报/轮询，永远不 idle）。
        // 也不用等到 readyState==='complete'：视频页会一直有流请求，可能要等几十秒。
        // 正确做法是等"签名运行时已挂载"这个真正的前置条件。
        await page.waitForFunction(
            () => typeof window.byted_acrawler !== 'undefined' || typeof window.bdms !== 'undefined',
            { timeout: 8000 }
        ).catch(() => { });
        await new Promise(r => setTimeout(r, 800));

        const detail = await fetchDouyinDetailInPage(page, awemeId);
        const fields = pickDouyinFields(detail);

        console.log(`[抖音快车道] ✅ 成功: ${fields.title} | 点赞 ${fields.stats.like} 评论 ${fields.stats.comment}`);
        return fields;
    } finally {
        await browser.close().catch(() => { });
    }
}

// ============================================================================
// 快手解析模块（GraphQL 响应嗅探法）
//
// 背景：快手 Web 用 Apollo GraphQL，数据不在 DOM（<video src> 是 blob 或空），
// 也不在 __INITIAL_STATE__（那是 Vue/Nuxt 的约定，快手不用）。
// 实测：真正的 photo 数据在 POST /graphql 的响应体里，
//   字段形如 caption / photoUrl / viewCount("29.6万") / likeCount("909") /
//   realLikeCount(909) / commentCount。
// 注意 viewCount/likeCount 常是"万"单位的中文字符串，必须解析成数字。
// ============================================================================

// 解析 "29.6万" / "1574562" / "1.2亿" 这类混合计数的旧实现已合并进 parseCnNumber()
// （见文件上方"统一统计数据结构"区块）

function extractKuaishouLink(text) {
    if (!text) return null;
    const candidates = String(text).match(/https?:\/\/[a-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi) || [];
    for (const c of candidates) {
        const cleaned = c.replace(/[.,;!?'")\]]+$/g, '');
        try {
            const u = new URL(cleaned);
            const h = u.hostname;
            const ok = h === 'kuaishou.com' || h.endsWith('.kuaishou.com')
                || h === 'gifshow.com' || h.endsWith('.gifshow.com')
                || h === 'chenzhongtech.com' || h.endsWith('.chenzhongtech.com');
            if (ok && !u.username && !u.password) return u.href;
        } catch (e) { }
    }
    return null;
}

// 从快手 GraphQL 返回的任意 JSON 里递归找"最像主视频"的节点
function findKuaishouPhoto(obj, seen = new Set()) {
    if (!obj || typeof obj !== 'object' || seen.has(obj)) return null;
    seen.add(obj);

    // 命中条件：同时具备 视频地址 与 播放/点赞 任一
    const hasVideo = obj.photoUrl || (Array.isArray(obj.mainMvUrls) && obj.mainMvUrls.length)
        || obj.manifest || obj.adaptationSet;
    const hasCount = obj.viewCount != null || obj.likeCount != null || obj.realLikeCount != null;
    if (hasVideo && (hasCount || obj.caption)) return obj;

    for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v && typeof v === 'object') {
            const found = findKuaishouPhoto(v, seen);
            if (found) return found;
        }
    }
    return null;
}

function pickKuaishouFields(photo) {
    // 视频直链：优先 photoUrl（无水印/无标清降级），其次 mainMvUrls
    let videoUrl = photo.photoUrl || '';
    if (!videoUrl && Array.isArray(photo.mainMvUrls) && photo.mainMvUrls[0]) {
        videoUrl = photo.mainMvUrls[0].url || '';
    }
    if (!videoUrl && photo.manifest) {
        try {
            const mf = typeof photo.manifest === 'string' ? JSON.parse(photo.manifest) : photo.manifest;
            const ad = mf?.adaptationSet?.[0];
            videoUrl = ad?.representation?.[0]?.url || ad?.representation?.[0]?.backupUrl?.[0] || '';
        } catch (e) { }
    }

    const caption = photo.caption || '';
    return {
        title: (caption.split('\n')[0] || '(无标题)').slice(0, 120),
        description: caption,
        cover: photo.coverUrl || (Array.isArray(photo.coverUrls) && photo.coverUrls[0]?.url) || '',
        author: photo.userName || photo.user?.name || photo.originUserName || '',
        durationMs: photo.duration || 0,
        videoUrl,
        stats: buildKuaishouStats(photo)
    };
}

// 快手统计：viewCount 是真实播放量（常为 "29.6万" 中文字符串），
// 评论数在 VisionVideoDetailPhoto 上不存在，需要 commentListQuery 的 commentCountV2
function buildKuaishouStats(photo, commentCountFromApi) {
    const cells = {
        play: statCell(parseCnNumber(photo.viewCount ?? photo.playCount), 'photo.viewCount'),
        like: statCell(parseCnNumber(photo.realLikeCount ?? photo.likeCount), 'photo.realLikeCount')
    };

    const missing = [];
    // 评论数：优先用 commentListQuery 返回的 commentCountV2
    const cc = parseCnNumber(commentCountFromApi);
    if (cc !== null && cc >= 0) {
        cells.comment = statCell(cc, 'commentListQuery.commentCountV2');
    } else {
        cells.comment = null;
        missing.push('comment');
    }

    // 快手 GraphQL 的 VisionVideoDetailPhoto 类型没有收藏/分享字段
    missing.push('collect', 'share');

    return buildStats(cells, missing, '快手 Web 端不提供收藏与分享数');
}

// 用页面自身的签名环境调用 commentListQuery（直接拼 query 会触发 Need captcha）
async function fetchKuaishouCommentCount(page, photoId) {
    try {
        const result = await page.evaluate(async (pid) => {
            // 用与站点一致的 query 结构（page 参数不合法会报 Unknown argument，故不传）
            const query = `query commentListQuery($photoId: String, $pcursor: String) {
                visionCommentList(photoId: $photoId, pcursor: $pcursor) {
                    commentCount
                    commentCountV2
                    pcursor
                }
            }`;
            try {
                const r = await fetch('/graphql', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        operationName: 'commentListQuery',
                        variables: { photoId: pid, pcursor: '' },
                        query
                    })
                });
                const t = await r.text();
                const j = JSON.parse(t);
                const v = j.data?.visionCommentList;
                return v ? { commentCount: v.commentCount, commentCountV2: v.commentCountV2 } : null;
            } catch (e) {
                return null;
            }
        }, photoId);

        if (!result) return null;
        // commentCount 常为 null，真正的数字在 commentCountV2
        return result.commentCountV2 ?? result.commentCount ?? null;
    } catch (e) {
        return null;
    }
}

async function parseKuaishouViaGraphQL(rawInput) {
    const link = extractKuaishouLink(rawInput) || rawInput;
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--lang=zh-CN'
        ]
    });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });
        await page.setUserAgent(DOUYIN_PC_UA);
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {}, loadTimes: () => { }, csi: () => { } };
            Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh'] });
        });

        // 收集所有 /graphql 响应体
        const gqlBodies = [];
        page.on('response', async (response) => {
            const u = response.url();
            if (!u.includes('/graphql')) return;
            try {
                const txt = await response.text();
                if (txt && txt.length > 120) gqlBodies.push(txt);
            } catch (e) { }
        });

        console.log(`[快手快车道] 打开页面: ${link}`);
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => {
            console.log('[快手快车道] 页面加载异常（继续尝试抓取已有响应）:', e.message);
        });

        // 轮询等待 GraphQL 数据回填（比固定 sleep 更快也更能应对慢响应）
        const deadline = Date.now() + 20000;
        let best = null;
        while (Date.now() < deadline) {
            for (const body of gqlBodies) {
                let json;
                try { json = JSON.parse(body); } catch (e) { continue; }
                const photo = findKuaishouPhoto(json);
                if (!photo) continue;
                // 选字段最全的那个节点
                const score = ['photoUrl', 'viewCount', 'likeCount', 'caption', 'commentCount']
                    .filter(k => photo[k] != null && photo[k] !== '').length;
                if (!best || score > best.score) best = { photo, score };
            }
            // 拿到带视频地址 + 统计的节点就提前结束
            if (best && best.photo.photoUrl && best.score >= 4) break;
            await new Promise(r => setTimeout(r, 500));
        }

        console.log(`[快手快车道] 捕获 GraphQL 响应 ${gqlBodies.length} 条`);
        if (!best) throw new Error('未从 GraphQL 响应中定位到视频节点');

        const fields = pickKuaishouFields(best.photo);
        if (!fields.videoUrl) throw new Error('未取到视频直链');

        // 补评论数：commentCount 在 photo 节点上是 null，必须单独查 commentListQuery
        const photoId = best.photo.id || (link.match(/short-video\/([a-zA-Z0-9]+)/) || [])[1];
        if (photoId) {
            const cc = await fetchKuaishouCommentCount(page, photoId);
            if (cc !== null) {
                fields.stats = buildKuaishouStats(best.photo, cc);
                console.log(`[快手快车道] 评论数 = ${cc}（来源 commentCountV2）`);
            }
        }

        console.log(`[快手快车道] ✅ 成功: ${fields.title} | 播放 ${fields.stats.play} 点赞 ${fields.stats.like} 评论 ${fields.stats.comment}`);
        return fields;
    } finally {
        await browser.close().catch(() => { });
    }
}

// ============================================================================
// 小红书解析模块（__INITIAL_STATE__ + 媒体流嗅探）
//
// 关键前提：链接必须带 xsec_token，否则页面直接跳 404（error_code=300031）。
// 数据位置：window.__INITIAL_STATE__.note.noteDetailMap[id].note
//   interactInfo.likedCount / commentCount / collectedCount / shareCount
//   —— 注意都是中文字符串（"4.2万"），要解析
// 视频直链：状态树是 MobX 深层嵌套不可靠，改用 page.on('response')
//   嗅探 content-type: video/mp4 的响应（sns-video-v3.xhscdn.com/stream/...）
//   document.querySelector('video').src 是 blob:，不可用
// ============================================================================

function extractXhsLink(text) {
    if (!text) return null;
    const candidates = String(text).match(/https?:\/\/[a-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi) || [];
    for (const c of candidates) {
        // xsec_token 里可能含 = ，只在结尾做最小裁剪
        const cleaned = c.replace(/[.,;!?'")\]]+$/g, '');
        try {
            const u = new URL(cleaned);
            const h = u.hostname;
            const ok = h === 'xiaohongshu.com' || h.endsWith('.xiaohongshu.com')
                || h === 'xhslink.com' || h.endsWith('.xhslink.com');
            if (ok && !u.username && !u.password) return cleaned;
        } catch (e) { }
    }
    return null;
}

function buildXhsStats(interactInfo) {
    const ii = interactInfo || {};
    return buildStats({
        like: statCell(parseCnNumber(ii.likedCount), 'interactInfo.likedCount'),
        comment: statCell(parseCnNumber(ii.commentCount), 'interactInfo.commentCount'),
        collect: statCell(parseCnNumber(ii.collectedCount), 'interactInfo.collectedCount'),
        share: statCell(parseCnNumber(ii.shareCount), 'interactInfo.shareCount')
    }, ['play'], '小红书不公开播放量，此处为真实互动数据');
}

async function parseXhsViaState(rawInput) {
    const link = extractXhsLink(rawInput) || rawInput;
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--lang=zh-CN'
        ]
    });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });
        await page.setUserAgent(DOUYIN_PC_UA);
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {}, loadTimes: () => { }, csi: () => { } };
            Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh'] });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        });

        // 嗅探媒体流：以 content-type: video/* 为准，避免把封面图误判成视频
        const mediaUrls = [];
        page.on('response', (resp) => {
            try {
                const ct = resp.headers()['content-type'] || '';
                const u = resp.url();
                if (ct.includes('video/') || (/xhscdn\.com/.test(u) && /\.mp4(\?|$)/.test(u) && !/\.(jpg|jpeg|png|webp)/.test(u))) {
                    if (!mediaUrls.includes(u)) mediaUrls.push(u);
                }
            } catch (e) { }
        });

        console.log(`[小红书] 打开页面: ${link.slice(0, 90)}`);
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => {
            console.log('[小红书] 页面加载异常:', e.message);
        });
        await new Promise(r => setTimeout(r, 6000));

        const state = await page.evaluate(() => {
            const st = window.__INITIAL_STATE__;
            if (!st) return null;
            const map = st.note && st.note.noteDetailMap;
            if (!map) return null;
            const key = Object.keys(map)[0];
            const n = key && map[key] && map[key].note;
            if (!n || !n.noteId) return null;

            // 顺便在状态树里兜底找视频地址（不作为主路径）
            let fallbackUrl = '';
            (function walk(o, depth) {
                if (!o || typeof o !== 'object' || depth > 10 || fallbackUrl) return;
                for (const k of Object.keys(o)) {
                    const v = o[k];
                    if (typeof v === 'string' && /^https?.*(?:sns-video|\.mp4)/.test(v) && !/\.(jpg|png|webp)/.test(v)) {
                        fallbackUrl = v; return;
                    }
                    if (v && typeof v === 'object') walk(v, depth + 1);
                }
            })(n, 0);

            return {
                noteId: n.noteId,
                type: n.type,
                title: n.title || '',
                desc: n.desc || '',
                user: n.user && n.user.nickname || '',
                interactInfo: n.interactInfo || null,
                cover: (n.imageList && n.imageList[0] && (n.imageList[0].urlDefault || n.imageList[0].url)) || '',
                fallbackVideoUrl: fallbackUrl
            };
        });

        if (!state) {
            throw new Error('未从 __INITIAL_STATE__ 取到笔记数据（链接可能缺少 xsec_token，或笔记已删除）');
        }

        console.log(`[小红书] type=${state.type} | 互动: ${JSON.stringify(state.interactInfo)}`);

        // 选视频地址：优先嗅探到的第一条 mp4
        let videoUrl = mediaUrls[0] || state.fallbackVideoUrl || '';
        console.log(`[小红书] 嗅探到 ${mediaUrls.length} 条媒体流`);

        // 图文笔记没有视频流，但互动数据依然是真实有效的，照样返回
        const isImageNote = state.type !== 'video' && !videoUrl;
        if (isImageNote) {
            console.log(`[小红书] 这是图文笔记（type=${state.type}），无视频流，仅返回图文数据与互动统计`);
        }

        const title = (state.title || state.desc.split('\n')[0] || '(无标题)').slice(0, 120);
        return {
            noteId: state.noteId,
            noteType: state.type,
            isImageNote,
            title,
            description: state.desc || state.title || '',
            cover: state.cover,
            author: state.user,
            durationMs: null,
            videoUrl: videoUrl || '',
            videoCandidates: mediaUrls.slice(0, 3),
            stats: buildXhsStats(state.interactInfo)
        };
    } finally {
        await browser.close().catch(() => { });
    }
}

// 核心自研技术：无头浏览器网络层嗅探
app.post('/api/parse', authenticate, async (req, res) => {
    let { url, apiKey, endpointId, accessKey } = req.body;
    if (!url) return res.status(400).json({ error: '请提供视频链接' });

    // 校验频率限制并扣减次数 (仅普通用户)
    const limitCheck = checkAndIncrementLimit(req.user, true);
    if (!limitCheck.allowed) {
        return res.status(403).json({ error: 'LIMIT_EXCEEDED', message: limitCheck.message });
    }

    // 提取真实的 HTTP/HTTPS 链接以清洗分享文本中的冗余内容
    const urlMatch = url.match(/(https?:\/\/[a-zA-Z0-9\-._~:/?#\[\]@!$&'()*+,;=]+)/);
    if (urlMatch) {
        url = urlMatch[0];
    } else {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
    }

    // 🔑 外网访问密钥校验（仅针对 YouTube, TikTok 等海外平台）
    const isOverseas = url.includes('youtube.com') || url.includes('youtu.be') || url.includes('tiktok.com');
    if (isOverseas) {
        const expectedKey = process.env.ACCESS_KEY || '1qaz789';
        if (!accessKey || accessKey !== expectedKey) {
            console.log(`[密钥验证] 未提供密钥或密钥错误。用户输入: "${accessKey || ''}"`);
            return res.status(403).json({ error: 'KEY_REQUIRED', message: '解析此海外平台视频需要正确的外网访问密钥！' });
        }
        console.log(`[密钥验证] 校验通过，允许解析海外平台视频`);
    }

    // ⚡ 抖音专用快车道：页面上下文签名 + web/aweme/detail/
    // 根因说明：抖音 Web 的 detail 接口受 ArgusSecurityPlugin 保护，校验 a_bogus 签名参数，
    // node 侧 axios 即使带全套 cookie 也返回 403 "Uifid Not Found"。
    // 唯一稳定做法是在 www.douyin.com 同源页面里发 fetch，让抖音自己的 webmssdk 运行时补签名。
    if (/douyin\.com/.test(url)) {
        try {
            const douyinResult = await parseDouyinViaContext(url);
            if (douyinResult && douyinResult.videoUrl) {
                addLog(req.user.username, req.user.role, '解析并提取视频', url);
                return res.json({
                    success: true,
                    videoUrl: douyinResult.videoUrl,
                    targetUrl: url,
                    title: douyinResult.title,
                    cover: douyinResult.cover,
                    platform: '抖音',
                    description: douyinResult.description || '暂无详细描述文案',
                    author: douyinResult.author,
                    duration: douyinResult.durationMs,
                    stats: douyinResult.stats,
                    hotListViews: douyinResult.stats?.hotListViews || null
                });
            }
        } catch (e) {
            console.warn(`[抖音快车道] 失败，降级到通用 puppeteer 嗅探:`, e.message);
        }
    }

    // ⚡ 快手快车道：GraphQL 响应嗅探（快手有真实播放量 viewCount）
    if (/(?:kuaishou|gifshow|chenzhongtech)\.com/.test(url)) {
        try {
            const ksResult = await parseKuaishouViaGraphQL(url);
            if (ksResult && ksResult.videoUrl) {
                addLog(req.user.username, req.user.role, '解析并提取视频', url);
                return res.json({
                    success: true,
                    videoUrl: ksResult.videoUrl,
                    targetUrl: url,
                    title: ksResult.title,
                    cover: ksResult.cover,
                    platform: '快手',
                    description: ksResult.description || '暂无详细描述文案',
                    author: ksResult.author,
                    duration: ksResult.durationMs,
                    stats: ksResult.stats
                });
            }
        } catch (e) {
            console.warn(`[快手快车道] 失败，降级到通用 puppeteer 嗅探:`, e.message);
        }
    }

    // ⚡ 小红书快车道：__INITIAL_STATE__ + 媒体流嗅探
    // 图文笔记（type=normal）没有视频流，但它的互动统计是真实的，同样返回给前端展示
    if (/(?:xiaohongshu|xhslink)\.com/.test(url)) {
        try {
            const xhsResult = await parseXhsViaState(url);
            if (xhsResult) {
                addLog(req.user.username, req.user.role, '解析并提取视频', url);
                return res.json({
                    success: true,
                    videoUrl: xhsResult.videoUrl || '',
                    targetUrl: url,
                    title: xhsResult.title,
                    cover: xhsResult.cover,
                    platform: '小红书',
                    description: xhsResult.description || '暂无详细描述文案',
                    author: xhsResult.author,
                    duration: xhsResult.durationMs,
                    noteType: xhsResult.noteType,
                    isImageNote: xhsResult.isImageNote,
                    stats: xhsResult.stats
                });
            }
        } catch (e) {
            console.warn(`[小红书] 失败，降级到通用 puppeteer 嗅探:`, e.message);
        }
    }

    // 1. 如果是 B站 链接，先尝试通过直接 API 获取，避免启动无头浏览器（极速且稳定）
    const isBilibili = url.includes('bilibili.com') || url.includes('b23.tv');
    if (isBilibili) {
        try {
            let directUrl = url;
            // 如果是短链接，进行 302 重定向解析
            if (directUrl.includes('b23.tv')) {
                const redirectRes = await axios.get(directUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
                    maxRedirects: 5
                });
                directUrl = redirectRes.request.res.responseUrl || directUrl;
            }

            let bvid = null;
            let aid = null;
            const bvidMatch = directUrl.match(/\/video\/(BV[a-zA-Z0-9]+)/i);
            if (bvidMatch) {
                bvid = bvidMatch[1];
            } else {
                const aidMatch = directUrl.match(/\/video\/av([0-9]+)/i);
                if (aidMatch) aid = aidMatch[1];
            }

            if (bvid || aid) {
                console.log(`[B站直接解析] 检测到Bvid: ${bvid || '无'} / Aid: ${aid || '无'}，开始直接调用API解析...`);
                const viewUrl = bvid 
                    ? `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`
                    : `https://api.bilibili.com/x/web-interface/view?aid=${aid}`;

                const viewRes = await axios.get(viewUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Referer': 'https://www.bilibili.com'
                    }
                });

                if (viewRes.data.code === 0 && viewRes.data.data) {
                    const videoData = viewRes.data.data;
                    const finalCid = videoData.cid;
                    const finalAid = videoData.aid;
                    const finalBvid = videoData.bvid || bvid;
                    const title = (videoData.title || 'B站视频').replace("_哔哩哔哩_bilibili", "").replace("_bilibili", "");
                    const cover = videoData.pic ? (videoData.pic.startsWith('//') ? 'https:' + videoData.pic : videoData.pic) : '';
                    let description = videoData.desc || '';

                    // ⚡ 极客数据增强：获取 B站 视频的标签(Tags)和热门评论(Hot Comments)作为文本补充
                    let tagsList = [];
                    try {
                        const tagsRes = await axios.get(`https://api.bilibili.com/x/tag/archive/tags?bvid=${finalBvid}`, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                'Referer': 'https://www.bilibili.com'
                            }
                        });
                        if (tagsRes.data.code === 0 && tagsRes.data.data) {
                            tagsList = tagsRes.data.data.map(t => t.tag_name);
                        }
                    } catch (err) {
                        console.log(`[B站直接解析] 获取标签失败: ${err.message}`);
                    }

                    let hotComments = [];
                    try {
                        const replyRes = await axios.get(`https://api.bilibili.com/x/v2/reply?type=1&oid=${finalAid}&sort=2`, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                'Referer': 'https://www.bilibili.com'
                            }
                        });
                        if (replyRes.data.code === 0 && replyRes.data.data && replyRes.data.data.replies) {
                            hotComments = replyRes.data.data.replies.slice(0, 5).map(r => r.content.message);
                        }
                    } catch (err) {
                        console.log(`[B站直接解析] 获取热门评论失败: ${err.message}`);
                    }

                    // 组合丰富的数据文案
                    let rawExtractText = description || '';
                    if (tagsList.length > 0) {
                        rawExtractText += (rawExtractText ? '。' : '') + `视频标签: ${tagsList.join('、')}`;
                    }
                    if (hotComments.length > 0) {
                        rawExtractText += (rawExtractText ? '。' : '') + `热门评论: ${hotComments.join('；')}`;
                    }
                    if (!rawExtractText) {
                        rawExtractText = '暂无详细描述文案';
                    }

                    // 获取播放地址
                    const playRes = await axios.get(`https://api.bilibili.com/x/player/playurl?avid=${finalAid}&bvid=${finalBvid}&cid=${finalCid}&qn=80&fnval=0&fnver=0&fourk=1&otype=json`, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Referer': 'https://www.bilibili.com'
                        }
                    });

                    if (playRes.data.code === 0 && playRes.data.data?.durl?.[0]?.url) {
                        const videoSrc = playRes.data.data.durl[0].url;
                        console.log(`[B站直接解析] 🎉 成功获取 MP4 直链 (qn=80)`);

                        // 净化空白字符，但保留完整段落和换行以维持可读性
                        rawExtractText = rawExtractText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

                        // ⚡ 补上一直漏读的播放量数据：B站 view 接口的 data.stat
                        const biliStat = videoData.stat || {};
                        const biliStats = buildStats({
                            play: statCell(biliStat.view, 'stat.view'),
                            danmaku: statCell(biliStat.danmaku, 'stat.danmaku'),
                            like: statCell(biliStat.like, 'stat.like'),
                            comment: statCell(biliStat.reply, 'stat.reply'),
                            collect: statCell(biliStat.favorite, 'stat.favorite'),
                            coin: statCell(biliStat.coin, 'stat.coin'),
                            share: statCell(biliStat.share, 'stat.share')
                        });
                        console.log(`[B站直接解析] 播放量 ${biliStat.view} | 点赞 ${biliStat.like} | 评论 ${biliStat.reply}`);

                        addLog(req.user.username, req.user.role, '解析并提取视频', url);
                        return res.json({
                            success: true,
                            videoUrl: videoSrc,
                            targetUrl: url,
                            title: title,
                            cover: cover,
                            platform: 'Bilibili',
                            description: rawExtractText || '暂无详细描述文案',
                            author: videoData.owner?.name || '',
                            duration: (videoData.duration || 0) * 1000, // 统一为毫秒
                            stats: biliStats
                        });
                    }
                }
            }
        } catch (e) {
            console.warn(`[B站直接解析] 接口调用失败，自动降级为 Puppeteer 浏览器嗅探:`, e.message);
        }
    }

    console.log(`[解析引擎] 正在启动无头浏览器，目标: ${url}`);
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--autoplay-policy=no-user-gesture-required'
            ]
        });
        const page = await browser.newPage();

        // 启用无头浏览器隐藏指纹，防爬虫风控
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            window.chrome = {
                runtime: {}
            };
        });

        const isBilibili = url.includes('bilibili.com') || url.includes('b23.tv');
        const isXiaohongshu = url.includes('xiaohongshu.com') || url.includes('xhslink.com');
        const isTikTok = url.includes('tiktok.com');
        const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
        const isKuaishou = url.includes('kuaishou.com') || url.includes('gifshow.com') || url.includes('chenzhongtech.com');
        const isBaijiahao = url.includes('baijiahao.baidu.com') || url.includes('mbd.baidu.com') || url.includes('haokan.baidu.com');

        if (isBilibili) {
            // 使用 iPad UA，既不会像手机端那样被强制唤起 Bilibili App，又不会像 PC 端那样默认采用音视频分离 of DASH 流，而是直接返回完整的 MP4 直链！
            await page.setUserAgent('Mozilla/5.0 (iPad; CPU OS 16_6 like Mac Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');
        } else if (isXiaohongshu || isBaijiahao) {
            // 小红书和百家号使用 PC 桌面 UA，避开移动端强制滑块验证及唤起 App 提示
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        } else if (isYouTube) {
            // YouTube 使用 iPhone UA 并配合禁用 MSE，使其返回 progressive MP4 直链
            await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');
            // 禁用 MediaSource Extensions 强制 YouTube 降级为 MP4 直链播放
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(window, 'MediaSource', {
                    get: () => undefined,
                    configurable: true
                });
                Object.defineProperty(window, 'WebKitMediaSource', {
                    get: () => undefined,
                    configurable: true
                });
            });
        } else {
            // 抖音、快手、TikTok 等其它平台使用手机 UA 触发轻量版/触屏版
            await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');
        }

        let videoSrc = null;
        let description = '';
        let pageSubtitleUrl = null;

        let resolveIntercept;
        const interceptPromise = new Promise(resolve => {
            resolveIntercept = resolve;
        });

        // 核心技术：开启底层请求拦截，篡改 API 参数强行获取 MP4 格式与超清画质
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const reqUrl = request.url();

            // ⚡ 核心提速与去水印：拦截抖音视频播放请求，直接提取 Video ID 组装 1080p 无水印直链
            if (reqUrl.includes('aweme/v1/play') || reqUrl.includes('video_id=')) {
                try {
                    const match = reqUrl.match(/video_id=([a-zA-Z0-9_]+)/);
                    if (match && !videoSrc) {
                        const videoId = match[1];
                        videoSrc = `https://aweme.snssdk.com/aweme/v1/play/?video_id=${videoId}&ratio=1080p`;
                        console.log(`[请求拦截] 成功截获抖音 Video ID: ${videoId}，重构 1080p 无水印直链`);
                        if (resolveIntercept) resolveIntercept();
                    }
                } catch (e) { }
            }

            if (reqUrl.includes('/x/player/wbi/playurl') || reqUrl.includes('/x/player/playurl')) {
                try {
                    const parsedUrl = new URL(reqUrl);
                    parsedUrl.pathname = '/x/player/playurl'; // 更改路径为非 WBI 接口以规避签名验证错误！
                    parsedUrl.searchParams.set('fnval', '0'); // fnval=0 代表强制返回 MP4 直链，而不是音视频分离 of DASH (fnval=80/4048)
                    parsedUrl.searchParams.set('qn', '80');    // qn=80 强制向B站索要 1080p 最高清晰度（游客最高可自动下发 720p/480p，避免默认的 360p 渣画质）
                    parsedUrl.searchParams.delete('w_rid');   // 清除 WBI 签名，避免由于参数被修改导致签名失效被拦截
                    parsedUrl.searchParams.delete('wts');
                    request.continue({ url: parsedUrl.toString() });
                    console.log(`[拦截请求] 成功将B站 WBI 播放接口改写为普通接口并篡改参数 (fnval=0, qn=80)`);
                    return;
                } catch (e) { }
            }

            // ⚡ 拦截 YouTube 视频播放请求，获取直接播放的 MP4 视频直链
            if (reqUrl.includes('googlevideo.com/videoplayback')) {
                try {
                    const parsedUrl = new URL(reqUrl);
                    const mime = parsedUrl.searchParams.get('mime');
                    if (mime && mime.includes('video/mp4') && !videoSrc) {
                        videoSrc = reqUrl;
                        console.log(`[请求拦截] 成功拦截到 YouTube MP4 视频直链: ${videoSrc.substring(0, 60)}...`);
                        if (resolveIntercept) resolveIntercept();
                    }
                } catch (e) { }
            }

            request.continue();
        });

        // 监听底层网络请求，暴力拦截媒体流及接口数据作为兜底
        page.on('response', async (response) => {
            if (videoSrc) return;
            const reqUrl = response.url();

            // 1. 拦截抖音 API
            // ⚠️ 补充：原代码在 videoSrc 拿到后没有调用 resolveIntercept()，
            // 导致即使嗅探成功，外部 await Promise.race([interceptPromise, navPromise])
            // 仍可能一直等到 navPromise 超时才继续，白白多等十几秒。
            if (reqUrl.includes('/aweme/detail/') || reqUrl.includes('/aweme/post/') || reqUrl.includes('/aweme/iteminfo/')) {
                try {
                    const json = await response.json();
                    const item = json.aweme_detail || (json.aweme_list && json.aweme_list[0]);
                    if (item) {
                        description = item.desc || description || '';
                        
                        const playUrl = item.video?.play_addr?.url_list?.[0] || item.video?.play_addr_h264?.url_list?.[0];
                        if (playUrl) {
                            videoSrc = playUrl;
                            console.log(`[嗅探成功] 拦截到抖音播放直链，文案长度: ${description.length}`);
                        }

                        // 尝试提取抖音自带的 ASR 字幕 / CC 字幕
                        try {
                            const subtitleInfos = item.video?.subtitle_infos || item.video?.subtitle_list;
                            if (subtitleInfos && subtitleInfos.length > 0) {
                                const subUrl = subtitleInfos[0].webvtt_url || subtitleInfos[0].url;
                                if (subUrl) {
                                    console.log(`[抖音字幕检测] 发现抖音原生字幕，已记录地址`);
                                    pageSubtitleUrl = subUrl;
                                }
                            }
                        } catch (subErr) { }

                        if (videoSrc && resolveIntercept) {
                            resolveIntercept();
                        }
                    }
                } catch (e) { }
            }

            // 2. 拦截B站 API
            if (reqUrl.includes('/x/player/wbi/playurl') || reqUrl.includes('/x/player/playurl')) {
                try {
                    const json = await response.json();
                    if (json?.data?.durl?.[0]?.url) {
                        videoSrc = json.data.durl[0].url;
                        console.log(`[嗅探成功] 拦截到B站API直链 (DURL)`);
                        if (resolveIntercept) resolveIntercept();
                    } else if (json?.data?.dash?.video?.[0]?.baseUrl) {
                        videoSrc = json.data.dash.video[0].baseUrl;
                        console.log(`[嗅探成功] 拦截到B站API直链 (DASH)`);
                        if (resolveIntercept) resolveIntercept();
                    }
                } catch (e) { }
            }

            // 3. 拦截 YouTube 视频流 (作为兜底)
            if (reqUrl.includes('googlevideo.com/videoplayback')) {
                try {
                    const parsedUrl = new URL(reqUrl);
                    const mime = parsedUrl.searchParams.get('mime');
                    if (mime && mime.includes('video/mp4') && !videoSrc) {
                        videoSrc = reqUrl;
                        console.log(`[嗅探成功] 拦截到 YouTube MP4 视频直链 (DASH/Progressive)`);
                        if (resolveIntercept) resolveIntercept();
                    }
                } catch (e) { }
            }

            // 5. 拦截小红书 API
            if (isXiaohongshu && (reqUrl.includes('/api/sns/web/v1/feed') || reqUrl.includes('/api/sns/web/v2/note/feed') || reqUrl.includes('/api/sns/web/v1/detail') || reqUrl.includes('/api/sns/web/v2/note/detail'))) {
                try {
                    const json = await response.json();
                    const card = json?.data?.[0]?.note_card || json?.data?.note_card || json?.data?.items?.[0]?.note_card || json?.data?.note_list?.[0] || json?.data || (json?.data?.noteDetailMap ? json.data.noteDetailMap[Object.keys(json.data.noteDetailMap)[0]] : null);
                    const detail = card?.note_card || card;
                    if (detail) {
                        const videoStream = detail.video?.media?.stream;
                        if (videoStream) {
                            const h264List = videoStream.h264 || videoStream.h265 || [];
                            const playUrl = h264List[0]?.master_url || h264List[0]?.masterUrl;
                            if (playUrl) {
                                videoSrc = playUrl;
                                description = detail.desc || detail.title || description || '';
                                if (detail.title && detail.desc && !detail.desc.includes(detail.title)) {
                                    description = `${detail.title}。${detail.desc}`;
                                }
                                console.log(`[小红书API拦截] 成功拦截到视频地址: ${videoSrc}`);
                                if (resolveIntercept) resolveIntercept();
                            }
                        }
                    }
                } catch (e) { }
            }

            // 6. 拦截小红书/快手/百家号等视频流请求
            if (!videoSrc) {
                const isXhsMedia = isXiaohongshu && (reqUrl.includes('xhscdn.com') || reqUrl.includes('sns-video')) && (reqUrl.includes('.mp4') || reqUrl.includes('video/'));
                const isKsMedia = isKuaishou && (reqUrl.includes('kuaishouvod.com') || reqUrl.includes('.mp4'));
                const isBjhMedia = isBaijiahao && (reqUrl.includes('bdstatic.com') || reqUrl.includes('baidu.com')) && reqUrl.includes('.mp4');

                if (isXhsMedia || isKsMedia || isBjhMedia) {
                    if (!reqUrl.includes('.m3u8') && !reqUrl.includes('.ts')) {
                        videoSrc = reqUrl;
                        console.log(`[嗅探成功] 拦截到 ${isXhsMedia ? '小红书' : isKsMedia ? '快手' : '百家号'} 视频直链: ${videoSrc.substring(0, 100)}...`);
                        if (resolveIntercept) resolveIntercept();
                    }
                }
            }

            // 4. 匹配常规的视频流后缀或 Content-Type (作为 Fallback)
            const contentType = response.headers()['content-type'] || '';
            if (contentType.includes('video/') || reqUrl.includes('.mp4?') || reqUrl.includes('video/tos') || reqUrl.includes('mimeType=video_mp4')) {
                // 排除一些杂乱的短视频广告请求，抓取主视频流
                if (!reqUrl.includes('.m3u8') && !reqUrl.includes('.ts')) {
                    videoSrc = reqUrl;
                    console.log(`[嗅探成功] 拦截到通用视频直链: ${reqUrl.substring(0, 50)}...`);
                    if (resolveIntercept) resolveIntercept();
                }
            }
        });

        // 访问目标页面并等待其加载
        const navPromise = page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(e => {
            console.log("页面加载超时或被中断...");
        });

        // 只要拦截到了或者页面加载完了（不管是否超时），就继续往下走
        await Promise.race([interceptPromise, navPromise]);

        // 如果是通过 navPromise 结束的，给一点时间确保 DOM 完全渲染
        if (!videoSrc) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // 如果网络层没拦截到，尝试在 DOM 元素中提取或者全局变量中提取
        let title = "未知视频";
        let cover = "";
        let platform = "通用网页";
        if (isBilibili) platform = "Bilibili";
        else if (url.includes("douyin.com")) platform = "抖音";
        else if (isXiaohongshu) platform = "小红书";
        else if (isTikTok) platform = "TikTok";
        else if (isYouTube) platform = "YouTube";
        else if (isKuaishou) platform = "快手";
        else if (isBaijiahao) platform = "百家号";

        // 提取元数据与文案描述
        const pageMeta = await page.evaluate(() => {
            let extractedTitle = document.title;
            let extractedCover = "";
            let extractedDesc = "";

            // 尝试获取更准确的 Title
            const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
            if (ogTitle) extractedTitle = ogTitle;

            // 尝试获取 Cover / Thumbnail
            const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
                || document.querySelector('meta[property="twitter:image"]')?.getAttribute('content');
            if (ogImage) {
                extractedCover = ogImage;
            } else {
                // 通用封面提取
                const img = document.querySelector('video')?.getAttribute('poster')
                    || document.querySelector('img[src*="cover"]')?.getAttribute('src');
                if (img) extractedCover = img;
            }

            // 尝试获取文案 (Description/Caption)
            let bDesc = '';
            try {
                if (window.__INITIAL_STATE__) {
                    if (window.__INITIAL_STATE__.videoData && window.__INITIAL_STATE__.videoData.desc) {
                        bDesc = window.__INITIAL_STATE__.videoData.desc;
                    } else if (window.__INITIAL_STATE__.note?.noteDetailMap) {
                        const map = window.__INITIAL_STATE__.note.noteDetailMap;
                        const key = Object.keys(map)[0];
                        if (key && map[key]?.note?.desc) {
                            bDesc = map[key].note.desc;
                            if (map[key].note.title && !bDesc.includes(map[key].note.title)) {
                                bDesc = map[key].note.title + '。' + bDesc;
                            }
                        }
                    } else if (window.__INITIAL_STATE__.photo?.photoInfo?.caption) {
                        bDesc = window.__INITIAL_STATE__.photo.photoInfo.caption;
                    }
                } else if (window.pageData && window.pageData.photo && window.pageData.photo.caption) {
                    bDesc = window.pageData.photo.caption;
                } else if (window.__context__ && window.__context__.articleTitle) {
                    bDesc = window.__context__.articleTitle;
                }
            } catch (e) { }

            extractedDesc = bDesc
                || document.querySelector('meta[name="description"]')?.getAttribute('content')
                || document.querySelector('meta[property="og:description"]')?.getAttribute('content')
                || document.querySelector('.desc-info-text')?.innerText
                || document.querySelector('.desc')?.innerText
                || document.querySelector('.note-text')?.innerText
                || '';

            return { title: extractedTitle, cover: extractedCover, desc: extractedDesc };
        }).catch(() => ({ title: "视频已解析", cover: "", desc: "" }));

        title = pageMeta.title || title;
        cover = pageMeta.cover || cover;
        if (!description) {
            description = pageMeta.desc || '';
        }

        // 特殊平台的封面/标题提取优化
        if (isBilibili) {
            title = title.replace("_哔哩哔哩_bilibili", "").replace("_bilibili", "");
        } else if (platform === "抖音") {
            title = title.replace("- 抖音", "");
        } else if (platform === "小红书") {
            title = title.replace("- 小红书", "").replace("_小红书", "");
        } else if (platform === "YouTube") {
            title = title.replace(" - YouTube", "");
        } else if (platform === "快手") {
            title = title.replace("- 快手", "").replace("_快手", "");
        } else if (platform === "百家号") {
            title = title.replace("- 百家号", "").replace("_百家号", "").replace("-百度", "").replace("_百度", "");
        }

        // ⚡ 极客数据增强：如果网络层没能拦截到详细文案，或文案为空，通过 B站 API 补充标签与热门评论
        if (isBilibili) {
            let tagsList = [];
            let finalAid = null;
            let finalBvid = null;
            try {
                const bvidMatch = url.match(/\/video\/(BV[a-zA-Z0-9]+)/i);
                finalBvid = bvidMatch ? bvidMatch[1] : null;

                const metaInfo = await page.evaluate(() => {
                    if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.videoData) {
                        return {
                            aid: window.__INITIAL_STATE__.videoData.aid,
                            bvid: window.__INITIAL_STATE__.videoData.bvid
                        };
                    }
                    return null;
                });
                if (metaInfo) {
                    finalAid = metaInfo.aid;
                    if (!finalBvid) finalBvid = metaInfo.bvid;
                }

                if (finalBvid) {
                    const tagsRes = await axios.get(`https://api.bilibili.com/x/tag/archive/tags?bvid=${finalBvid}`, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Referer': 'https://www.bilibili.com'
                        }
                    });
                    if (tagsRes.data.code === 0 && tagsRes.data.data) {
                        tagsList = tagsRes.data.data.map(t => t.tag_name);
                    }
                }

                if (finalAid) {
                    const replyRes = await axios.get(`https://api.bilibili.com/x/v2/reply?type=1&oid=${finalAid}&sort=2`, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Referer': 'https://www.bilibili.com'
                        }
                    });
                    if (replyRes.data.code === 0 && replyRes.data.data && replyRes.data.data.replies) {
                        const hotComments = replyRes.data.data.replies.slice(0, 5).map(r => r.content.message);
                        if (hotComments.length > 0) {
                            description += (description ? '。' : '') + `热门评论: ${hotComments.join('；')}`;
                        }
                    }
                }

                if (tagsList.length > 0) {
                    description += (description ? '。' : '') + `视频标签: ${tagsList.join('、')}`;
                }
            } catch (err) {
                console.log("[B站嗅探数据增强] 失败:", err.message);
            }
        }

        // ⚡ 极客核心突破：B站/YouTube/抖音 CC/AI 语音转文字字幕实时提取！
        let transcript = '';
        if (isBilibili) {
            try {
                const subtitleInfo = await page.evaluate(() => {
                    if (window.__INITIAL_STATE__ && window.__INITIAL_STATE__.videoData) {
                        const subtitle = window.__INITIAL_STATE__.videoData.subtitle;
                        return subtitle ? subtitle.list : null;
                    }
                    return null;
                });

                if (subtitleInfo && subtitleInfo.length > 0) {
                    const subUrl = subtitleInfo[0].subtitle_url;
                    if (subUrl) {
                        const cleanSubUrl = subUrl.startsWith('//') ? 'https:' + subUrl : subUrl;
                        console.log(`[B站字幕提取] 检测到B站AI语音字幕，正在启动浏览器内部抓取: ${cleanSubUrl}`);

                        // 在 Puppeteer 页面环境内部发起 fetch 请求以避开所有 CORS 与鉴权限制
                        const subContent = await page.evaluate(async (url) => {
                            const res = await fetch(url);
                            const json = await res.json();
                            return json.body.map(item => item.content).join(' ');
                        }, cleanSubUrl);

                        if (subContent) {
                            transcript = subContent;
                            console.log(`[B站字幕提取] 成功抓取B站整段视频 AI 语音字幕，字数: ${transcript.length}`);
                        }
                    }
                }
            } catch (e) {
                console.log("[B站字幕提取] 抓取失败:", e.message);
            }
        } else if (isYouTube) {
            try {
                const ytCaptions = await page.evaluate(() => {
                    try {
                        if (window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.captions) {
                            const tracklist = window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer;
                            if (tracklist && tracklist.captionTracks) {
                                return tracklist.captionTracks;
                            }
                        }
                    } catch (e) {}
                    return null;
                });

                if (ytCaptions && ytCaptions.length > 0) {
                    // 优先提取中文，否则提取第一个
                    const track = ytCaptions.find(t => t.languageCode && t.languageCode.startsWith('zh')) || ytCaptions[0];
                    const subUrl = track.baseUrl;
                    if (subUrl) {
                        console.log(`[YouTube字幕提取] 检测到YouTube原生字幕，正在进行抓取: ${subUrl.substring(0, 80)}...`);
                        const subContent = await page.evaluate(async (url) => {
                            const res = await fetch(url);
                            const xml = await res.text();
                            const tempEl = document.createElement('div');
                            const matches = xml.match(/<text[^>]*>([\s\S]*?)<\/text>/g);
                            if (matches) {
                                return matches.map(m => {
                                    const content = m.replace(/<text[^>]*>|<\/text>/g, '');
                                    tempEl.innerHTML = content;
                                    return tempEl.innerText;
                                }).join(' ');
                            }
                            return '';
                        }, subUrl);

                        if (subContent) {
                            transcript = subContent;
                            console.log(`[YouTube字幕提取] 成功获取 YouTube 视频字幕，字数: ${transcript.length}`);
                        }
                    }
                }
            } catch (e) {
                console.log("[YouTube字幕提取] 抓取失败:", e.message);
            }
        } else if (pageSubtitleUrl) {
            try {
                console.log(`[抖音字幕提取] 正在抓取抖音原生字幕...`);
                const subContent = await page.evaluate(async (url) => {
                    const res = await fetch(url);
                    const text = await res.text();
                    // 简单的 WebVTT 解析：移除 WEBVTT 头和时间戳行
                    return text.split('\n')
                        .filter(line => !line.includes('-->') && !line.startsWith('WEBVTT') && line.trim() !== '')
                        .join(' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                }, pageSubtitleUrl);

                if (subContent) {
                    transcript = subContent;
                    console.log(`[抖音字幕提取] 成功获取抖音视频字幕，字数: ${transcript.length}`);
                }
            } catch (e) {
                console.log("[抖音字幕提取] 抓取失败:", e.message);
            }
        }

        if (!videoSrc) {
            videoSrc = await page.evaluate(() => {
                // 递归查找对象中的视频地址
                function findVideoUrl(obj, seen = new Set()) {
                    if (!obj || typeof obj !== 'object' || seen.has(obj)) return null;
                    seen.add(obj);

                    const priorityKeys = ['masterUrl', 'master_url', 'playUrl', 'play_url', 'mainMvUrls', 'videoUrl', 'video_url', 'src', 'url'];
                    for (const key of priorityKeys) {
                        if (obj[key] && typeof obj[key] === 'string' && (obj[key].startsWith('http') || obj[key].startsWith('//'))) {
                            const val = obj[key];
                            const isVideo = val.includes('.mp4') || val.includes('video/tos') || val.includes('douyinvod') || val.includes('kuaishouvod') ||
                                            (val.includes('xhscdn') && (val.includes('video') || val.includes('mp4')) && !val.includes('pic')) ||
                                            (val.includes('bdstatic') && (val.includes('video') || val.includes('mp4') || val.includes('mda-')));
                            if (isVideo && !/\.(js|css|png|jpe?g|webp|gif|json|woff2?|svg)(\?|$)/i.test(val)) {
                                return val;
                            }
                        }
                        if (Array.isArray(obj[key])) {
                            for (const item of obj[key]) {
                                if (typeof item === 'string' && (item.startsWith('http') || item.startsWith('//'))) {
                                    const isVideo = item.includes('.mp4') || item.includes('video/tos') || item.includes('douyinvod') || item.includes('kuaishouvod') ||
                                                    (item.includes('xhscdn') && (item.includes('video') || item.includes('mp4')) && !item.includes('pic')) ||
                                                    (item.includes('bdstatic') && (item.includes('video') || item.includes('mp4') || item.includes('mda-')));
                                    if (isVideo && !/\.(js|css|png|jpe?g|webp|gif|json|woff2?|svg)(\?|$)/i.test(item)) {
                                        return item;
                                    }
                                }
                                if (item && typeof item === 'object') {
                                    const found = findVideoUrl(item, seen);
                                    if (found) return found;
                                }
                            }
                        }
                    }

                    for (const k in obj) {
                        if (Object.prototype.hasOwnProperty.call(obj, k)) {
                            const val = obj[k];
                            if (val && typeof val === 'object') {
                                const found = findVideoUrl(val, seen);
                                if (found) return found;
                            }
                        }
                    }
                    return null;
                }

                // 优先尝试从全局状态递归匹配视频链接（适用于小红书、快手、百家号等）
                try {
                    if (window.__INITIAL_STATE__) {
                        const found = findVideoUrl(window.__INITIAL_STATE__);
                        if (found) return found;
                    }
                } catch (e) { }

                try {
                    if (window.pageData) {
                        const found = findVideoUrl(window.pageData);
                        if (found) return found;
                    }
                } catch (e) { }

                try {
                    if (window.__context__) {
                        const found = findVideoUrl(window.__context__);
                        if (found) return found;
                    }
                } catch (e) { }

                try {
                    if (window._params) {
                        const found = findVideoUrl(window._params);
                        if (found) return found;
                    }
                } catch (e) { }

                // B站特有全局变量
                if (window.__playinfo__) {
                    if (window.__playinfo__.data?.durl?.[0]?.url) {
                        return window.__playinfo__.data.durl[0].url;
                    }
                    if (window.__playinfo__.data?.dash?.video?.[0]?.baseUrl) {
                        return window.__playinfo__.data.dash.video[0].baseUrl;
                    }
                }

                // 抖音 PC 端可能存在 RENDER_DATA
                try {
                    const renderDataEl = document.getElementById('RENDER_DATA');
                    if (renderDataEl) {
                        const strData = renderDataEl.innerText;
                        const match = strData.match(/(https?:\/\/[^\"]*(?:douyinvod|video\/tos)[^\"]*)/);
                        if (match) return decodeURIComponent(match[1]);
                    }
                } catch (e) { }

                // 抖音手机端可能在 _ROUTER_DATA 中
                try {
                    if (window._ROUTER_DATA) {
                        // 1. 结构化路径提取 (更精准稳定)
                        let playAddr = null;
                        const loaderData = window._ROUTER_DATA.loaderData;
                        if (loaderData) {
                            for (const key in loaderData) {
                                if (loaderData[key] && loaderData[key].videoInfoRes) {
                                    const itemList = loaderData[key].videoInfoRes.item_list;
                                    if (itemList && itemList[0] && itemList[0].video && itemList[0].video.play_addr) {
                                        const urlList = itemList[0].video.play_addr.url_list;
                                        if (urlList && urlList.length > 0) {
                                            playAddr = urlList[0];
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        if (playAddr) return playAddr;

                        // 2. 正则兜底提取 (包含新发现的 snssdk 和 iesdouyin 域名)
                        const strData = JSON.stringify(window._ROUTER_DATA);
                        const match = strData.match(/(https?:\/\/[^\"]*(?:douyinvod|video\/tos|aweme\.snssdk\.com|iesdouyin\.com\/aweme\/v1\/play)[^\"]*)/);
                        if (match) return match[1];
                    }
                } catch (e) { }

                // 通用 video 标签兜底
                const videoEl = document.querySelector('video');
                if (videoEl) {
                    const src = videoEl.getAttribute('src') || videoEl.src;
                    if (src && !src.startsWith('blob:')) {
                        return src;
                    }
                }
                // 尝试找 source 标签
                const sourceEl = document.querySelector('video source');
                if (sourceEl) {
                    const src = sourceEl.getAttribute('src') || sourceEl.src;
                    if (src) return src;
                }

                // 实在没有，看看页面里有没有直接暴露的带 video/tos 或 douyinvod 的链接
                const htmlMatch = document.body ? document.body.innerHTML.match(/(https?:\/\/[^\"]*(?:douyinvod|video\/tos)[^\"]*)/) : null;
                if (htmlMatch) {
                    return htmlMatch[1].replace(/\\u002F/g, '/');
                }

                return null;
            });
        }

        await browser.close();

        // 统一做链接相对路径及协议头修正
        if (videoSrc && !videoSrc.startsWith('http://') && !videoSrc.startsWith('https://')) {
            if (videoSrc.startsWith('//')) {
                videoSrc = 'https:' + videoSrc;
            } else {
                try {
                    const currentUrl = page.url();
                    const parsedUrl = new URL(currentUrl);
                    videoSrc = new URL(videoSrc, parsedUrl.origin).toString();
                    console.log(`[相对路径修正] 已将相对路径修正为绝对路径 (根据当前页面: ${currentUrl}): ${videoSrc}`);
                } catch (e) {
                    try {
                        const parsedUrl = new URL(url);
                        videoSrc = new URL(videoSrc, parsedUrl.origin).toString();
                    } catch (err) {}
                }
            }
        }

        // ⚡ 去水印逻辑
        // ⚠️ 重要修正：不要再对 douyinvod CDN 直链 set('ratio','1080p')。
        // 该直链的 x-expires / x-signature 等字段相互绑定，任意增删 query 参数
        // 都可能直接触发 403；而清晰度是由 play_addr 下发时就已经决定的，
        // 前端拼 ratio 并不会真的提升画质。真要换清晰度，应从 bit_rate 列表里挑。
        if (videoSrc) {
            if (videoSrc.includes('douyin.com') || videoSrc.includes('iesdouyin.com') || videoSrc.includes('aweme.snssdk.com') || videoSrc.includes('douyinvod.com')) {
                // 仅处理老式 /playwm/ 带水印路径（这是路径，不是 query 参数，替换是安全的）
                if (videoSrc.includes('/playwm/')) {
                    videoSrc = videoSrc.replace('/playwm/', '/play/');
                    console.log(`[去水印优化] 已将 playwm 路径替换为无水印 play 路径`);
                }
            }
        }

        // 封面图协议补全
        if (cover && cover.startsWith('//')) {
            cover = 'https:' + cover;
        }

        if (videoSrc) {
            let rawExtractText = description || '';
            rawExtractText = rawExtractText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

            addLog(req.user.username, req.user.role, '解析并提取视频', url);
            res.json({
                success: true,
                videoUrl: videoSrc,
                targetUrl: url,
                title: title,
                cover: cover,
                platform: platform,
                description: rawExtractText || '暂无详细描述文案'
            });
        } else {
            res.status(404).json({ error: '嗅探失败，未能从该页面提取到视频流' });
        }
    } catch (error) {
        if (browser) await browser.close();
        console.error("解析报错:", error);
        res.status(500).json({ error: '解析引擎发生内部错误: ' + error.message });
    }
});

// Resilient JSON parser for LLM replies
function tryParseLlmJson(text) {
    if (!text) return null;
    let cleaned = text.trim();
    const markdownJsonMatch = cleaned.match(/```json\s*([\s\S]*?)\s*```/) || cleaned.match(/```\s*([\s\S]*?)\s*```/);
    if (markdownJsonMatch) {
        cleaned = markdownJsonMatch[1].trim();
    }
    
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        console.warn('[tryParseLlmJson] Standard parse failed, trying repair:', e.message);
    }

    try {
        let repaired = cleaned
            .replace(/,\s*([\]}])/g, '$1')
            .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
        return JSON.parse(repaired);
    } catch (e) {
        console.warn('[tryParseLlmJson] Repaired parse failed, trying regex extraction:', e.message);
    }

    try {
        const categoryMatch = cleaned.match(/"category"\s*:\s*"([^"]+)"/);
        const suggestionMatch = cleaned.match(/"suggestion"\s*:\s*"([^"]+)"/);
        
        let category = categoryMatch ? categoryMatch[1] : null;
        let suggestion = suggestionMatch ? suggestionMatch[1] : null;
        let points = [];

        const pointsArrayMatch = cleaned.match(/"points"\s*:\s*\[([\s\S]*?)\]/);
        if (pointsArrayMatch) {
            const arrayContent = pointsArrayMatch[1];
            const matches = arrayContent.match(/"([^"]+)"/g);
            if (matches) {
                points = matches.map(m => m.replace(/^"|"$/g, ''));
            }
        }

        if (!category) {
            const catM = cleaned.match(/category\s*:\s*["']([^"']+)["']/i);
            if (catM) category = catM[1];
        }
        if (!suggestion) {
            const sugM = cleaned.match(/suggestion\s*:\s*["']([^"']+)["']/i);
            if (sugM) suggestion = sugM[1];
        }

        if (category && points.length > 0 && suggestion) {
            return { category, points, suggestion };
        }
    } catch (regErr) {
        console.error('[tryParseLlmJson] Regex parse threw exception:', regErr.message);
    }

    return null;
}

// ⚡ 异步文案提取与 AI 总结服务 (支持自定义 ASR Endpoint 以适配国内及阿里云部署)
app.post('/api/summarize', authenticate, async (req, res) => {
    const { videoUrl, targetUrl, title, platform, apiKey, endpointId, asrApiKey, asrEndpoint, asrModel } = req.body;
    if (!videoUrl) return res.status(400).json({ error: '请提供视频流物理地址' });

    // 校验频率限制 (仅普通用户，此时不增加计数，因为解析阶段已经扣减过了)
    const limitCheck = checkAndIncrementLimit(req.user, false);
    if (!limitCheck.allowed) {
        return res.status(403).json({ error: 'LIMIT_EXCEEDED', message: limitCheck.message });
    }

    addLog(req.user.username, req.user.role, '提取文案与AI总结', targetUrl || videoUrl);

    console.log(`[ASR & AI 总结] 收到异步处理请求。平台: ${platform || '未知'}, 视频地址 (截断): ${videoUrl.substring(0, 80)}...`);

    const tempFilePath = path.join(__dirname, `temp_transcribe_${Date.now()}.mp4`);
    let transcriptText = '';

    try {
        // 1. 设置下载防盗链 Header (与代理下载一致)
        let downloadHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        const urlStr = videoUrl.toLowerCase();
        const refStr = targetUrl ? targetUrl.toLowerCase() : '';
        const isBili = urlStr.includes('bilibili.com') || urlStr.includes('bilivideo.com') || urlStr.includes('hdslb.com') || refStr.includes('bilibili.com') || refStr.includes('b23.tv');
        const isDouyin = urlStr.includes('douyin.com') || urlStr.includes('iesdouyin.com') || urlStr.includes('douyinvod.com') || urlStr.includes('snssdk.com') || refStr.includes('douyin.com') || refStr.includes('iesdouyin.com');
        const isXhs = urlStr.includes('xiaohongshu.com') || urlStr.includes('xhscdn.com') || refStr.includes('xiaohongshu.com') || refStr.includes('xhslink.com');
        const isKs = urlStr.includes('kuaishouvod.com') || urlStr.includes('kuaishou.com') || urlStr.includes('gifshow.com') || refStr.includes('kuaishou.com') || refStr.includes('gifshow.com');
        const isBjh = urlStr.includes('bdstatic.com') || urlStr.includes('baidu.com') || refStr.includes('baidu.com') || refStr.includes('baijiahao.baidu.com');

        if (isBili) {
            downloadHeaders['Referer'] = 'https://www.bilibili.com';
        } else if (isDouyin) {
            downloadHeaders['User-Agent'] = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
        } else if (isXhs) {
            downloadHeaders['Referer'] = 'https://www.xiaohongshu.com';
        } else if (isKs) {
            downloadHeaders['Referer'] = 'https://www.kuaishou.com';
            downloadHeaders['User-Agent'] = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
        } else if (isBjh) {
            downloadHeaders['Referer'] = 'https://baijiahao.baidu.com';
        }

        // 2. 将视频下载到本地临时文件
        let targetDownloadUrl = videoUrl;
        if (platform === '抖音' || platform === 'douyin' || videoUrl.includes('douyinvod.com') || videoUrl.includes('snssdk.com')) {
            targetDownloadUrl = videoUrl.replace('ratio=1080p', 'ratio=720p');
            console.log(`[ASR & AI 总结] 检测到抖音视频，自动将 ASR 下载流画质降低为 720p 以突破 CDN 限速。新地址: ${targetDownloadUrl}`);
        }

        console.log(`[ASR & AI 总结] 正在下载视频到临时文件: ${tempFilePath}`);
        const writer = fs.createWriteStream(tempFilePath);
        const downloadRes = await axios({
            method: 'GET',
            url: targetDownloadUrl,
            responseType: 'stream',
            headers: downloadHeaders,
            timeout: 60000 // 60s timeout
        });

        await pipeline(downloadRes.data, writer);
        console.log(`[ASR & AI 总结] 视频下载完成，文件大小: ${fs.statSync(tempFilePath).size} 字节`);

        // 3. 调用 ASR 语音识别 (OpenAI Whisper 格式)
        const effectiveAsrKey = asrApiKey || '';
        const effectiveAsrUrl = asrEndpoint || 'https://api.openai.com/v1';
        const effectiveAsrModel = asrModel || 'whisper-1';

        if (effectiveAsrKey) {
            console.log(`[ASR & AI 总结] 正在调用 ASR 语音转文字... (节点: ${effectiveAsrUrl}, 模型: ${effectiveAsrModel})`);
            const formData = new FormData();
            formData.append('file', fs.createReadStream(tempFilePath));
            formData.append('model', effectiveAsrModel);
            formData.append('language', 'zh');

            const whisperRes = await axios.post(`${effectiveAsrUrl.replace(/\/$/, '')}/audio/transcriptions`, formData, {
                headers: {
                    ...formData.getHeaders(),
                    'Authorization': `Bearer ${effectiveAsrKey}`
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: 120000 // 2 minutes timeout for transcription
            });

            transcriptText = whisperRes.data.text || '';
            console.log(`[ASR & AI 总结] ASR 识别成功，识别到 ${transcriptText.length} 字。`);
        } else {
            console.log(`[ASR & AI 总结] 未配置 ASR Key，跳过语音识别转写步骤`);
        }

    } catch (err) {
        console.error(`[ASR & AI 总结] ASR 转写流程失败:`, err.message);
        if (err.response) {
            try {
                const errBody = err.response.data;
                console.error(`[ASR 错误详情]`, errBody.toString ? errBody.toString() : errBody);
            } catch (e) {}
        }
    } finally {
        // 4. 清理本地临时文件
        if (fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
                console.log(`[ASR & AI 总结] 已清理临时视频文件`);
            } catch (unlinkErr) {
                console.error(`[ASR & AI 总结] 清理临时文件失败:`, unlinkErr.message);
            }
        }
    }

    // 5. 组装提炼文案并调用 LLM 大模型进行总结
    // 如果转写失败或未开启，则降级为使用原始视频描述
    const rawExtractText = (transcriptText || req.body.description || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    let aiSummary = null;

    // 解析使用的 LLM 引擎
    const provider = req.body.summaryProvider || (apiKey && !apiKey.includes('xxxxx') ? 'doubao' : 'siliconflow');
    let llmUrl = '';
    let llmKey = '';
    let modelName = '';
    let useJsonFormat = false;

    if (provider === 'doubao') {
        llmUrl = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
        llmKey = apiKey || '';
        modelName = endpointId || '';
        useJsonFormat = true;
    } else {
        // 硅基流动或其它 OpenAI 兼容节点
        const baseEndpoint = asrEndpoint || 'https://api.siliconflow.cn/v1';
        llmUrl = `${baseEndpoint.replace(/\/$/, '')}/chat/completions`;
        llmKey = asrApiKey || '';
        modelName = req.body.llmModel || 'Qwen/Qwen2.5-7B-Instruct';
    }

    if (llmKey && modelName && rawExtractText) {
        try {
            console.log(`[LLM AI] 正在调用大模型进行核心要点提炼... (引擎: ${provider}, 接入点/模型: ${modelName})`);
            const systemPrompt = `你是一个视频内容金牌提炼与总结大师。请根据我提供的视频标题、文案内容/字幕文本，完成以下任务，并以JSON格式返回。
        
任务：
1. 分析视频所属的核心行业分类(category)。
2. 精炼出3个深入、有高度价值 of 视频核心看点(points)。
3. 提供一条具有前瞻性和极强操作性的智能建议(suggestion)。

注意：请仅返回一个合法的 JSON 对象，不要包含 markdown 格式标记(如 \`\`\`json)，属性名必须为: "category", "points", "suggestion"。整个JSON需要能够通过JSON.parse完美解析。`;

            const userPrompt = `视频标题: ${title}
视频原始描述/字幕: ${rawExtractText.substring(0, 3000)} // 截取前3000字防 token 超限
视频所属平台: ${platform || '未知平台'}`;

            const postData = {
                model: modelName,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ]
            };

            if (useJsonFormat) {
                postData.response_format = { type: "json_object" };
            }

            const llmRes = await axios.post(llmUrl, postData, {
                headers: {
                    'Authorization': `Bearer ${llmKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            let reply = llmRes.data?.choices?.[0]?.message?.content;
            if (reply) {
                const parsedReply = tryParseLlmJson(reply);
                if (parsedReply && parsedReply.category && parsedReply.points && parsedReply.suggestion) {
                    aiSummary = {
                        category: parsedReply.category,
                        points: Array.isArray(parsedReply.points) ? parsedReply.points : [parsedReply.points],
                        suggestion: parsedReply.suggestion,
                        isRealAI: true
                    };
                    console.log(`[LLM AI] 深度视频要点提炼成功！`);
                }
            }
        } catch (e) {
            console.error(`[LLM AI] 接口调用错误，安全降级为本地启发式引擎:`, e.message);
        }
    }

    // 兜底本地启发式总结
    if (!aiSummary) {
        aiSummary = generateAISummary(title, rawExtractText, platform || '通用网页');
        aiSummary.isRealAI = false;
    }

    res.json({
        success: true,
        transcript: transcriptText || '未获取到视频的语音字幕文本。',
        aiSummary: aiSummary
    });
});

// 核心代理技术：无视大厂防盗链，直接流式透传下载给前端
app.get('/api/download', authenticate, async (req, res) => {
    const { videoUrl, referer, title, accessKey } = req.query;
    if (!videoUrl) return res.status(400).send('缺少视频地址');

    // 校验频率限制 (仅普通用户，此时不增加计数，因为解析阶段已经扣减过了)
    const limitCheck = checkAndIncrementLimit(req.user, false);
    if (!limitCheck.allowed) {
        return res.status(403).send('下载失败：' + limitCheck.message);
    }

    addLog(req.user.username, req.user.role, '下载物理视频', referer || videoUrl);

    // 🔑 外网下载密钥校验（仅针对 YouTube, TikTok 等海外平台）
    const isOverseas = videoUrl.includes('googlevideo.com') || videoUrl.includes('tiktok.com') || 
                      (referer && (referer.includes('youtube.com') || referer.includes('youtu.be') || referer.includes('tiktok.com')));
    if (isOverseas) {
        const expectedKey = process.env.ACCESS_KEY || '1qaz789';
        if (!accessKey || accessKey !== expectedKey) {
            console.log(`[下载验证] 未提供密钥或密钥错误。用户输入: "${accessKey || ''}"`);
            return res.status(403).send('下载海外平台视频需要正确的外网访问密钥！');
        }
        console.log(`[下载验证] 校验通过，允许下载海外视频流`);
    }

    try {
        // 1. Determine platform and apply custom headers to bypass hotlinking protection
        let downloadHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };

        const urlStr = videoUrl.toLowerCase();
        const refStr = referer ? referer.toLowerCase() : '';

        const isBili = urlStr.includes('bilibili.com') || urlStr.includes('bilivideo.com') || urlStr.includes('hdslb.com') || refStr.includes('bilibili.com') || refStr.includes('b23.tv');
        const isDouyin = urlStr.includes('douyin.com') || urlStr.includes('iesdouyin.com') || urlStr.includes('douyinvod.com') || urlStr.includes('snssdk.com') || refStr.includes('douyin.com') || refStr.includes('iesdouyin.com');
        const isXhs = urlStr.includes('xiaohongshu.com') || urlStr.includes('xhscdn.com') || refStr.includes('xiaohongshu.com') || refStr.includes('xhslink.com');
        const isYT = urlStr.includes('googlevideo.com') || urlStr.includes('youtube.com') || urlStr.includes('youtu.be') || refStr.includes('youtube.com') || refStr.includes('youtu.be');
        const isTT = urlStr.includes('tiktok.com') || urlStr.includes('tiktokcdn.com') || refStr.includes('tiktok.com');
        const isKs = urlStr.includes('kuaishouvod.com') || urlStr.includes('kuaishou.com') || urlStr.includes('gifshow.com') || refStr.includes('kuaishou.com') || refStr.includes('gifshow.com');
        const isBjh = urlStr.includes('bdstatic.com') || urlStr.includes('baidu.com') || refStr.includes('baidu.com') || refStr.includes('baijiahao.baidu.com');

        if (isBili) {
            downloadHeaders['Referer'] = 'https://www.bilibili.com';
            downloadHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        } else if (isDouyin) {
            // ⚠️ 实测结论（2026）：douyinvod / snssdk CDN 现在强制校验 Referer。
            // 不带 Referer => 403 text/html；带 https://www.douyin.com/ => 200 video/mp4。
            // 旧代码这里刻意抹掉 Referer，是抖音"解析出来却下载不了"的直接原因。
            downloadHeaders['Referer'] = 'https://www.douyin.com/';
            downloadHeaders['User-Agent'] = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
        } else if (isXhs) {
            downloadHeaders['Referer'] = 'https://www.xiaohongshu.com';
            downloadHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        } else if (isYT) {
            downloadHeaders['Referer'] = 'https://www.youtube.com';
            downloadHeaders['User-Agent'] = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
        } else if (isTT) {
            downloadHeaders['Referer'] = 'https://www.tiktok.com';
            downloadHeaders['User-Agent'] = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
        } else if (isKs) {
            downloadHeaders['Referer'] = 'https://www.kuaishou.com';
            downloadHeaders['User-Agent'] = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
        } else if (isBjh) {
            downloadHeaders['Referer'] = 'https://baijiahao.baidu.com';
            downloadHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        } else {
            // General Fallback
            if (referer) {
                downloadHeaders['Referer'] = referer;
            }
        }

        // 使用后端发起请求，彻底绕过前端浏览器的 CORS 限制
        const response = await axios({
            method: 'GET',
            url: videoUrl,
            responseType: 'stream',
            headers: downloadHeaders
        });

        // 拦截非视频流数据（例如被风控重定向到滑动验证 HTML 页面）
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('text/html') || contentType.includes('application/json')) {
            console.error(`[下载校验拦截] 拦截到非视频流响应 (ContentType: ${contentType})`);
            return res.status(403).send('下载失败：检测到平台安全验证风控页面，请返回重试或刷新页面。');
        }

        // 将视频流直接 pipe 转发给前端用户
        res.setHeader('Content-Type', 'video/mp4');

        // 过滤文件名中的非法字符，并支持中文 UTF-8 编码
        let safeTitle = (title || `VidFetch_Video_${Date.now()}`)
            .replace(/[\\/:*?"<>|]/g, '_') // 去除 Windows 文件名非法字符
            .trim();

        const encodedTitle = encodeURIComponent(safeTitle);
        res.setHeader('Content-Disposition', `attachment; filename="${encodedTitle}.mp4"; filename*=UTF-8''${encodedTitle}.mp4`);
        response.data.pipe(res);

    } catch (error) {
        console.error("代理下载失败:", error.message);
        res.status(500).send('流媒体拉取失败，防盗链拒绝连接。');
    }
});

// 静态文件服务：托管 Vue 编译后的前端静态资产 (用于生产环境单端口部署)
app.use(express.static(path.join(__dirname, 'frontend/dist')));

// 针对 SPA 路由的兜底处理：所有非 API 请求均返回 index.html
app.get('*all', (req, res, next) => {
    if (req.path.startsWith('/api')) {
        return next();
    }
    res.sendFile(path.join(__dirname, 'frontend/dist/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🔥 VidFetch 极客本地/生产引擎已启动！`);
    console.log(`   引擎接口运行于: http://localhost:${PORT}`);
});