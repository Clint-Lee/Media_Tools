'use strict';
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const sources = require('../lib/live-sources');
const sessions = require('../lib/platform-session');
const originalLaunch = puppeteer.launch, originalCookies = sessions.browserCookies;
(async () => {
    let contexts = 0, pages = 0, closed = 0, personalCookies = 0;
    puppeteer.launch = async () => ({ on() {}, close: async () => {}, createBrowserContext: async () => {
        const contextId = ++contexts;
        return { close: async () => { closed++; }, newPage: async () => ({ contextId, id: ++pages,
            setUserAgent: async () => {}, setViewport: async () => {}, setCookie: async () => { personalCookies++; }, close: async () => {} }) };
    } });
    sessions.browserCookies = () => [{ name: 'optional-personal-session', value: 'isolated' }];
    const first = await sources.withPage('xiaohongshu', async page => page, { anonymous: true });
    const second = await sources.withPage('xiaohongshu', async page => page, { anonymous: true });
    assert.equal(first.contextId, second.contextId, '匿名技术Cookie维持同一正常访客会话');
    assert.notEqual(first.id, second.id, '每个任务独立页面和监听器');
    assert.equal(personalCookies, 0, '匿名会话不能注入可选个人Cookie');
    const separate = await sources.withPage('douyin', async page => page, { anonymous: true });
    assert.notEqual(separate.contextId, first.contextId, '不同平台隔离匿名身份');
    const personal = await sources.withPage('xiaohongshu', async page => page);
    assert.notEqual(personal.contextId, first.contextId);
    assert.equal(personalCookies, 1); assert.equal(closed, 1);
    await assert.rejects(() => sources.withPage('xiaohongshu', async () => { throw new Error('captcha fixture'); }, { anonymous: true }), /captcha/);
    const afterFailure = await sources.withPage('xiaohongshu', async page => page, { anonymous: true });
    assert.equal(afterFailure.contextId, first.contextId, '受限后不得重置身份绕过验证');
    const tag=await sources.withPage('tiktok',async page=>page,{anonymous:true});
    const creative=await sources.withPage('tiktok',async page=>page,{anonymous:true});
    assert.notEqual(tag.contextId,creative.contextId,'TikTok并行多来源必须保持原有独立技术会话');
    await sources.closeBrowser();
    const restarted = await sources.withPage('xiaohongshu', async page => page, { anonymous: true });
    assert.notEqual(restarted.contextId, first.contextId, '服务关闭后不持久化匿名Cookie');
    console.log('Anonymous browser context isolation, technical-cookie continuity and no challenge reset passed');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    await sources.closeBrowser(); puppeteer.launch = originalLaunch; sessions.browserCookies = originalCookies;
});
