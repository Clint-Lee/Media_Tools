'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

async function run() {
    const puppeteer = require('puppeteer'), sessions = require('../lib/platform-session');
    const sources = require('../lib/live-sources');
    const tiktok = require('../lib/tiktok-views'), douyin = require('../lib/douyin-views');
    const originalLaunch = puppeteer.launch, originalCookies = sessions.browserCookies;
    let opened = 0, active = 0, peak = 0, personal = 0, hang = false;
    const pageFor = () => {
        const page = new EventEmitter(); let url = '', closed = false;
        page.setUserAgent = page.setViewport = async () => {};
        page.setCookie = async () => { personal++; };
        page.goto = async target => { url = target; };
        page.close = async () => { if (!closed) { closed = true; active--; } };
        page.evaluate = async (fn, args) => {
            assert.ok(url.startsWith('https://'), '默认生产客户端必须先正常进入原站页面');
            if (hang) return new Promise(() => {});
            const id = url.split('/').pop();
            if (url.includes('tiktok')) return { '#__UNIVERSAL_DATA_FOR_REHYDRATION__': {
                __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: {
                    id, desc: 'isolated detail', stats: { playCount: 700, diggCount: 7 }
                } } } }
            } };
            assert.ok(args.paths.every(value => value.startsWith('/aweme/')), '抖音详情必须使用同源相对请求');
            return [{ status: 200, text: JSON.stringify({ aweme_detail: {
                aweme_id: id, video: {}, author: {}, statistics: { play_count: 800, digg_count: 8 }
            } }) }];
        };
        opened++; active++; peak = Math.max(peak, active); return page;
    };
    try {
        await sources.closeBrowser();
        sessions.browserCookies = () => { personal++; throw new Error('默认匿名详情不能读取个人Cookie'); };
        puppeteer.launch = async () => ({ on() {}, close: async () => {}, createBrowserContext: async () => {
            let page;
            return { newPage: async () => (page = pageFor()), close: async () => page?.close() };
        } });
        for (const [client, id, expected] of [[tiktok, '7123456789012345801', 700], [douyin, '7696121303677291801', 800]]) {
            const video = { id, title: 'fixture', playRaw: null, likeRaw: null, fetchedAt: 1 };
            await client.enrich([video, video]);
            const applied = client.apply([video])[0];
            assert.equal(applied.playRaw, expected, '默认单例必须接上真实withPage编排');
            assert.equal(applied.fetchedAt, 1, '详情计数不能刷新列表采集时间');
            assert.equal(client.status().pending, 0);
            const newer = client.apply([{ ...video, playRaw: 999, likeRaw: 99,
                viewsFetchedAt: applied.viewsFetchedAt + 1, likesFetchedAt: applied.likesFetchedAt + 1 }])[0];
            assert.equal(newer.playRaw, 999, '旧详情缓存不能覆盖较新播放');
            assert.equal(newer.likeRaw, 99, '旧详情缓存不能覆盖较新点赞');
            const withdrawn = client.apply([{ ...video, viewsFetchedAt: applied.viewsFetchedAt + 1,
                likesFetchedAt: applied.likesFetchedAt + 1 }])[0];
            assert.equal(withdrawn.playRaw, null, '明确更新的未知播放观测不能被旧详情复活');
            assert.equal(withdrawn.likeRaw, null, '明确更新的未知点赞观测不能被旧详情复活');
            assert.equal(withdrawn.viewsFetchedAt, applied.viewsFetchedAt + 1);
            assert.equal(withdrawn.likesFetchedAt, applied.likesFetchedAt + 1);
            const mixed = client.apply([{ ...video, viewsFetchedAt: applied.viewsFetchedAt + 1 }])[0];
            assert.equal(mixed.playRaw, null, '播放新鲜度独立保留');
            assert.equal(mixed.likeRaw, applied.likeRaw, '无点赞观测时间的未知值仍可由有效缓存补充');
            assert.equal(client.apply([{ ...video, fetchedAt: applied.viewsFetchedAt + 1 }])[0].viewsFetchedAt,
                applied.viewsFetchedAt, '未知计数可补缓存，但必须显示缓存原观测时间');
        }
        assert.equal(opened, 2, '同ID列表重复只开一个详情页');
        assert.equal(personal, 0); assert.equal(active, 0); assert.ok(peak <= 2);
        assert.equal(douyin.configured(), false, '默认不因服务级个人Cookie开启授权详情');
        hang = true;
        const bounded = tiktok.createClient({ budgetMs: 25 });
        await bounded.enrich(Array.from({ length: 4 }, (_, i) => ({ id: '712345678901234588' + i })));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(active, 0, '生产withPage必须在批次截止时关闭悬挂详情页');
        assert.equal(bounded.status().lastBatch.timedOut, true);
        assert.equal(bounded.status().lastBatch.skipped, 2);
    } finally {
        await sources.closeBrowser(); puppeteer.launch = originalLaunch; sessions.browserCookies = originalCookies;
    }

    let calls = 0, aborted = 0;
    const slow = tiktok.createClient({ budgetMs: 25, withPage: async (platform, worker, options) => {
        calls++;
        return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
            aborted++; reject(new Error('isolated deadline'));
        }, { once: true }));
    } });
    const targets = Array.from({ length: 8 }, (_, i) => ({ id: '712345678901234590' + i }));
    const started = Date.now();
    await Promise.all([slow.enrich(targets), slow.enrich(targets)]);
    assert.ok(Date.now() - started < 1000, '批次总时限不能变成逐项长等待');
    assert.equal(calls, 2, '批次最多两路，并发调用不得重复派发'); assert.equal(aborted, 2);
    assert.equal(slow.status().lastBatch.timedOut, true); assert.equal(slow.status().lastBatch.skipped, 6);
    assert.equal(slow.status().lastBatch.failed, 2); assert.equal(slow.status().pending, 0);
    console.log('✓ default detail clients: lazy production browser wiring, anonymous origin, freshness, dedup and bounded deadline');
}
module.exports = run;
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
