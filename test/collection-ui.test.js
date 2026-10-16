'use strict';

const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const puppeteer = require('puppeteer');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotpot-collection-ui-'));
process.env.HOTPOT_DB_FILE = path.join(directory, 'accounts.json');
process.env.HOTPOT_MEDIA_CACHE = path.join(directory, 'media');
process.env.HOTPOT_COLLECTION_DIR = path.join(directory, 'collection');
const sources = require('../lib/live-sources');
const jobs = require('../lib/media-jobs');
const index = require('../lib/collection-index');
const { prepareVideoList } = require('../lib/video-pipeline');
const observedAt = Date.now() - 2 * 3600000;
const items = Array.from({ length: 65 }, (_, i) => ({ id: 'BV' + String(i).padStart(10, '0'), platform: 'bilibili',
    title: '科技历史验证 ' + i, playRaw: i === 64 ? null : 10000 - i, pubdate: Math.floor(observedAt / 1000), fetchedAt: observedAt,
    author: '历史作者', source: 'isolated:fixture', url: 'https://www.bilibili.com/video/BV' + String(i).padStart(10, '0') }));
index.record('bilibili', items, { category: 'tech' });
let liveCalls = 0;
sources.getVideos = async () => { liveCalls++; return { list: prepareVideoList(items), hasMore: false, source: 'isolated:fixture', message: '隔离实时入口' }; };
const app = require('../server');

(async () => {
    let browser, server;
    try {
        server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const base = 'http://127.0.0.1:' + server.address().port;
        const chrome = process.env.PUPPETEER_EXECUTABLE_PATH;
        browser = await puppeteer.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}), args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 1000 });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        // Static external styles/icons are irrelevant to interaction assertions; keep tests offline.
        await page.setRequestInterception(true);
        page.on('request', request => request.url().startsWith(base) || request.url().startsWith('data:') ? request.continue() : request.abort());
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        const ready = () => page.waitForFunction(() => document.getElementById('loader').classList.contains('hidden'));
        await ready();
        const originalCalls = liveCalls;
        await page.click('#btn-metric-collected'); await ready();
        assert.equal(await page.$$eval('#cards-grid .video-card', cards => cards.length), 30);
        assert.match(await page.$eval('#ranking-scope', e => e.textContent), /历史指标，非实时/);
        for (const count of [60, 65]) {
            await page.click('#btn-load-more');
            await page.waitForFunction(n => document.querySelectorAll('#cards-grid .video-card').length === n, {}, count);
        }
        assert.equal(await page.$$eval('#cards-grid .video-card', cards => new Set(cards.map(c => c.dataset.videoId)).size), 65);
        assert.equal(await page.$eval('#cards-grid .video-card:last-child .card-rank', e => e.textContent), '未入播放榜');
        assert.equal(liveCalls, originalCalls, '历史查询和分页不能触发实时采集');
        await page.click('[data-category="pets"]'); await ready();
        assert.ok(await page.$('#empty-state:not(.hidden)'));
        await page.click('[data-category="tech"]'); await ready();
        assert.equal(await page.$$eval('#cards-grid .video-card', cards => cards.length), 30);
        await page.type('#search-input', '科技历史验证 64');
        await page.click('#search-btn'); await ready();
        assert.equal(await page.$$eval('#cards-grid .video-card', cards => cards.length), 1);
        await page.click('#search-clear-btn'); await ready();
        index.record('bilibili', [{ ...items[0], fetchedAt: Date.now(), playRaw: 1 }], { category: 'tech' });
        await page.click('#btn-load-more');
        await page.waitForFunction(() => document.body.textContent.includes('采集记录已更新，请刷新后重新翻页'));
        assert.equal(await page.$$eval('#cards-grid .video-card', cards => cards.length), 30, '版本冲突不追加重复记录');
        await page.click('#refresh-btn'); await ready();
        assert.equal(liveCalls, originalCalls, '历史刷新只重读索引');
        await page.click('[data-platform="douyin"]'); await ready();
        assert.match(await page.$eval('#empty-state p', e => e.textContent), /尚无符合筛选的采集记录/);
        assert.equal(liveCalls, originalCalls);
        await page.click('[data-platform="bilibili"]'); await ready();
        await page.setViewport({ width: 390, height: 844 });
        assert.ok(await page.$eval('#btn-metric-collected', e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth && r.left >= 0; }), '窄屏应能操作历史入口');
        const evidence = path.join(__dirname, '..', '.cache', 'verification');
        fs.mkdirSync(evidence, { recursive: true });
        await page.screenshot({ path: path.join(evidence, 'collection-mobile.png'), fullPage: true });
        await page.setViewport({ width: 1440, height: 1000 });
        await page.screenshot({ path: path.join(evidence, 'collection-desktop.png'), fullPage: true });
        await page.click('#btn-metric-single'); await ready();
        assert.ok(liveCalls > originalCalls, '切回实时入口恢复原有采集流程');
        assert.deepEqual(errors, []);
        console.log('Collection UI passed: 30/60/65, strict filters, unknown views, no live requests, mobile, zero JS errors');
    } finally {
        if (browser) await browser.close();
        jobs.shutdown(); await sources.closeBrowser();
        if (server) await new Promise(resolve => server.close(resolve));
        fs.rmSync(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
