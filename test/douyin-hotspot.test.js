'use strict';
// 抖音热点视频榜采集器 + TikTok 详情页播放量补全：隔离测试，不联网。
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const hotspot = require('../lib/douyin-hotspot');
const tiktokViews = require('../lib/tiktok-views');
const rankings = require('../lib/platform-rankings');

const aweme = (id, over = {}) => ({
    aweme_id: id, desc: '热点作品 ' + id, author: { nickname: '作者', avatar_thumb: { url_list: ['https://example.com/a.jpg'] } },
    video: { cover: { url_list: ['https://example.com/c.jpg'] }, duration: 20000 }, create_time: 1790000000,
    statistics: { aweme_id: id, digg_count: 1000, comment_count: 20, share_count: 5, collect_count: 30, play_count: 0 },
    ...over
});
// 与 lib/douyin-hotspot.js 的 HOTSPOT_PATHS 对齐（测试从模块内部路径推导，不硬编码 URL）
const HOTSPOT_PATHS = require('../lib/douyin-hotspot').HOTSPOT_PATHS || [
    '/aweme/v1/web/channel/hotspot?device_platform=webapp&aid=6383&channel=channel_pc_web&tag_id=&count=20&Seo-Flag=0&channel_id=99&pc_client_type=1&pc_libra_divert=Windows&support_h265=1&support_dash=0&version_code=170400&version_name=17.4.0'
];
const rawAweme = id => aweme('76961213036772918' + String(id).padStart(2, '0'));

// ── 1) hotspotVideo：播放量 0 必须是未公开，不是零播放
{
    const video = hotspot.hotspotVideo(aweme('7696121303677291810'));
    assert.equal(video.playRaw, null, '匿名 play_count=0 不能写成真实播放量');
    assert.equal(video.viewEvidence.status, 'placeholder-zero');
    assert.equal(video.likeRaw, 1000);
    assert.equal(video.commentCount, 20);
    assert.equal(video.shareCount, 5);
    assert.equal(video.collectCount, 30);
    assert.equal(video.interactRaw, 1055, '互动总量只作辅助排序，字段名不得冒充播放量');
    assert.equal(video.source, 'douyin:hotspot-channel');
    assert.match(video.url, /douyin\.com\/video\/7696121303677291810/);
    // 身份不符的作品必须丢弃
    assert.equal(hotspot.hotspotVideo(aweme('abc', { video: null })), null);
    assert.equal(hotspot.hotspotVideo(aweme('abc', { author: null })), null);
    assert.equal(hotspot.hotspotVideo({ aweme_id: 'abc', desc: 'x', statistics: {} }), null, 'ID 不是数字必须丢弃');
    // 播放计数明确缺失（字段不存在）与隐藏占位 0 是两种不同状态，都不得当成真实播放量
    const missing = hotspot.hotspotVideo(aweme('7696121303677291810', { statistics: { digg_count: 5 } }));
    assert.equal(missing.playRaw, null);
    assert.equal(missing.viewEvidence.status, 'not-provided');
    const placeholder = hotspot.hotspotVideo(aweme('7696121303677291810', { statistics: { play_count: 0, digg_count: 5 } }));
    assert.equal(placeholder.viewEvidence.status, 'placeholder-zero');
    console.log('✓ hotspotVideo: 隐藏计数标注为未公开、真实互动计数保留、身份核验');
}

// ── 2) collectAwemes 递归收集
{
    const data = { a: { aweme_list: [aweme('1')] }, b: { c: { aweme_list: [aweme('2')] } } };
    const found = hotspot.collectAwemes(data);
    assert.equal(found.length, 2);
    assert.equal(hotspot.collectAwemes(null).length, 0);
    assert.equal(hotspot.collectAwemes({}).length, 0);
    console.log('✓ collectAwemes: 递归收集与空值安全');
}

// ── 3) hotspotRanking：合并 memo + withPage，过滤与覆盖率如实
async function testHotspotRanking() {
    const calls = [];
    const result = await hotspot.hotspotRanking({ category: 'all', page: 1 }, {
        withPage: async (platform, worker) => {
            const page = new EventEmitter();
            page.goto = async () => {};
            page.setCookie = async () => {};
            // 页面上下文里的 fetch：返回与热点榜接口一致的结构
            page.evaluate = async () => HOTSPOT_PATHS.map(path => ({
                path, status: 200,
                text: JSON.stringify({ status_code: 0, aweme_list: [rawAweme('1'), rawAweme('2')] })
            }));
            return worker(page);
        },
        memo: async (key, worker) => { calls.push(key); return worker(); }
    });
    assert.equal(result.source, 'douyin:hotspot-channel');
    assert.equal(result.list.length, 2);
    assert.equal(result.coverage.candidates, 2);
    assert.equal(result.coverage.hiddenViews, 2, '未公开播放量的件数必须如实上报');
    assert.equal(result.scope.kind, 'official-hot-videos');
    assert.equal(result.partial, true, '播放量未公开时必须标注部分数据');
    assert.equal(result.hasMore, false, '没有实际游标就不能提供虚假续页');
    assert.doesNotMatch(result.message, /改用已公开的互动计数排序|后即可显示真实播放量/);
    assert.match(result.message, /play_count 恒为 0/);
    assert.ok(calls.some(key => key.startsWith('douyin:hotspot:')), '必须走快照缓存');
    console.log('✓ hotspotRanking: 真实作品、未公开播放量如实标注、缓存键正确');
}

