'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4000';
    const evidence = path.join(__dirname, '..', '.cache', 'verification');
    fs.mkdirSync(evidence, { recursive: true });
    const ready = () => page.waitForFunction(() => document.querySelector('#loader').classList.contains('hidden'), { timeout: 60000 });
    try {
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#cards-grid .video-card', { timeout: 60000 });
        assert.equal(await page.$$eval('#cards-grid .video-card', cards => cards.length), 30);
        const ids = await page.$$eval('#cards-grid .video-card', cards => cards.map(card => card.dataset.videoId));
        assert.ok(ids.includes('BV1bW411n7fY') && ids.includes('BV1yt4y1Q7SS'));
        assert.ok((await page.$eval('#ranking-scope', e => e.textContent)).includes('历史高播放'));
        await page.screenshot({ path: path.join(evidence, 'bilibili-historical-ranking.png') });
        await page.click('[data-category="kuso"]'); await ready();
        assert.deepEqual(await page.$$eval('#cards-grid .video-card', cards => cards.slice(0, 2).map(card => card.dataset.videoId)), ['BV1bW411n7fY', 'BV1yt4y1Q7SS']);
        await page.screenshot({ path: path.join(evidence, 'bilibili-kuso-ranking.png') });
        await page.click('[data-time="3days"]');
        await page.click('[data-category="pets"]');
        await page.click('[data-category="tech"]'); await ready();
        assert.equal(await page.$eval('.filter-chip.active', e => e.dataset.category), 'tech');
        assert.equal(await page.$$eval('#cards-grid .video-card', cards => cards.length), 30);
        await page.$eval('#grid-scroll-area', e => { e.scrollTop = e.scrollHeight; });
        await page.waitForFunction(() => document.querySelectorAll('#cards-grid .video-card').length >= 60, { timeout: 10000 });
        assert.equal(await page.$$eval('#cards-grid .card-rank', e => e[59].textContent.trim()), '#60');
        await page.click('[data-category="all"]'); await ready();
        await page.click('#btn-metric-topic'); await ready();
        await page.click('.nav-btn[data-platform="douyin"]'); await ready();
        assert.ok(await page.$('#topics-grid .topic-event-card'));
        assert.ok((await page.$eval('#ranking-scope', e => e.textContent)).includes('官方实时话题'));
        assert.deepEqual(errors, []);

        // 单独隔离前端分页测试：第一批只有30条但上游仍有下一页，不能显示“到底了”。
        const mock = await browser.newPage();
        await mock.setViewport({ width: 1440, height: 1000 });
        await mock.setRequestInterception(true);
        const requests = [];
        mock.on('request', request => {
            const url = new URL(request.url());
            if (url.pathname !== '/api/trends') return request.continue();
            const batch = Number(url.searchParams.get('page') || 1);
            requests.push(batch);
            const list = Array.from({ length: 30 }, (_, index) => ({ id: 'fixture-' + ((batch - 1) * 30 + index), normPlatform: 'bilibili', title: '隔离分页验证 ' + index, metricRaw: 10000 - (batch - 1) * 30 - index, metricDisplay: '测试', metricLabel: '测试', pubdate: Math.floor(Date.now() / 1000) }));
            request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, list, hasMore: batch < 3, scope: { label: '隔离测试' } }) });
        });
        await mock.goto(base, { waitUntil: 'domcontentloaded' });
        await mock.waitForSelector('#cards-grid .video-card');
        for (const count of [60, 90]) {
            await mock.$eval('#grid-scroll-area', e => { e.scrollTop = e.scrollHeight; });
            await mock.waitForFunction(n => document.querySelectorAll('#cards-grid .video-card').length === n, { timeout: 10000 }, count);
        }
        assert.deepEqual(requests, [1, 2, 3], '必须实际请求上游新页');
        assert.equal(await mock.$$eval('#cards-grid .video-card', cards => new Set(cards.map(card => card.dataset.videoId)).size), 90);
        assert.ok(await mock.$('#end-hint:not(.hidden)'));
        await mock.close();
        console.log('Live ranking UI, 30-card batches, latest-filter state and upstream pagination passed');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
