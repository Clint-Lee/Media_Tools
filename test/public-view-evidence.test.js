'use strict';
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {douyinViews,redViews}=require('../lib/public-view-evidence');
const {prepareVideoList}=require('../lib/video-pipeline'),ranking=require('../public/ranking');
const {videoDataQuality}=require('../lib/data-quality');
const id='a'.repeat(24),url='https://www.xiaohongshu.com/explore/'+id,at=1700000000000;
const note={noteId:id,type:'video',title:'原作品',video:{},interactInfo:{likedCount:'1047',collectedCount:'240',commentCount:'58',shareCount:'72'}};
function page(count,extra={}) {
    return '<script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@type':'VideoObject',name:'原作品 - 小红书',
        interactionStatistic:{'@type':'InteractionCounter',interactionType:'https://schema.org/WatchAction',userInteractionCount:count},...extra})+'</script>';
}
const aggregate=redViews(page(1345),url,note,at);
assert.equal(aggregate.playRaw,null,'真实页面的1047+240+58不能冒充1345次播放');
assert.equal(aggregate.viewEvidence.status,'aggregate-interactions');assert.equal(aggregate.viewEvidence.reportedValue,1345);
assert.equal(aggregate.viewsFetchedAt,at);assert.equal(aggregate.viewPrecision,'unknown');
const another={...note,interactInfo:{likedCount:'6773',collectedCount:'1418',commentCount:'300'}};
assert.equal(redViews(page(8491),url,another).viewEvidence.status,'aggregate-interactions','另一实际结构仍是互动合计');
assert.equal(redViews(page(null),url,note).playRaw,null,'null不是零播放');
assert.equal(redViews(page(null),url,note).viewEvidence.status,'not-provided');
assert.equal(redViews(page(0),url,note).playRaw,null,'不信任已被证实混入互动合计的schema零值');
assert.equal(redViews(page(999999),url,note).viewEvidence.status,'unverified-schema','不能只凭WatchAction标签信任其它schema值');
assert.equal(redViews(page(1345),url,{...note,interactInfo:{likedCount:'1.2万',collectedCount:'240',commentCount:'58'}}).viewEvidence.status,'unverified-schema','不能对缩写点赞运算后编造播放');
assert.equal(redViews(page(1345,{url:'https://www.xiaohongshu.com/explore/'+'b'.repeat(24)}),url,note).viewEvidence.status,'not-provided','相同标题但不同编号不能借计数');
assert.equal(redViews(page(1345),url,{...note,noteId:'b'.repeat(24)}).viewEvidence.status,'identity-mismatch');
assert.equal(redViews(page(1345),'https://example.com/explore/'+id,note).viewEvidence.status,'identity-mismatch');
assert.equal(redViews(page(1345,{name:'推荐作品'}),url,note).viewEvidence.status,'not-provided');
assert.equal(redViews(page(1345,{interactionStatistic:{interactionType:'https://schema.org/LikeAction',userInteractionCount:1345}}),url,note).viewEvidence.status,'not-provided');
assert.equal(redViews('<script type="application/ld+json">{broken</script>',url,note).playRaw,null);
assert.equal(redViews(page(1345,{name:'原作品#标签 - 小红书'}),url,{...note,title:'原作品#标签[话题]#'.slice(0,-1)}).viewEvidence.status,'aggregate-interactions');
assert.equal(redViews(page(1345,{name:'原作品#标签#讨论 - 小红书'}),url,{...note,title:'',desc:'原作品#标签[话题]##讨论[话题]#'}).viewEvidence.status,'aggregate-interactions');
const dy={aweme_id:'7697507167225580836',statistics:{play_count:0,digg_count:158229}};
const placeholder=douyinViews(dy,at);
assert.equal(placeholder.playRaw,null);assert.equal(placeholder.viewEvidence.status,'placeholder-zero');
assert.equal(douyinViews({...dy,statistics:{play_count:'123456'}}).playRaw,123456);
for(const value of [true,{},[],1.5,-1,Infinity,'NaN','1.2万',Number.MAX_SAFE_INTEGER+1]) {
    assert.equal(douyinViews({...dy,statistics:{play_count:value}}).playRaw,null,String(value));
}
assert.equal(douyinViews({...dy,statistics:{play_count:123,aweme_id:'7697507167225580837'}}).viewEvidence.status,'identity-mismatch');
assert.equal(douyinViews({...dy,statistics:{}}).viewEvidence.status,'not-provided');
const list=prepareVideoList([
    {id:'aggregate',title:'小红书互动合计',platform:'xiaohongshu',likeRaw:1047,...aggregate},
    {id:'placeholder',title:'抖音零占位',platform:'douyin',likeRaw:158229,...placeholder}
]);
assert.equal(ranking.summary(list,'views').ranked,0);
assert.equal(videoDataQuality(list).status,'metadata-only');
assert.deepEqual(videoDataQuality(list).rejectedViewEvidence,{zeroPlaceholders:1,interactionAggregates:1,unverifiedSchema:0});
assert.equal(ranking.summary(list,'likes').ranked,2,'辅助点赞不消失，也不自动参与播放榜');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hotpot-view-evidence-'));
try {
    const {createIndex}=require('../lib/collection-index'),store=createIndex({directory});
    store.record('xiaohongshu',[{...list.find(v=>v.id==='aggregate'),fetchedAt:Date.now()}]);
    const restored=createIndex({directory}).query({platform:'xiaohongshu'}).list[0];
    assert.equal(restored.playRaw,null);assert.equal(restored.viewEvidence.status,'aggregate-interactions','重启后保留拒绝理由，不能把互动合计洗成播放');
}finally {fs.rmSync(directory,{recursive:true,force:true});}
console.log('Public view evidence passed: real schema interaction-sum rejection, null/zero, identity, safe positive Douyin counters and strict view ranking');
