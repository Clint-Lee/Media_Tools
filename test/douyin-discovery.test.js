'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const sources=require('../lib/live-sources'),browser=require('../lib/public-browser');
const originalLight=browser.lightweightPage,originalScroll=browser.scrollMore;
const aweme=i=>({aweme_id:String(7697507167225580000n+BigInt(i)),desc:'隔离真实结构 '+i,author:{nickname:'作者'},
    video:{cover:{url_list:['https://example.com/cover.jpg']}},statistics:{play_count:0,digg_count:100},create_time:1700000000});
let time=1000;
function page(list,{hanging=false,more=true}={}) {
    const fake=new EventEmitter();
    const respond=json=>{
        const request={};fake.emit('request',request);
        fake.emit('response',{url:()=> 'https://www.douyin.com/aweme/v2/web/module/feed/',request:()=>request,json});
    };
    fake.goto=async()=>{
        respond(async()=>({aweme_list:list,has_more:more}));
        if(hanging)respond(()=>new Promise(()=>{}));
    };
    return fake;
}
(async()=>{
    browser.lightweightPage=async()=>{};
    browser.scrollMore=async()=>{time+=100;};
    const options={now:()=>time,wait:async ms=>{time+=ms;},budgetMs:2000,captureWaitMs:10};
    const result=await sources.collectDouyinPage(page([aweme(1)],{hanging:true}),{category:'all'},()=>{},options);
    assert.equal(result.list.length,1,'已到达真实视频不能被另一个卡死的响应拖成整平台502');
    assert.equal(result.partial,true);assert.equal(result.hasMore,true);
    assert.equal(result.list[0].playRaw,null);assert.equal(result.list[0].viewEvidence.status,'placeholder-zero');
    time=1000;
    const complete=await sources.collectDouyinPage(page([aweme(1)],{more:false}),{category:'all'},()=>{},options);
    assert.equal(complete.partial,false);assert.equal(complete.hasMore,false,'明确没有上游下一页时结束，不空滚到预算耗尽');
    assert.ok(time<3000);
    time=1000;
    await assert.rejects(()=>sources.collectDouyinPage(page([],{more:false}),{category:'all'},()=>{},options),/未返回可核验作品/);
    console.log('Douyin discovery passed: stalled-body isolation, honest partial results, explicit pagination and no fabricated plays');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
    browser.lightweightPage=originalLight;browser.scrollMore=originalScroll;
});
