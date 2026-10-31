'use strict';

/**
 * Badge 统一身份中心 SSO 客户端。
 * 流程：浏览器跳转 Badge 登录 → Badge 带一次性票据回到 /auth/badge/callback
 * → 这里服务端对服务端换票 → 映射/创建本站账号 → 建立本站会话。
 * Client Secret 只存在本服务端，绝不进入前端。
 */

const crypto = require('crypto');
const axios = require('axios');

const BADGE_URL = (process.env.BADGE_URL || 'http://localhost:8080').replace(/\/$/, '');
// 浏览器侧登录页在 Badge 门户（前端）上；API 只提供服务。
// 开发态门户是 Vite 5173；生产两者分别是门户域名与 API 域名。
const BADGE_PORTAL_URL = (process.env.BADGE_PORTAL_URL || 'http://localhost:5173').replace(/\/$/, '');
const CLIENT_ID = process.env.BADGE_CLIENT_ID || 'app_hotpot_video';
const CLIENT_SECRET = process.env.BADGE_CLIENT_SECRET || 'sec_hotpot_video_secret_2026';
const PUBLIC_URL = (process.env.HOTPOT_PUBLIC_URL || 'http://localhost:4000').replace(/\/$/, '');
const CALLBACK_PATH = '/auth/badge/callback';

function configured() {
    return Boolean(process.env.BADGE_CLIENT_SECRET || process.env.BADGE_URL);
}

/** 子应用发起登录的入口地址（浏览器 302 目标 = Badge 门户登录页）。state 原样透传，回调时校验。 */
function loginUrl(state) {
    const redirectUri = encodeURIComponent(PUBLIC_URL + CALLBACK_PATH);
    let url = BADGE_PORTAL_URL + '/login?client_id=' + encodeURIComponent(CLIENT_ID) + '&redirect_uri=' + redirectUri;
    if (state) url += '&state=' + encodeURIComponent(state);
    return url;
}

/** 服务端对服务端：票据 + 密钥换取身份。 */
async function exchangeTicket(ticket) {
    const response = await axios.post(BADGE_URL + '/api/sso/token', {
        ticket, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
    }, { timeout: 8000, proxy: false, maxContentLength: 1024 * 1024 });
    const body = response.data;
    if (!body || body.code !== 200 || !body.data || !body.data.user) {
        throw new Error((body && body.message) || 'Badge 换票响应无效');
    }
    return body.data;
}

/**
 * 把 Badge 身份映射为本站账号：
 * 本地名 = badge_<Badge用户ID>_<用户名>，与本地注册的账号命名空间隔离，不会互相顶号。
 * 首次登录自动创建（随机密码，用户永不使用），此后复用同一账号，历史与额度连续。
 */
function mapBadgeRole(badgeRole) {
    const r = String(badgeRole || '').trim().toUpperCase();
    if (r === 'SUPER_VIP' || r === 'SUPERVIP') return 'supervip';
    if (r === 'VIP') return 'vip';
    if (r === 'ADMIN' || r === 'OPERATOR') return 'admin';
    if (r === 'PRO') return 'pro';
    return 'user';
}

async function ensureLocalUser(badgeUser) {
    const accounts = require('./accounts');
    const rawName = String(badgeUser.username || 'user');
    const safeName = rawName.replace(/[^\p{L}\p{N}_.@+-]/gu, '_').slice(0, 48);
    const localName = ('badge_' + badgeUser.userId + '_' + safeName).slice(0, 64);
    const mappedRole = mapBadgeRole(badgeUser.appRole);

    const db = accounts.store.read();
    const existing = db.users.find(u => u.username.toLowerCase() === localName.toLowerCase());
    if (existing && !existing.disabled) {
        accounts.store.updateUser(localName, {
            role: mappedRole,
            nickname: badgeUser.appNickname || rawName,
            badgeMetadata: badgeUser.appMetadata || null
        });
        return existing.username;
    }

    const user = await accounts.store.register({
        username: localName,
        password: crypto.randomBytes(24).toString('hex'),
        nickname: badgeUser.appNickname || rawName,
    }, mappedRole);
    if (badgeUser.appMetadata) {
        accounts.store.updateUser(localName, { badgeMetadata: badgeUser.appMetadata });
    }
    return user.username;
}

/** 回调页一次性状态 Cookie，防登录 CSRF。 */
function createState() { return crypto.randomBytes(16).toString('hex'); }
function validState(expected, got) {
    if (!expected || !got || expected.length !== got.length) return false;
    try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got)); } catch { return false; }
}

module.exports = { configured, loginUrl, exchangeTicket, ensureLocalUser, createState, validState, CLIENT_ID, BADGE_URL, BADGE_PORTAL_URL, CALLBACK_PATH };
