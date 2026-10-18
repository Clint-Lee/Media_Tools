'use strict';
const assert=require('node:assert/strict'),axios=require('axios');
const notes=require('../lib/youtube-public');
const id='abcdefghijk';
function html(videoId=id,{entity=true,endpoint=videoId,date='2025-10-10T08:00:00-07:00'}={}) {
    const player={videoDetails:{videoId,title:'引号 " 和 }; 均是标题文本',viewCount:'123456789',lengthSeconds:'61',author:'原作者',thumbnail:{thumbnails:[{url:'https://i.ytimg.com/fixture.jpg'}]}},microformat:{playerMicroformatRenderer:{publishDate:date}}};
    const data={currentVideoEndpoint:{watchEndpoint:{videoId:endpoint}},contents:{videoPrimaryInfoRenderer:{buttons:entity?{likeCountEntity:{likeCountIfLikedNumber:'101',likeCountIfIndifferentNumber:'100'},accessibilityText:'like this video along with 101 other people'}:{accessibilityText:'like this video along with 101 other people'}}},recommendations:[{likeCountEntity:{likeCountIfIndifferentNumber:'999999999'}}]};
    return '<script>var ytInitialPlayerResponse = '+JSON.stringify(player)+';</script><script>var ytInitialData = '+JSON.stringify(data)+';</script>';
}
const value=notes.parseWatch(html(),id,1700000000000);
assert.equal(value.playRaw,123456789);assert.equal(value.likeRaw,100,'不能取假设用户点赞后的101');
assert.equal(value.likePrecision,'integer');assert.equal(value.datePrecision,'exact');assert.equal(value.duration,'1:01');
assert.equal(value.title,'引号 " 和 }; 均是标题文本','带};的标题不能截断JSON');
assert.equal(value.likesFetchedAt,1700000000000);
assert.equal(notes.parseWatch(html(id,{entity:false}),id).likeRaw,null,'不能误取推荐视频或假设操作提示');
assert.equal(notes.parseWatch(html(id,{date:'2025-10-10'}),id).pubdate,undefined,'日期只有天时不能冒充精确时刻');
assert.throws(()=>notes.parseWatch(html('wrongvideox'),id),/编号/);
assert.throws(()=>notes.parseWatch(html(id,{endpoint:'wrongvideox'}),id),/编号/);
assert.equal(notes.initialObject('<script>ytInitialData = {"broken":','ytInitialData'),null);
const original=axios.get;let requests=0,concurrency=0,maxConcurrency=0;
axios.get=async(url,options)=>{
    requests++;concurrency++;maxConcurrency=Math.max(maxConcurrency,concurrency);
    assert.equal(url,'https://www.youtube.com/watch');assert.equal(options.params.hl,'en');assert.equal(options.maxRedirects,0);
    await new Promise(resolve=>setTimeout(resolve,5));concurrency--;
    return {data:html(options.params.v==='12345678901'?'wrongvideox':options.params.v)};
};
(async()=>{
    const list=[id,'lmnopqrstuv','12345678901','ABCDEFGHIJK'].map(videoId=>({id:videoId,title:'原搜索标题',playRaw:123456700,fetchedAt:Date.now()-10000}));
    await Promise.all([notes.enrich(list),notes.enrich(list)]);
    assert.equal(requests,4,'相同批次并发请求合并');assert.ok(maxConcurrency<=3);
    const enriched=notes.apply(list);assert.equal(enriched[0].likeRaw,100);assert.equal(enriched[0].playRaw,123456789);
    assert.equal(enriched[0].source,'youtube:public-watch');assert.equal(enriched[0].title,value.title);
    assert.equal(enriched[2],list[2],'身份不匹配不能补任何字段');
    const newer=notes.apply([{...list[0],playRaw:123456999,fetchedAt:Date.now()+1000}])[0];
    assert.equal(newer.playRaw,123456999,'新搜索播放观测不能被旧详情覆盖');assert.equal(newer.likeRaw,100);
    assert.ok(newer.likesFetchedAt<newer.fetchedAt,'独立保留真实点赞观测时刻');
    await notes.enrich(list);assert.equal(requests,4,'真实缓存与失败冷却避免重复请求');
    console.log('YouTube anonymous watch metrics passed: identity, actual indifferent likes, no hypothetical/recommended counts, bounded concurrency and observation freshness');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{axios.get=original;});
