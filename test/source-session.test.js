'use strict';
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hotpot-sources-'));
process.env.HOTPOT_SESSION_DIR=path.join(directory,'sessions');
process.env.HOTPOT_SOURCE_CACHE=path.join(directory,'snapshots');
process.env.HOTPOT_COLLECTION_DIR=path.join(directory,'collection');
delete process.env.DOUYIN_COOKIE; delete process.env.XIAOHONGSHU_COOKIE;
const sessions=require('../lib/platform-session');
const rankings=require('../lib/platform-rankings');
const {prepareVideoList}=require('../lib/video-pipeline');
let sources=require('../lib/live-sources');
const views=require('../lib/tiktok-views'),creative=require('../lib/tiktok-creative');
const originalEnrich=views.enrich,originalRanking=creative.fetchRanking;
views.enrich=async()=>({applied:0,pending:0});
creative.fetchRanking=async()=>({list:[],source:'isolated-topic-fixture'});
(async()=>{
    const cookies=[{name:'session',value:'isolated-test-only',domain:'.xiaohongshu.com',path:'/',secure:true,httpOnly:true,expires:-1},
        {name:'unrelated',value:'must-not-import',domain:'.example.com',path:'/',expires:-1}];
    assert.equal(sessions.save('xiaohongshu',cookies),1);
    assert.equal(sessions.browserCookies('xiaohongshu')[0].httpOnly,true,'登录助手须保留HttpOnly登录Cookie');
    assert.ok(sessions.cookieFile('https://www.xiaohongshu.com/explore/note').endsWith('.cookies.txt'));
    assert.ok(fs.readFileSync(sessions.cookieFile('https://www.xiaohongshu.com/explore/note'),'utf8').includes('#HttpOnly_.xiaohongshu.com'));
    assert.throws(()=>sessions.save('../invalid',cookies));
    assert.equal(sessions.configured('douyin'),false);
    let browserCalls=0;
    const publicResult=await rankings.publicPageVideos({platform:'tiktok',category:'all',query:'',timeRange:'all',page:1},{withPage:async(platform,worker,options)=>{
        browserCalls++;assert.equal(options.anonymous,true,'公开榜单不得注入保存的个人登录Cookie');
        return {list:[{id:'7123456789012345678',title:'隔离匿名发现用例',platform:'tiktok',playRaw:123,source:'isolated:fixture'}],hasMore:false};
    }});
    assert.equal(browserCalls,2,'无登录凭证也必须尝试公开发现与标签视频；Creative Center 话题榜走公开 HTTP 接口，不占浏览器上下文');assert.equal(publicResult.list[0].playRaw,123);
    // 分区切换之后才到达的旧推荐响应，不能被归为新分区。
    const browser=require('../lib/public-browser'), savedBrowser={...browser};
    const discovery=require('../lib/public-discovery'),originalTag=discovery.tiktokTagPool;
    try {
        discovery.tiktokTagPool=async()=>({list:[]});
        const handlers={},late={url:()=>'/same-api'},initial={url:()=>'/same-api'},current={url:()=>'/same-api'},extra={url:()=>'/same-api'};
        const item=(suffix)=>({id:'712345678901234'+String(suffix).padStart(4,'0'),desc:'隔离分区作品',author:{uniqueId:'fixture'},video:{},stats:{playCount:100}});
        const emit=(kind,value)=>handlers[kind]?.forEach(fn=>fn(value));
        const response=(request,items)=>emit('response',{url:()=> 'https://www.tiktok.com/api/explore/item_list/',request:()=>request,json:async()=>({itemList:items,hasMore:false})});
        browser.lightweightPage=async()=>{};
        browser.clickCategory=async(page,labels,beforeClick)=>{beforeClick();emit('request',current);response(late,[item(999)]);response(current,[item(1)]);return true;};
        browser.scrollMore=async()=>{emit('request',extra);response(extra,Array.from({length:59},(_,i)=>item(i+2)));};
        const page={on:(kind,fn)=>(handlers[kind] ||= []).push(fn),goto:async()=>{emit('request',initial);response(initial,[item(998)]);emit('request',late);}};
        const category=await rankings.publicPageVideos({platform:'tiktok',category:'comedy',query:'',timeRange:'all',page:1},{withPage:async(platform,worker)=>worker(page)});
        assert.equal(category.list.length,60);
        assert.ok(!category.list.some(v=>[item(998).id,item(999).id].includes(v.id)),'旧分区早到/晚到响应都不能混入');
    } finally { Object.assign(browser,savedBrowser);discovery.tiktokTagPool=originalTag; }
    process.env.YOUTUBE_API_KEY='isolated-api-fixture';
    let calls=0;
    rankings.youtubeApiVideos=async()=>{calls++;return {source:'isolated:fixture',message:'隔离缓存测试',list:prepareVideoList([{id:'abcdefghijk',title:'上海技术视频',platform:'youtube',playRaw:100,pubdate:Math.floor(Date.now()/1000),fetchedAt:Date.now()}])};};
    const options={platform:'youtube',category:'all',timeRange:'all',query:''};
    await sources.getVideos(options); assert.equal(calls,1);
    assert.equal(require('../lib/collection-index').query(options).total,1,'真实采集结果自动进入可恢复索引');
    assert.equal(fs.readdirSync(process.env.HOTPOT_SOURCE_CACHE).length,1);
    const realNow=Date.now;
    try {
        Date.now=()=>realNow()+180000;
        const stale=await sources.getVideos(options);
        assert.equal(stale.stale,true); assert.equal(stale.refreshing,true);
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(calls,2);
        const fresh=await sources.getVideos(options); assert.ok(!fresh.stale);
        await sources.closeBrowser(); delete require.cache[require.resolve('../lib/live-sources')];
        sources=require('../lib/live-sources');
        await sources.getVideos(options); assert.equal(calls,2,'进程重载应能使用真实磁盘快照');
        const geo=await sources.collectedGeoVideos({...options,scope:'available'});
        assert.equal(geo.list.length,1); assert.deepEqual(geo.platforms,['youtube']);
        assert.equal(sources.aggregateGeo(geo.list)[0].city,'上海');
        rankings.youtubeApiVideos=async()=>({source:'isolated:fixture',partial:true,message:'隔离上游部分失败',list:[]});
        Date.now=()=>realNow()+360000;
        await sources.getVideos(options); await new Promise(resolve=>setImmediate(resolve));
        const partial=await sources.getVideos(options);
        assert.equal(partial.list.length,1,'部分接口失败时不应把此前真实候选全清空');
        assert.equal(partial.coverage.retainedCandidates,1);
        assert.equal(partial.list[0].isCached,true);
        assert.ok(partial.list[0].fetchedAt<Date.now(),'不能给保留记录补当前时间');
        rankings.youtubeApiVideos=async()=>({source:'isolated:fixture',scope:{kind:'public-discover-sample'},message:'隔离轮换发现流',list:prepareVideoList([{id:'zyxwvutsrqp',title:'新发现作品',platform:'youtube',playRaw:200,pubdate:Math.floor(Date.now()/1000),fetchedAt:Date.now()}])});
        const rotating=await sources.getVideos({...options,refresh:true});
        assert.equal(rotating.list.length,2,'发现流轮换不能立即丢弃同一筛选下30分钟内已采集作品');
        assert.equal(rotating.list[0].id,'zyxwvutsrqp');
        assert.ok(rotating.message.includes('公开发现流会轮换'));
        Date.now=()=>realNow()+2100000;
        const expired=await sources.getVideos({...options,refresh:true});
        assert.equal(expired.list.length,1,'过期的真实样本也不能无限保留');
        const collection=require('../lib/collection-index'), originalRecord=collection.record;
        try {
            collection.record=()=>{throw new Error('隔离磁盘写入失败');};
            const unsaved=await sources.getVideos({...options,refresh:true});
            assert.equal(unsaved.list.length,1,'历史索引故障不能丢掉本次成功的实时数据');
            assert.equal(unsaved.collection.status,'write-failed');
            assert.match(unsaved.collection.message,/写入失败/);
        } finally {collection.record=originalRecord;}
    } finally { Date.now=realNow; }
    console.log('source/session tests passed (isolated fixtures, no platform credentials)');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{views.enrich=originalEnrich;creative.fetchRanking=originalRanking;await sources.closeBrowser();fs.rmSync(directory,{recursive:true,force:true});});
