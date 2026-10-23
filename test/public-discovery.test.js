'use strict';
const assert=require('node:assert/strict');
const creative=require('../lib/tiktok-creative');
const {videoFromPost}=require('../lib/x-public');
const {parseState}=require('../lib/red-public');
const {metadataFromDetail}=require('../lib/kuaishou-public');
const {matchesCategory}=require('../lib/video-categories');
const {prepareVideoList}=require('../lib/video-pipeline');
// TikTok Creative Center 话题趋势榜：热度是归一化指数，作品数是平台计数，两者都不是视频播放量。
const hashtagItem={hashtagID:'7691443554018656263',hashtagName:'tiktokscaryhorrorcontest',rankIndex:1,publishCnt:73462,
    popularityCurve:[{timestamp:'1791504000',value:49.96},{timestamp:'1792022400',value:100}],
    topCreators:[{nickname:'fixture',handleName:'fixture',followedCnt:101111,avatarURL:'https://p16-common-sign.tiktokcdn.com/a.jpg'}]};
const topic=creative.hashtagTopic(hashtagItem,0,'US','7days',1700000000000);
assert.equal(topic.title,'#tiktokscaryhorrorcontest');
assert.equal(topic.rank,1);
assert.equal(topic.heatRaw,100,'热度取趋势曲线最后一点');
assert.equal(topic.worksCount,73462,'作品数用平台公开计数');
assert.equal(topic.topCreators.length,1);
assert.equal(topic.source,'tiktok:creative-center-hashtag');
assert.match(topic.desc,/不是视频播放量/,'话题热度与作品数必须明确标注不是播放量');
// 没有热度曲线时保持未公开，不能补 0 或拿作品数冒充热度
assert.equal(creative.hashtagTopic({hashtagName:'x'},0,'US','7days',0).heatRaw,null);
assert.equal(creative.hashtagTopic({hashtagName:'x'},0,'US','7days',0).heatDisplay,'未公开');
// 话题名缺失必须丢弃
assert.equal(creative.hashtagTopic({hashtagID:'1'},0,'US','7days',0),null);
assert.equal(creative.latestValue([]),null);
assert.equal(creative.latestValue(null),null);
// 时间范围与地区映射必须显式
assert.equal(creative.TIME_RANGES['7days'],7);
assert.equal(creative.TIME_RANGES['3months'],90);
assert.equal(creative.REGIONS.all,'US');
const post={type:'status',id:'2110094874024219133',text:'真实结构的隔离视频',author:{screen_name:'fixture'},created_timestamp:Math.floor(Date.now()/1000),views:99999999,likes:120,media:{videos:[{type:'video',id:'media-id',url:'https://video.twimg.com/video.mp4',thumbnail_url:'https://pbs.twimg.com/cover.jpg'}]}};
assert.equal(videoFromPost(post).playRaw,null,'帖子曝光不能填进视频播放');
assert.equal(videoFromPost({...post,media:{photos:[{}]}}),null,'X图文不进入视频列表');
assert.equal(videoFromPost({...post,media:{videos:[{type:'video',url:'https://video.twimg.com.evil.test/file'}]}}),null);
const noteId='a'.repeat(24),noteUrl='https://www.xiaohongshu.com/explore/'+noteId;
const html='<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"'+noteId+'":{"note":{"noteId":"'+noteId+'","title":"undefined 不应改写","time":1700000000000,"missing":undefined}}}}};</script>';
assert.equal(parseState(html,noteUrl).title,'undefined 不应改写');
assert.equal(parseState(html,noteUrl).missing,null);
const feedHtml='<script>window.__INITIAL_STATE__='+JSON.stringify({feed:{feeds:[{id:noteId,xsecToken:'anonymous-technical-fixture',noteCard:{type:'video',displayTitle:'服务端真实视频结构',user:{nickName:'作者'},cover:{urlDefault:'https://example.com/cover.jpg'},interactInfo:{likedCount:'1.2万'}}}],placeholderFeeds:[{id:'b'.repeat(24),noteCard:{type:'video',displayTitle:'不可用的占位池'}}]},note:{noteDetailMap:{}}})+';</script>';
const ssr=require('../lib/public-discovery').redFeedFromHtml(feedHtml);
assert.equal(ssr.length,1,'只读实际feed，不能使用占位池或其它store凑数');
assert.equal(ssr[0].title,'服务端真实视频结构');
assert.equal(ssr[0].author,'作者');
assert.equal(ssr[0].metricRaw,12000);assert.equal(ssr[0].playRaw,null);
assert.equal(new URL(ssr[0].url).searchParams.get('xsec_token'),'anonymous-technical-fixture');
assert.throws(()=>parseState(html,'https://www.xiaohongshu.com/explore/'+'b'.repeat(24)),/一致/);
const ksUrl='https://www.kuaishou.com/short-video/real-id';
assert.throws(()=>metadataFromDetail({photo:{id:'wrong',photoUrl:'https://v1.kwaicdn.com/video.mp4'}},ksUrl),/不一致/);
assert.throws(()=>metadataFromDetail({photo:{id:'real-id',photoUrl:'http://127.0.0.1/video'}},ksUrl),/媒体地址/);
assert.equal(metadataFromDetail({photo:{id:'real-id',photoUrl:'https://v1.kwaicdn.com/video.mp4',duration:21000}},ksUrl).duration,21);
assert.equal(matchesCategory({title:'education story'},'pets'),false,'cat子串不能把education误判成猫');
assert.equal(matchesCategory({title:'#cats funny'},'pets'),true);
assert.equal(matchesCategory({title:'普通标题',description:'Science & Technology'},'tech'),true);
assert.ok(prepareVideoList([{id:'7123456789012345678',platform:'tiktok',playRaw:214589706,title:'官方隔离用例'}])[0].playRaw>=1e8);
(async()=>{
    const creative=require('../lib/tiktok-creative'),views=require('../lib/tiktok-views');
    const originalRanking=creative.fetchRanking,originalEnrich=views.enrich;
    creative.fetchRanking=async()=>({list:[],source:'isolated-topic-fixture'});
    views.enrich=async()=>({applied:0,pending:0});
    try {
    // 时效/关键词是同一原始采集池的本地筛选，不应每切一次就重新开3个浏览器。
    const storage=new Map();let calls=0;
    const memo=async(key,worker)=>{if(!storage.has(key))storage.set(key,Promise.resolve().then(worker));return storage.get(key);};
    const context={memo,withPage:async()=>{calls++;return {list:[{id:'7123456789012345678',title:'上海科技视频',platform:'tiktok',playRaw:100,pubdate:Math.floor(Date.now()/1000),fetchedAt:Date.now()}],hasMore:false};}};
    const options={platform:'tiktok',category:'all',timeRange:'all',query:'',page:1};
    const rankings=require('../lib/platform-rankings');
    // 发现页与标签页走浏览器；Creative Center 话题榜改走公开 HTTP 接口，不再占浏览器上下文。
    await rankings.publicPageVideos(options,context);assert.equal(calls,2);
    const filtered=await rankings.publicPageVideos({...options,timeRange:'3days',query:'上海'},context);
    assert.equal(calls,2);assert.equal(filtered.list.length,1);
    console.log('Public discovery identity, topic-ranking separation, no impression substitution, dates and shared-pool tests passed');
    }finally {creative.fetchRanking=originalRanking;views.enrich=originalEnrich;}
})().catch(error=>{console.error(error);process.exitCode=1});