// ── 4) hotspotRanking 无作品时报错，不返回空列表
async function testHotspotEmpty() {
    await assert.rejects(() => hotspot.hotspotRanking({ category: 'all', page: 1 }, {
        withPage: async (platform, worker) => {
            const page = new EventEmitter();
            page.goto = async () => {};
            page.evaluate = async () => HOTSPOT_PATHS.map(path => ({ path, status: 200, text: JSON.stringify({ status_code: 0, aweme_list: [] }) }));
            return worker(page);
        },
        memo: async (key, worker) => worker()
    }), /未返回可核验作品/);
    console.log('✓ hotspotRanking: 空结果明确报错，不返回假装成功的空榜');
}

// ── 4b) 接口被风控拒绝时明确报错，不返回空榜
async function testHotspotBlocked() {
    await assert.rejects(() => hotspot.hotspotRanking({ category: 'all', page: 1 }, {
        withPage: async (platform, worker) => {
            const page = new EventEmitter();
            page.goto = async () => {};
            page.evaluate = async () => HOTSPOT_PATHS.map(path => ({ path, status: 403, text: 'blocked' }));
            return worker(page);
        },
        memo: async (key, worker) => worker()
    }), /未返回可核验作品/);
    console.log('✓ hotspotRanking: 风控拒绝明确报错，不静默返回空榜');
}

(async () => {
    await testHotspotRanking();
    await testHotspotEmpty();
    await testHotspotBlocked();
    await assert.rejects(() => hotspot.hotspotRanking({ page: 2 }), /不支持第2页/);
    {
        let batch, observedAt = 1000;
        const dependencies = { now: () => observedAt, memo: async (key, worker) => batch || (batch = await worker()),
            withPage: async (platform, worker, options) => {
                assert.equal(options.anonymous, true);
                return worker({ goto: async () => {}, evaluate: async () => [{ status: 200,
                    text: JSON.stringify({ aweme_list: [rawAweme('3')] }) }] });
            } };
        const first = await hotspot.hotspotRanking({}, dependencies); observedAt = 5000;
        const cached = await hotspot.hotspotRanking({}, dependencies);
        assert.equal(first.list[0].fetchedAt, 1000);
        assert.equal(cached.list[0].fetchedAt, 1000, '复用热点batch不能刷新作品观测时刻');
        assert.equal(cached.list[0].viewEvidence.observedAt, 1000);
    }

    // ── 5) TikTok parseDetail：只接受 ID 一致的详情
    {
        const universal = { '#__UNIVERSAL_DATA_FOR_REHYDRATION__': { __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: { id: '123', stats: { playCount: 99 } } } } } } };
        assert.equal(tiktokViews.parseDetail(universal, '123').stats.playCount, 99);
        assert.equal(tiktokViews.parseDetail(universal, '999'), null, 'ID 不一致不能用推荐视频顶替');
        const legacy = { '#SIGI_STATE': { ItemModule: { '456': { id: '456', stats: { playCount: 7 } } } } };
        assert.equal(tiktokViews.parseDetail(legacy, '456').stats.playCount, 7);
        assert.equal(tiktokViews.parseDetail(null, '1'), null);
        assert.equal(tiktokViews.parseDetail({}, '1'), null);
        console.log('✓ TikTok parseDetail: 结构识别与身份核验');
    }

    // ── 6) TikTok apply：详情页计数覆盖近似值，缺失时保持未知
    {
        const client = tiktokViews.createClient({ withPage: async (platform, worker) => worker({}), now: () => 2000 });
        const list = [
            { id: '111', platform: 'tiktok', playRaw: 120000000, fetchedAt: 1000, title: '短标题' },
            { id: '222', platform: 'tiktok', playRaw: null, fetchedAt: 1000 }
        ];
        const applied = client.apply(list);
        assert.equal(applied[0].playRaw, 120000000, '没有缓存行时保持原值');
        assert.equal(applied[1].playRaw, null, '缺失播放量不得被补成 0 或推荐视频的值');
        console.log('✓ TikTok apply: 无缓存时保持原值，不改写');
    }

    // ── 7) capabilities：抖音/TikTok 数据源如实标注
    {
        const caps = rankings.capabilities();
        const douyin = caps.find(c => c.platform === 'douyin');
        assert.equal(douyin.videos, 'multi-source');
        assert.ok(douyin.sources.includes('douyin:hotspot-channel'), '必须列出热点视频榜来源');
        assert.ok(douyin.sources.includes('douyin:anonymous-discover'));
        const tiktok = caps.find(c => c.platform === 'tiktok');
        assert.ok(tiktok.sources.includes('tiktok:public-watch'), '必须列出详情页播放量来源');
        assert.match(tiktok.label, /详情页实际播放计数/);
        console.log('✓ capabilities: 抖音多来源与 TikTok 详情页播放量来源如实标注');
    }

    await require('./view-detail-integration.test')();
    console.log('\nDouyin hotspot + TikTok view enrichment tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

