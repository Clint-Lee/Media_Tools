'use strict';
const assert = require('node:assert/strict');
const { metadataFromEmbed, extractTikTokEmbed } = require('../lib/tiktok-embed');
const id = '7664782256527002901', other = '7694271034731597089';
const url = 'https://www.tiktok.com/@creator/video/' + id;
const data = { itemInfos: { id, text: '真实公开作品', playCount: 123456789, diggCount: 1234, commentCount: 0, covers: ['https://p16.tiktokcdn-us.com/cover.jpg'], video: { urls: ['https://v19.tiktokcdn-us.com/video.mp4'], videoMeta: { duration: 12 } } }, authorInfos: { uniqueId: 'creator', nickName: '作者' } };
const state = { source: { data: { ['/embed/v2/' + other]: { videoData: { ...data, itemInfos: { ...data.itemInfos, id: other } } }, ['/embed/v2/' + id]: { videoData: data } } } };
const info = metadataFromEmbed(state, url);
assert.equal(info.id, id);
assert.equal(info.title, '真实公开作品');
assert.equal(info.duration, 12);
assert.equal(info.url, data.itemInfos.video.urls[0]);
assert.throws(() => metadataFromEmbed({ source: { data: { ['/embed/v2/' + other]: { videoData: data } } } }, url), /对应作品/);
assert.throws(() => metadataFromEmbed({ source: { data: { ['/embed/v2/' + id]: { videoData: { ...data, itemInfos: { ...data.itemInfos, id: other } } } } } }, url), /对应作品/);
for (const mediaUrl of ['http://127.0.0.1/video', 'https://tiktokcdn-us.com.evil.test/video', 'file:///video.mp4']) {
    assert.throws(() => metadataFromEmbed({ source: { data: { ['/embed/v2/' + id]: { videoData: { ...data, itemInfos: { ...data.itemInfos, video: { urls: [mediaUrl] } } } } } } }, url), /媒体地址/);
}
(async () => {
    const sources = require('../lib/live-sources'), browser = require('../lib/public-browser');
    const original = sources.withPage, originalLightweight = browser.lightweightPage;
    try {
        browser.lightweightPage = async () => {};
        sources.withPage = async (platform, worker, options) => {
            assert.equal(platform, 'tiktok'); assert.equal(options.anonymous, true);
            let evaluation = 0;
            return worker({ goto: async target => assert.equal(target, 'https://www.tiktok.com/embed/v2/' + id), evaluate: async () => ++evaluation === 1 ? state : 'original-public-user-agent' });
        };
        const extracted = await extractTikTokEmbed(url);
        assert.equal(extracted.http_headers['User-Agent'], 'original-public-user-agent');
        assert.equal(extracted.http_headers.Referer, 'https://www.tiktok.com/');
        const parsed = await require('../lib/downloader-core').parseGeneric(url);
        assert.equal(parsed.data.originDownloadVideoUrl, info.url);
        assert.equal(parsed.data.httpHeaders['User-Agent'], 'original-public-user-agent');
        assert.equal(parsed.data.platform, 'tiktok');
        assert.equal(parsed.data.playRaw, 123456789, '解析结果不能丢弃真实播放计数');
        assert.equal(parsed.data.likeRaw, 1234);
        assert.equal(parsed.data.commentCount, 0, '真实零评论不能变成未知');
        assert.equal(parsed.data.viewEvidence.field, 'itemInfos.playCount');
        const short = 'https://vm.tiktok.com/isolated-share/';
        sources.withPage = async (platform, worker, options) => {
            assert.equal(options.anonymous, true);
            const visited = []; let evaluation = 0;
            const extracted = await worker({ goto: async target => visited.push(target), url: () => url, evaluate: async () => ++evaluation === 1 ? state : 'original-public-user-agent' });
            assert.deepEqual(visited, [short, 'https://www.tiktok.com/embed/v2/' + id]);
            return extracted;
        };
        const shared = await require('../lib/downloader-core').parseGeneric(short);
        assert.equal(shared.data.url, url, '短链必须对应实际跳转作品');
        sources.withPage = async (platform, worker) => worker({ goto: async () => {}, url: () => 'http://127.0.0.1/private' });
        await assert.rejects(() => extractTikTokEmbed(short), /内网|保留地址/);
        const handlers = {};
        await originalLightweight({ setRequestInterception: async () => {}, on: (kind, handler) => { handlers[kind] = handler; } }, { navigationDomain: 'tiktok.com' });
        for (const [target, expected] of [[url, 'continue'], ['https://www.tiktok.com.evil.test/', 'abort'], ['http://127.0.0.1/', 'abort']]) {
            let result;
            handlers.request({ isNavigationRequest: () => true, url: () => target, resourceType: () => 'document', abort: () => { result = 'abort'; }, continue: () => { result = 'continue'; } });
            assert.equal(result, expected, '分享跳转不能借匿名浏览器访问内网或其它站点');
        }
    } finally { sources.withPage = original; browser.lightweightPage = originalLightweight; }
    console.log('TikTok public embed identity, media host and anonymous extraction tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
