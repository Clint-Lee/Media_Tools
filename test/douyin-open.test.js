'use strict';

const assert = require('node:assert/strict');
const { createClient, hotVideo } = require('../lib/douyin-open');
const { videoDataQuality } = require('../lib/data-quality');
const { boundedMap } = require('../lib/live-sources');
const source = { media_type: 2, item_id: 'opaque-official-item', title: '科技热点关联的真实结构用例',
    video_status: 5, create_time: Math.floor(Date.now() / 1000), cover: 'https://p3.douyinpic.com/cover.jpg',
    share_url: 'https://www.iesdouyin.com/share/video/official-opaque-id/',
    statistics: { play_count: 123456, digg_count: 20, comment_count: 1 } };
assert.equal(hotVideo(source).playRaw, 123456);
assert.equal(hotVideo({ ...source, statistics: { digg_count: 9999 } }).playRaw, null);
assert.equal(hotVideo({ ...source, statistics: { play_count: 0 } }).playRaw, 0, '官方授权统计里的明确零值可以保留');
assert.equal(hotVideo({ ...source, statistics: { play_count: '' } }).playRaw, null);
assert.equal(hotVideo({ ...source, statistics: { play_count: -1 } }).playRaw, null);
assert.equal(hotVideo({ ...source, media_type: 4 }), null);
assert.equal(hotVideo({ ...source, share_url: 'https://www.douyin.com.evil.test/video/123' }), null);
assert.equal(hotVideo({ ...source, share_url: 'https://www.douyin.com/hot' }), null);
assert.equal(videoDataQuality([]).status, 'empty');
assert.equal(videoDataQuality([{ playRaw: null }]).status, 'metadata-only');
assert.equal(videoDataQuality([{ playRaw: 1 }, { playRaw: null }]).status, 'partial-metrics');
assert.equal(videoDataQuality([{ playRaw: 0 }]).status, 'ready');
assert.equal(videoDataQuality([{ playRaw: 1 }], { stale: true }).status, 'cached');

(async () => {
    const env = { DOUYIN_CLIENT_KEY: 'isolated-key', DOUYIN_CLIENT_SECRET: 'isolated-secret' };
    let tokenCalls = 0, clock = Date.now();
    const requests = [];
    const http = {
        post: async (url, body, config) => {
            tokenCalls++; assert.equal(body.client_secret, env.DOUYIN_CLIENT_SECRET); assert.equal(config.maxRedirects, 0);
            return { data: { data: { error_code: 0, access_token: 'isolated-token', expires_in: 7200 } } };
        },
        get: async (url, config) => {
            assert.equal(config.headers['access-token'], 'isolated-token'); requests.push({ url, params: config.params });
            return { data: { data: { error_code: 0, list: url.endsWith('/sentences/')
                ? Array.from({ length: 8 }, (_, i) => ({ sentence: '词+' + i })) : [source] } } };
        }
    };
    const client = createClient({ http, env, now: () => clock });
    const options = { category: 'all', timeRange: 'all', page: 1 };
    const result = await client.videos(options, { boundedMap });
    assert.equal(result.list[0].playRaw, 123456);
    assert.equal(result.hasMore, true);
    assert.equal(tokenCalls, 1, '并发接口调用复用服务端应用Token');
    assert.ok(!JSON.stringify(result).includes('isolated-secret'));
    assert.ok(!JSON.stringify(result).includes('isolated-token'));
    assert.equal(requests[1].params.hot_sentence, '词+0', '由HTTP库正确编码热点词');
    const page2 = await client.videos({ ...options, page: 2 }, { boundedMap });
    assert.equal(page2.hasMore, false);
    assert.equal((await client.videos({ ...options, category: 'pets' }, { boundedMap })).list.length, 0, '不以其它分类补齐');
    clock += 7200000;
    await client.videos(options, { boundedMap });
    assert.equal(tokenCalls, 2, '到期才重新申请Token');
    const denied = createClient({ env: { DOUYIN_CLIENT_TOKEN: 'isolated-token' }, http: { get: async () => ({ data: { data: { error_code: 2190008, description: 'sensitive upstream string' } } }) } });
    await assert.rejects(() => denied.videos(options, { boundedMap }), /2190008/);
    const disconnected = createClient({ env, http: { post: async () => { throw new Error('isolated-secret'); } } });
    await assert.rejects(() => disconnected.videos(options, { boundedMap }), e => !e.message.includes('isolated-secret'));
    console.log('Douyin official hotsearch, token reuse/expiry, identity, real counts and quality states passed (isolated)');
})().catch(error => { console.error(error); process.exitCode = 1; });
