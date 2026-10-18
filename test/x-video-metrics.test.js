'use strict';
const assert = require('node:assert/strict');
const { createClient, metricFromConfig } = require('../lib/x-video-metrics');
const { boundedMap } = require('../lib/live-sources');
const video = { postId: '2110094874024219133', mediaId: '2110094814733651969', playRaw: null };
const track = { contentId: video.mediaId, expandedUrl: 'https://twitter.com/NASA/status/' + video.postId + '/video/1', viewCount: '12,345' };
assert.equal(metricFromConfig({ track }, video), 12345);
assert.equal(metricFromConfig({ track: { ...track, viewCount: '87.8K' } }, video), 87800);
assert.equal(metricFromConfig({ track: { ...track, viewCount: '32.3K' } }, video), 32300, '避免二进制浮点误差把平台缩写误判无效');
assert.equal(metricFromConfig({ track: { ...track, viewCount: '1.5M' } }, video), 1500000);
assert.equal(metricFromConfig({ track: { ...track, contentId: 'wrong' } }, video), null);
assert.equal(metricFromConfig({ track: { ...track, expandedUrl: 'https://evil.test/status/' + video.postId } }, video), null);
assert.equal(metricFromConfig({ track: { ...track, expandedUrl: 'https://x.com/NASA/status/123' } }, video), null);
assert.equal(metricFromConfig({ track: { ...track, viewCount: '' } }, video), null);
assert.equal(metricFromConfig({ track: { ...track, viewCount: '-1' } }, video), null);
assert.equal(metricFromConfig({ video: { viewCount: 0 }, views: 123456 }, video), null, '不能读取嵌入页零占位或帖子曝光');
(async () => {
    let tokenCalls = 0, countCalls = 0, clock = Date.now();
    const client = createClient({ now: () => clock, http: {
        post: async () => { tokenCalls++; return { data: { guest_token: 'isolated-anonymous-guest' } }; },
        get: async (url, options) => { countCalls++; assert.equal(options.headers['x-guest-token'], 'isolated-anonymous-guest'); return { data: { track } }; }
    } });
    const first = await client.enrich([video, video], boundedMap);
    assert.equal(tokenCalls, 1, '并发共用匿名技术访客Token');
    assert.equal(first.list[0].playRaw, 12345);
    assert.equal(first.list[0].viewSource, 'twitter:official-anonymous-video-config');
    assert.ok(!JSON.stringify(first).includes('isolated-anonymous-guest'));
    const before = countCalls;
    await client.enrich([video], boundedMap); assert.equal(countCalls, before, '短缓存保留统计采集时间');
    clock += 130000;
    await client.enrich([video], boundedMap); assert.equal(countCalls, before + 1);
    assert.equal(tokenCalls, 1, '统计刷新不重复申请访客Token');
    const unavailable = createClient({ http: { post: async () => { throw new Error('private upstream'); } } });
    const failed = await unavailable.enrich([video], boundedMap);
    assert.equal(failed.list[0].playRaw, null); assert.equal(failed.failed, 1, '失败时保留真实作品与未知计数');
    const rounded = createClient({ http: { post: async () => ({ data: { guest_token: 'anonymous' } }), get: async () => ({ data: { track: { ...track, viewCount: '87.8K' } } }) } });
    let missingCalls=0;
    const missing=createClient({now:()=>clock,http:{post:async()=>({data:{guest_token:'anonymous'}}),get:async()=>{missingCalls++;return {data:{track:{...track,viewCount:null}}};}}});
    const hidden=await missing.enrich([video],boundedMap);
    assert.equal(hidden.failed,1,'HTTP200但未公开播放，仍必须计入不完整指标');
    assert.equal(hidden.list[0].playRaw,null);assert.equal(hidden.errors,0);
    clock+=31000;await missing.enrich([video],boundedMap);
    assert.equal(missingCalls,2,'隐藏计数不能被正向缓存阻止过久，不改写未知为0');
    const display = (await rounded.enrich([video], boundedMap)).list[0];
    assert.equal(display.viewCountText, '87.8K'); assert.equal(display.viewPrecision, 'source-rounded');
    console.log('X anonymous video metrics: media identity, real counts, source rounding, token reuse and failures passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
