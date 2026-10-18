'use strict';
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {readMetric,metricFields,normalizeMetric}=require('../lib/metric-evidence');
const {prepareVideoList}=require('../lib/video-pipeline');
const ranking=require('../public/ranking');
const {videoDataQuality}=require('../lib/data-quality');

assert.deepEqual(readMetric('123,456 views'),{value:123456,precision:'integer',text:'123,456 views',lowerBound:null});
assert.equal(readMetric(0).value,0);assert.equal(readMetric('No views').value,0);
for(const [text,value] of [['32.3K',32300],['1.2万',12000],['2.5亿',250000000],['1.01B',1010000000]]) {
    assert.equal(readMetric(text).value,value);assert.equal(readMetric(text).precision,'source-rounded');
}
assert.deepEqual(readMetric('10万+','likes'),{value:null,precision:'lower-bound',text:'10万+',lowerBound:100000});
assert.equal(readMetric('1.2万 点赞','likes').value,12000);
assert.equal(readMetric('123 评论','comments').value,123);
for(const value of [null,undefined,-1,NaN,Infinity,1.5,'-12','1,23','1,234,56','123abc','99999999999999999','1.2','N/A'])assert.equal(readMetric(value).value,null,String(value));
assert.equal(normalizeMetric({playRaw:null,playCount:'100万'},'views').playRaw,null,'显式未知不能从旧显示值复活');
assert.equal(normalizeMetric({likeRaw:null,metric:'likes',metricRaw:99999},'likes').likeRaw,null);
const original={...metricFields('likes','1.2万'),...metricFields('views','10万+')};
const twice={...normalizeMetric(original,'likes'),...normalizeMetric(original,'views')};
assert.deepEqual(twice,original,'重复规范化保留原始缩写与下界');
const old=normalizeMetric({isCached:true,playRaw:12000},'views');
assert.equal(old.viewPrecision,'unverified');
assert.equal(normalizeMetric(old,'views').viewPrecision,'unverified','再处理不能把旧精度洗成精确整数');

const now=Date.now(),row={id:'precision-fixture',title:'隔离原始指标',platform:'youtube',url:'https://www.youtube.com/watch?v=abcdefghijk',pubdate:Math.floor(now/1000),fetchedAt:now,...original,commentCount:0,collectCount:31,shareCount:9};
const prepared=prepareVideoList([row])[0];
assert.equal(prepared.playRaw,null);assert.equal(prepared.viewLowerBound,100000);
assert.equal(prepared.likeRaw,12000);assert.equal(prepared.likeCountText,'1.2万');
assert.equal(prepared.commentCount,0,'真实零值保留');
assert.equal(ranking.summary([prepared],'views').ranked,0,'下界不进入精确播放排序');
assert.equal(videoDataQuality([prepared]).boundedViews,1);assert.equal(videoDataQuality([prepared]).roundedLikes,1);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hotpot-metric-evidence-'));
const {createIndex}=require('../lib/collection-index');
let store=createIndex({directory});store.record('youtube',[row]);
store=createIndex({directory});
const restored=store.query({platform:'youtube'}).list[0];
assert.equal(restored.viewPrecision,'lower-bound');assert.equal(restored.viewLowerBound,100000);
assert.equal(restored.likePrecision,'source-rounded');assert.equal(restored.likeCountText,'1.2万');
assert.equal(restored.commentCount,0);assert.equal(restored.collectCount,31);assert.equal(restored.shareCount,9);
store.record('youtube',[{...row,likesFetchedAt:now+1,likeSource:'isolated-counter-detail',...metricFields('likes',12345)}]);
assert.equal(createIndex({directory}).query({platform:'youtube'}).list[0].likeRaw,12345,'相同元数据的后到指标观测也须保存');

const adapters=require('../lib/platform-rankings'),sources=require('../lib/live-sources');
const v2=adapters.tiktokVideo({id:'7123456789012345678',desc:'隔离V2计数',author:{uniqueId:'fixture'},video:{cover:'https://example.com/c.jpg'},statsV2:{playCount:'123456789',diggCount:'1.2万',commentCount:'71',shareCount:'9'}});
assert.equal(v2.playRaw,123456789);assert.equal(v2.likeRaw,12000);assert.equal(v2.likePrecision,'source-rounded');assert.equal(v2.shareCount,'9');
const bili=sources.biliVideo({bvid:'BV1xx411c7mD',title:'官方互动结构',stat:{view:123,like:12,reply:3,favorite:4,share:5}},'fixture');
assert.equal(bili.commentCount,3);assert.equal(bili.collectCount,4);assert.equal(bili.shareCount,5);

