'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { biliGet, closeBrowser } = require('../lib/live-sources');
const { TIME_RANGE_SECONDS } = require('../lib/video-pipeline');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4000';
const examples = ['BV1bW411n7fY', 'BV1yt4y1Q7SS'];
async function request(params) {
    const response = await fetch(base + '/api/trends?' + new URLSearchParams(params), { signal: AbortSignal.timeout(60000) });
    const data = await response.json();
    assert.equal(response.status, 200, data.message); assert.equal(data.success, true);
    assert.equal(data.scope.exhaustive, false, '不能把搜索样本冒充全站榜');
    assert.equal(new Set(data.list.map(v => v.normPlatform + ':' + v.id)).size, data.list.length);
    for (let i = 1; i < data.list.length; i++) assert.ok(data.list[i - 1].metricRaw >= data.list[i].metricRaw, '按原始热度降序');
    if (TIME_RANGE_SECONDS[params.timeRange]) for (const video of data.list) {
        assert.ok(video.pubdate > 0);
        assert.ok(Date.now() / 1000 - video.pubdate <= TIME_RANGE_SECONDS[params.timeRange] + 3);
    }
    return data;
}
(async () => {
    const report = { generatedAt: new Date().toISOString(), biliExamples: [], categories: [] };
    try {
        const all = await request({ platform: 'bilibili', category: 'all', timeRange: 'all', refresh: '1' });
        assert.ok(all.list.length > 100, '不能在旧的100条候选处截断');
        for (const id of examples) {
            const video = all.list.find(v => v.id === id);
            assert.ok(video, '全部时间不能漏掉已验证的历史高播放作品 ' + id);
            const official = await biliGet('/x/web-interface/view', { bvid: id });
            assert.equal(video.title, official.title); assert.equal(new URL(video.cover).pathname, new URL(official.pic).pathname);
            assert.ok(Math.abs(video.playRaw - official.stat.view) / official.stat.view < 0.01, '计数来自同一作品的官方详情');
            assert.ok(video.playRaw > 100000000, '已核实的破亿作品不能被截断成4000万');
            report.biliExamples.push({ id, title: video.title, views: video.playRaw, officialViews: official.stat.view, rankInSample: all.list.indexOf(video) + 1 });
        }
        for (const filter of [{ category: 'kuso', timeRange: 'all' }, { category: 'tech', timeRange: '3days' }, { category: 'pets', timeRange: '7days' }, { category: 'comedy', timeRange: '3days' }]) {
            const data = await request({ platform: 'bilibili', ...filter });
            if (filter.category === 'kuso') assert.deepEqual(data.list.slice(0, 2).map(v => v.id), examples);
            report.categories.push({ ...filter, count: data.list.length, detailsVerified: data.coverage.detailsVerified, partial: data.partial });
        }
        const more = await request({ platform: 'bilibili', category: 'tech', timeRange: '3days', page: '2' });
        report.nextPage = { count: more.list.length, hasMore: more.hasMore };
        const topics = await (await fetch(base + '/api/topics?platform=douyin')).json();
        assert.ok(topics.success && topics.list.length > 0);
        assert.ok(topics.list.every(v => v.source === 'douyin:hot-search'));
        report.douyinTopics = { count: topics.list.length, top: topics.list.slice(0, 3).map(v => ({ title: v.title, rank: v.rank, heat: v.heatRaw })) };
        fs.mkdirSync(path.join(__dirname, '..', '.cache', 'verification'), { recursive: true });
        fs.writeFileSync(path.join(__dirname, '..', '.cache', 'verification', 'rankings-report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report, null, 2));
        console.log('Live ranking verification passed');
    } finally { await closeBrowser(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
