'use strict';
const assert = require('node:assert/strict');
const axios = require('axios');
const rankings = require('../lib/platform-rankings');
const { relativeAge, searchFilter } = require('../lib/youtube-search');
const { prepareVideoList } = require('../lib/video-pipeline');
const { publicAddress,parsePublicUrl,platformUrl } = require('../lib/safe-network');
const { imageFormat } = require('../lib/image-format');
for(const address of ['127.0.0.1','100.64.0.1','192.168.1.2','198.18.0.1','::1','::ffff:8.8.8.8','fc00::1']) assert.equal(publicAddress(address),false);
assert.equal(publicAddress('8.8.8.8'),true); assert.equal(publicAddress('2606:4700:4700::1111'),true);
assert.throws(()=>parsePublicUrl('http://2130706433/'));
assert.throws(()=>platformUrl('https://www.bilibili.com.attacker.invalid/'));
assert.equal(platformUrl('https://b23.tv/actual').hostname,'b23.tv');
assert.equal(imageFormat(Buffer.from('<svg>占位图片</svg>')),null);
assert.equal(imageFormat(Buffer.from([0xff,0xd8,0xff,0,0,0,0,0,0,0,0,0])).ext,'jpg');

assert.deepEqual(relativeAge('2d ago'), { seconds: 172800, upperSeconds: 259200 });
assert.equal(relativeAge('16h ago').seconds, 57600);
assert.equal(relativeAge('8mo ago').seconds, 8 * 30 * 86400);
assert.equal(relativeAge('Streamed 3 days ago').seconds, 3 * 86400);
assert.equal(relativeAge('刚刚'), null);
assert.equal(searchFilter('7days'), 'CAMSBAgDEAE=');
assert.equal(searchFilter('all'), 'CAMSAhAB');

assert.equal(rankings.tiktokVideo({ id: '123', video: {}, author: {}, stats: {} }), null);
const tik = rankings.tiktokVideo({ id: '7123456789012345678', desc: '真实视频', author: { uniqueId: 'creator', nickname: '作者' }, video: { cover: 'https://example.com/tik-cover.jpg' }, stats: { playCount: 12345 }, createTime: 1700000000 });
assert.equal(tik.playRaw, 12345);
assert.equal(tik.url, 'https://www.tiktok.com/@creator/video/7123456789012345678');
assert.equal(rankings.redVideo({ id: 'note', note_card: { type: 'normal' } }), null, '图文不能进入视频榜');
const red = rankings.redVideo({ id: 'note', note_card: { type: 'video', display_title: '上海探店', cover: { url_default: 'https://example.com/red.jpg' }, interact_info: { liked_count: '1.2万' } } });
assert.equal(red.playRaw, null); assert.equal(red.metricRaw, 12000); assert.equal(red.pubdate, 0);
assert.equal(prepareVideoList([red], { timeRange: '3days' }).length, 0, '不能从笔记ID编造发布日期');
const x = rankings.xVideos({ data: [{ id: '123', text: '视频帖子', author_id: 'u', created_at: '2026-10-03T00:00:00Z', public_metrics: { like_count: 10, impression_count: 999999 }, attachments: { media_keys: ['m'] } }], includes: { users: [{ id: 'u', username: 'creator' }], media: [{ media_key: 'm', type: 'video', preview_image_url: 'https://example.com/x.jpg' }] } });
assert.equal(x.length, 1); assert.equal(x[0].playRaw, null, '帖子曝光不是视频播放'); assert.equal(x[0].metricRaw, 10);
assert.equal(rankings.xVideos({ data: [{ id: '123', text: '非视频' }] }).length, 0);

(async () => {
    const original = axios.get, originalKey = process.env.YOUTUBE_API_KEY;
    process.env.YOUTUBE_API_KEY = 'test-key';
    const calls = [];
    axios.get = async (url, config) => {
        calls.push({ url, params: config.params });
        if (url.endsWith('/search')) return { data: { items: [{ id: { videoId: 'abcdefghijk' } }], nextPageToken: 'next-page' } };
        return { data: { items: [{ id: 'abcdefghijk', snippet: { title: '官方详情', publishedAt: new Date().toISOString(), thumbnails: { high: { url: 'https://example.com/official.jpg' } } }, statistics: { viewCount: '123456789' }, contentDetails: { duration: 'PT1M5S' } }] } };
    };
    try {
        const result = await rankings.youtubeApiVideos({ platform: 'youtube', category: 'tech', query: 'AI', timeRange: '3days', cursor: 'previous' });
        assert.equal(calls[0].params.order, 'viewCount'); assert.equal(calls[0].params.type, 'video');
        assert.equal(calls[0].params.q, 'AI'); assert.equal(calls[0].params.videoCategoryId, '28');
        assert.equal(calls[0].params.pageToken, 'previous'); assert.ok(calls[0].params.publishedAfter);
        assert.equal(calls[1].params.id, 'abcdefghijk'); assert.equal(result.list[0].playRaw, 123456789);
        assert.equal(result.list[0].cover, 'https://example.com/official.jpg');
        assert.equal(result.nextCursor, 'next-page'); assert.equal(result.hasMore, true); assert.equal(result.scope.exhaustive, false);
    } finally {
        axios.get = original;
        if (originalKey === undefined) delete process.env.YOUTUBE_API_KEY; else process.env.YOUTUBE_API_KEY = originalKey;
    }
    console.log('platform-rankings tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