const notes=require('../lib/red-public'),browser=require('../lib/public-browser'),axios=require('axios');
const originalWithPage=sources.withPage,originalLightweight=browser.lightweightPage,originalGet=axios.get;
const ids=['a','b','c','d','e'].map(c=>c.repeat(24)),url=id=>'https://www.xiaohongshu.com/explore/'+id;
assert.throws(()=>notes.remember(url(ids[0]),{noteId:ids[1],title:'不匹配'}),/一致/);
assert.throws(()=>notes.remember('https://www.tiktok.com/@fixture/video/7123456789012345678',{title:'其它平台'}),/小红书/);
let browserCalls=0,release;const gate=new Promise(resolve=>{release=resolve;}),navigated=[];
browser.lightweightPage=async(page,options)=>assert.equal(options.navigationDomain,'xiaohongshu.com');
sources.withPage=async(platform,worker,options)=>{
    browserCalls++;assert.equal(platform,'xiaohongshu');assert.equal(options.anonymous,true);
    return worker({goto:async target=>{
        navigated.push(target);await gate;
        const id=new URL(target).pathname.split('/').pop(),returned=id===ids[2]?ids[3]:id;
        return {ok:()=>true,text:async()=>'<script>window.__INITIAL_STATE__='+JSON.stringify({note:{noteDetailMap:{[id]:{note:{noteId:returned,title:'原笔记',time:now,desc:'原始正文',interactInfo:{likedCount:'10万+',commentCount:'3702',collectedCount:'7915',shareCount:'4250'}}}}}})+';</script>'};
    }});
};

(async()=>{
    const targets=[{url:url(ids[1])},{url:url(ids[2])}];
    const first=notes.enrichPublic(targets),second=notes.enrichPublic(targets);
    assert.equal(notes.pendingCount(targets),2);release();await Promise.all([first,second]);
    assert.equal(browserCalls,1,'并发补详情共用一个有界匿名任务');
    assert.equal(navigated.length,2);assert.ok(notes.peek(url(ids[1])));
    assert.equal(notes.peek(url(ids[2])),null,'错误编号的推荐作品绝不能填入目标笔记');
    await notes.enrichPublic(targets);assert.equal(navigated.length,2,'失败目标有冷却，不无限重试');
    axios.get=async()=>{throw new Error('isolated ordinary HTTP failure');};
    const fallback=await notes.getWithBrowser(url(ids[4]));
    assert.equal(fallback.note.noteId,ids[4]);assert.equal(fallback.source,'xiaohongshu:anonymous-note-page');
    const result=await require('../lib/public-discovery').publicFeed({platform:'xiaohongshu',page:1,category:'all',query:'',timeRange:'3days'},{withPage:async()=>({list:[{id:ids[1],title:'真实笔记',platform:'xiaohongshu',url:url(ids[1]),fetchedAt:now,likeRaw:12000,likePrecision:'source-rounded',likeCountText:'1.2万'}],hasMore:false,message:'隔离来源'})});
    assert.equal(result.list.length,1,'匿名核验日期可用于严格时效筛选');
    assert.equal(result.list[0].pubdate,Math.floor(now/1000));
    assert.equal(result.list[0].likeRaw,null,'新观测的10万+不能复活旧12000');
    assert.equal(result.list[0].likePrecision,'lower-bound');assert.equal(result.list[0].likeLowerBound,100000);
    assert.equal(result.list[0].commentCount,3702);assert.equal(result.list[0].collectCount,7915);assert.equal(result.list[0].shareCount,4250);
    assert.equal(result.list[0].playRaw,null,'笔记互动不能冒充视频播放');
    console.log('Metric evidence passed: exact/rounded/lower-bound counts, nulls, restart precision, V2 stats and identity-verified bounded anonymous notes');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    sources.withPage=originalWithPage;browser.lightweightPage=originalLightweight;axios.get=originalGet;
    await sources.closeBrowser();fs.rmSync(directory,{recursive:true,force:true});
});
