'use strict';
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotpot-api-test-'));
process.env.HOTPOT_DB_FILE = path.join(directory, 'accounts.json');
process.env.HOTPOT_MEDIA_CACHE = path.join(directory, 'media');
process.env.HOTPOT_COLLECTION_DIR = path.join(directory, 'collection');
const sources = require('../lib/live-sources');
const jobs = require('../lib/media-jobs');
const calls = [];
const now = Math.floor(Date.now() / 1000);
sources.getVideos = async options => {
    calls.push(options);
    if (options.query === 'source-failure') throw new Error('真实源不可用');
    return { source: 'test:verified-fixture', message: '隔离测试数据', hasMore: true, nextCursor: 'real-next', scope: { exhaustive: false, metric: 'views' }, coverage: { candidates: 2, unique: 2 }, list: [
        { id:'BVtest2', title:'上海技术视频', platform:'bilibili', playRaw:12345, metricRaw:12345, pubdate:now, cover:'https://example.com/real.jpg' },
        { id:'BVtest1', title:'东京技术视频', platform:'bilibili', playRaw:12, metricRaw:12, pubdate:now }
    ] };
};
sources.getTopics = async () => ({ source:'test:official-topic', message:'原始排名', list:[
    { id:'topic1', title:'科技热点', rank:2, heatRaw:123456, heatDisplay:'12.3万', worksCount:null }
] });
const app = require('../server');
(async () => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    let cookie = '';
    const get = async url => { const r = await fetch(base + url, { headers: { Cookie: cookie } }); return { status:r.status, data:await r.json() }; };
    try {
        assert.equal((await get('/api/auth/me')).status, 401);
        const collected = require('../lib/collection-index');
        collected.record('bilibili', Array.from({length:35}, (_,i)=>({id:'index-'+i,title:'科技历史样本 '+i,platform:'bilibili',playRaw:100-i,pubdate:now,fetchedAt:Date.now()})), {category:'tech'});
        const historical = await get('/api/collected-videos?platform=bilibili&category=tech');
        assert.equal(historical.status,200,'历史样本无需注册登录');
        assert.equal(historical.data.list.length,30);
        assert.equal(historical.data.total,35);
        assert.equal(historical.data.scope.exhaustive,false);
        assert.equal(historical.data.historical,true);
        const next = await get('/api/collected-videos?platform=bilibili&category=tech&cursor='+encodeURIComponent(historical.data.nextCursor));
        assert.equal(next.data.list.length,5);
        assert.equal((await get('/api/collected-videos?platform=invalid')).status,400);
        assert.equal((await get('/api/collected-videos?platform=bilibili&cursor=bad')).status,400);
        assert.equal((await get('/api/collected-videos?platform=douyin')).data.total,0,'其它平台不使用历史样本补数');
        const registration = await fetch(base + '/api/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:'real_api_test',password:'Test-password-123456'}) });
        assert.equal(registration.status,200); cookie = registration.headers.get('set-cookie').split(';')[0];
        assert.equal((await get('/api/settings')).status, 200);
        for (const url of ['/api/trends?platform=invalid', '/api/trends?category=invalid', '/api/trends?timeRange=invalid'])
            assert.equal((await get(url)).status, 400);
        const r = await get('/api/search?platform=bilibili&category=tech&timeRange=3days&query=AI');
        assert.equal(r.status, 200); assert.equal(r.data.success, true);
        assert.equal(calls.at(-1).timeRange, '3days'); assert.equal(calls.at(-1).category, 'tech'); assert.equal(calls.at(-1).query, 'AI');
        assert.equal(r.data.list[0].playRaw, 12345);
        assert.equal(r.data.scope.exhaustive, false); assert.equal(r.data.nextCursor, 'real-next');
        assert.equal(r.data.hasMore, true); assert.equal(r.data.coverage.candidates, 2);
        await get('/api/search?platform=bilibili&query=AI&page=2&cursor=next');
        assert.equal(calls.at(-1).page, 2); assert.equal(calls.at(-1).cursor, 'next');
        assert.equal((await get('/api/platforms')).data.list.length, 7);
        const topic = await get('/api/topics?platform=douyin&timeRange=7days');
        assert.equal(topic.data.list[0].rank, 2, '保留平台原始排名');
        assert.equal(topic.data.list[0].heatRaw, 123456, '热度不能乘倍数');
        assert.equal(topic.data.timeRangeApplied, false, '话题榜不是发布时间视频榜');
        await get('/api/search-topic?platform=bilibili&category=tech&timeRange=3days&query=手机');
        assert.equal(calls.at(-1).query, '手机'); assert.equal(calls.at(-1).timeRange, '3days');
        const failed = await get('/api/search?query=source-failure');
        assert.equal(failed.status, 502); assert.equal(failed.data.success, false);
        assert.equal(failed.data.list.length, 0, '源失败不能返回固定素材');
        const geo = await get('/api/geo-hotspots?platform=bilibili');
        assert.equal(geo.data.sampleSize, 2);
        assert.equal(geo.data.list.reduce((n,x) => n+x.count,0), 2);
        for (const endpoint of ['/api/analyze', '/api/transcript']) {
            const response = await fetch(base + endpoint, { method:'POST', headers:{'Content-Type':'application/json',Cookie:cookie}, body:JSON.stringify({title:'伪造字幕测试'}) });
            assert.equal(response.status, 400, '只有标题的请求不能生成字幕');
        }
        const invalid = await fetch(base + '/api/media/jobs', { method:'POST', headers:{'Content-Type':'application/json',Cookie:cookie}, body:JSON.stringify({url:'http://127.0.0.1/private'}) });
        assert.equal(invalid.status,400);
        assert.equal((await get('/api/media/jobs/not-a-job')).status,404);
        const blocked = await fetch(base + '/api/proxy-image?url=' + encodeURIComponent('http://127.0.0.1/private'));
        assert.equal(blocked.status,400);
        assert.equal(app.resolveMediaExtension('audio/aac', 'song'), '.aac');
        assert.equal(app.resolveMediaExtension('audio/mp4', 'track'), '.m4a');
        assert.equal(app.resolveMediaExtension('video/webm', 'clip'), '.webm');
        assert.equal(app.resolveMediaExtension('video/mp4', 'movie.mp4'), '');
        assert.equal(app.resolveMediaExtension('audio/mpeg', 'tune.mp3'), '');
        for (const asset of ['/cover-placeholder.svg','/vendor/globe.gl.min.js','/vendor/earth-blue-marble.jpg']) assert.equal((await fetch(base+asset,{method:'HEAD'})).status,200);
        console.log('api-smoke tests passed (no network dependencies)');
    } finally { jobs.shutdown(); await sources.closeBrowser(); await new Promise(r => server.close(r)); fs.rmSync(directory, { recursive:true, force:true }); }
})().catch(error => {console.error(error);process.exitCode=1;});
