'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ranking = require('../public/ranking');
const { prepareVideoList } = require('../lib/video-pipeline');
const { videoDataQuality } = require('../lib/data-quality');
const estimates = require('../lib/estimated-views');
const { createIndex } = require('../lib/collection-index');

const savedFlag = process.env.HOTPOT_ESTIMATED_VIEWS;
try {
    delete process.env.HOTPOT_ESTIMATED_VIEWS;
    assert.equal(estimates.enabled(), false, '真实数据产品不能默认推算播放量');
    const guessed = { id: 'guessed', title: '旧预估记录', platform: 'douyin', playRaw: 900000000,
        viewPrecision: 'estimated', viewEvidence: { status: 'estimated' }, likeRaw: 500 };
    const real = { id: 'real', title: '平台真实播放', platform: 'douyin', playRaw: 42, likeRaw: 1 };
    const list = prepareVideoList([guessed, real]);
    assert.equal(list[0].id, 'real', '旧缓存中的预估不能排在真实播放前面');
    assert.equal(ranking.count(guessed, 'views'), null);
    assert.equal(ranking.count(guessed, 'likes'), 500, '真实点赞仍可在用户主动选择的点赞榜排名');
    assert.equal(ranking.summary(list, 'views').ranked, 1);
    assert.equal(list.filteredKnownViews, 1);
    assert.equal(videoDataQuality([guessed]).status, 'metadata-only');
    assert.equal(videoDataQuality([guessed]).withViews, 0);
    assert.equal(videoDataQuality([guessed]).estimatedViews, 1);
    process.env.HOTPOT_ESTIMATED_VIEWS = '1';
    assert.equal(ranking.count(estimates.apply([{ ...guessed, playRaw: null }])[0], 'views'), null,
        '运营者即便启用实验预估，也不能混入真实播放榜');
} finally {
    if (savedFlag === undefined) delete process.env.HOTPOT_ESTIMATED_VIEWS;
    else process.env.HOTPOT_ESTIMATED_VIEWS = savedFlag;
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotpot-counter-merge-'));
try {
    const now = Date.now(), options = { platform: 'youtube' };
    let index = createIndex({ directory, now: () => now });
    const video = { id: 'counter', title: '指标独立观测', platform: 'youtube', fetchedAt: now - 10000,
        playRaw: 20, viewsFetchedAt: now - 4000, viewSource: 'new-view', viewPrecision: 'integer',
        viewEvidence: { status: 'verified', field: 'view_count' },
        likeRaw: 1, likesFetchedAt: now - 5000, likeSource: 'old-like' };
    index.record('youtube', [video]);
    index.record('youtube', [{ ...video, playRaw: 15, viewsFetchedAt: now - 4500, viewSource: 'old-view',
        likeRaw: 3, likesFetchedAt: now - 1000, likeSource: 'new-like' }]);
    let row = index.query(options).list[0];
    assert.equal(row.playRaw, 20, '较新点赞不能携带旧播放倒灌');
    assert.equal(row.viewSource, 'new-view');
    assert.equal(row.likeRaw, 3);
    index.record('youtube', [{ ...video, fetchedAt: now - 20000, playRaw: 25, viewsFetchedAt: now,
        likeRaw: 0, likesFetchedAt: now - 6000 }]);
    row = index.query(options).list[0];
    assert.equal(row.playRaw, 25, '新指标可附着于旧元数据到达，仍应被采纳');
    assert.equal(row.likeRaw, 3);
    assert.equal(row.fetchedAt, video.fetchedAt, '补数不伪造元数据采集时间');
    index.record('youtube', [{ ...video, fetchedAt: now - 20000, playRaw: null, viewsFetchedAt: now + 1,
        viewPrecision: 'unknown', viewSource: 'hidden', viewEvidence: { status: 'not-provided' } }]);
    index = createIndex({ directory, now: () => now });
    row = index.query(options).list[0];
    assert.equal(row.playRaw, null, '新的明确隐藏观测应清除旧播放，重启后仍保留');
    assert.equal(row.viewEvidence.status, 'not-provided');
    assert.equal(row.likeRaw, 3);
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
console.log('Real metric ranking and independent persisted counter observations passed');
