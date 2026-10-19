'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
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
let requests=0,concurrency=0,maxConcurrency=0;
let clock=Date.now();
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hotpot-youtube-test-'));
const http={get:async(url,options)=>{
    requests++;concurrency++;maxConcurrency=Math.max(maxConcurrency,concurrency);
    assert.equal(url,'https://www.youtube.com/watch');assert.equal(options.params.hl,'en');assert.equal(options.maxRedirects,0);
    await new Promise(resolve=>setTimeout(resolve,5));concurrency--;
    return {data:html(options.params.v==='12345678901'?'wrongvideox':options.params.v)};
}};
(async()=>{
    const client=notes.createClient({http,directory,now:()=>clock});
    const list=[id,'lmnopqrstuv','12345678901','ABCDEFGHIJK'].map(videoId=>({id:videoId,title:'原搜索标题',playRaw:123456700,fetchedAt:Date.now()-10000}));
    const first=client.enrich(list),second=client.enrich(list);
    assert.equal(client.pendingCount(list),4);
    await Promise.all([first,second]);
    assert.equal(requests,4,'相同批次并发请求合并');assert.ok(maxConcurrency<=3);
    const enriched=client.apply(list);assert.equal(enriched[0].likeRaw,100);assert.equal(enriched[0].playRaw,123456789);
    assert.equal(enriched[0].viewSource,'youtube:public-watch');assert.equal(enriched[0].title,value.title);
    assert.equal(enriched[2],list[2],'身份不匹配不能补任何字段');
    const newer=client.apply([{...list[0],playRaw:123456999,fetchedAt:clock+1000}])[0];
    assert.equal(newer.playRaw,123456999,'新搜索播放观测不能被旧详情覆盖');assert.equal(newer.likeRaw,100);
    assert.ok(newer.likesFetchedAt<newer.fetchedAt,'独立保留真实点赞观测时刻');
    await client.enrich(list);assert.equal(requests,4,'真实缓存与失败冷却避免重复请求');
    const freshLike={...list[0],likeRaw:200,likesFetchedAt:clock+1000,isCached:true};
    assert.equal(client.apply([freshLike])[0].likeRaw,200,'较新点赞不能被旧详情覆盖');
    assert.equal(client.apply([freshLike])[0].isCached,true,'详情缓存不能冒充整件作品刚刚采集');
    assert.equal(client.apply([list[0]])[0].fetchedAt,list[0].fetchedAt);
    const unknown={...freshLike,likeRaw:null};
    assert.equal(client.apply([unknown])[0].likeRaw,null,'较新明确隐藏观测不能复活旧计数');
    const bound={...list[0],...require('../lib/metric-evidence').metricFields('likes','10万+'),fetchedAt:clock+1000};
    assert.equal(client.apply([bound])[0].likeLowerBound,100000,'较新公开下界同样是观测，不能被旧详情替换');
    const independent={...freshLike,fetchedAt:clock+1000,viewsFetchedAt:clock-1000,playRaw:1};
    assert.equal(client.apply([independent])[0].playRaw,123456789,'分别比较播放量与点赞观测时间');

    const saved=JSON.parse(fs.readFileSync(path.join(directory,'metrics.json'),'utf8'));
    assert.equal(saved.rows.length,3);
    assert.equal(saved.rows[0].title,undefined);assert.equal(saved.rows[0].cover,undefined);assert.equal(saved.rows[0].url,undefined);
    const restarted=notes.createClient({http,directory,now:()=>clock});
    await restarted.enrich([list[0]]);assert.equal(requests,4,'重启复用未过期真实指标');
    assert.equal(restarted.apply([list[0]])[0].likesFetchedAt,clock,'重启不能补造观测时刻');
    assert.equal(restarted.status().storage,'ready');
    clock+=300001;
    const expired=notes.createClient({http,directory,now:()=>clock});
    assert.equal(expired.apply([list[0]])[0],list[0],'过期磁盘数据不能混入实时榜');
    assert.equal(restarted.status().cached,0,'状态不把过期内存记录统计为可用缓存');
    await expired.enrich([list[0]]);assert.equal(requests,5,'过期指标重新核验');

    let release;const gate=new Promise(resolve=>{release=resolve;});const requested=[];
    const queued=notes.createClient({directory:null,http:{get:async(url,options)=>{
        requested.push(options.params.v);await gate;return {data:html(options.params.v)};
    }}});
    const batchA=queued.enrich(list.slice(0,3)),batchB=queued.enrich([list[3]]);
    assert.equal(queued.pendingCount([list[3]]),1,'新分类任务排队而非被正在运行的旧批次吞掉');
    assert.equal(requested.length,3,'所有分类共用三路并发上限');
    release();await Promise.all([batchA,batchB]);
    assert.deepEqual(new Set(requested),new Set(list.map(v=>v.id)));
    assert.equal(queued.apply([list[3]])[0].likeRaw,100);

    const tail=notes.createClient({directory:null,http,now:()=>clock});
    const longList=Array.from({length:35},(_,i)=>({id:'sample'+String(i).padStart(5,'0')}));
    const before=requests;await tail.enrich(longList);
    assert.equal(requests-before,30,'单次请求最多新增30项，避免整池无界预取');
    await tail.enrich(longList);assert.equal(requests-before,35,'后续请求继续长尾，不重复挤占首批');
    assert.ok(maxConcurrency<=3);

    let hidden=false;
    const visibility=notes.createClient({directory:null,http:{get:async()=>({data:html(id,{entity:!hidden})})},now:()=>clock});
    await visibility.enrich([list[0]]);hidden=true;clock+=300001;await visibility.enrich([list[0]]);
    assert.equal(visibility.apply([{...list[0],likeRaw:100,likesFetchedAt:clock-1000}])[0].likeRaw,null,'较新隐藏指标必须覆盖旧真实计数');

    const broken=notes.createClient({directory,http,io:{existsSync:()=>true,readFileSync:()=>'{broken',mkdirSync:()=>{throw new Error('disk full');}},now:()=>clock});
    assert.equal(broken.status().storage,'read-failed');
    await broken.enrich([list[0]]);
    assert.equal(broken.status().storage,'write-failed');assert.equal(broken.apply([list[0]])[0].likeRaw,100,'磁盘失败不丢失本次真实观测');
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'metrics.json'),'utf8')).version,1,'失败不能覆盖原缓存');
    console.log('YouTube anonymous metrics passed: identity, actual likes, per-counter freshness, concurrent categories, restart/expiry, bounded queue and disk failure');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{fs.rmSync(directory,{recursive:true,force:true});});
