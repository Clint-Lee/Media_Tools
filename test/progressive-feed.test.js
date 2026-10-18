'use strict';
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hotpot-progress-'));
process.env.HOTPOT_SOURCE_CACHE=path.join(directory,'snapshots');
process.env.HOTPOT_COLLECTION_DIR=path.join(directory,'collection');
const sources=require('../lib/live-sources'),adapters=require('../lib/platform-rankings');
const original=adapters.publicPageVideos;
const video=id=>({id,title:'真实结构的隔离用例',platform:'tiktok',playRaw:100,pubdate:Math.floor(Date.now()/1000),fetchedAt:Date.now()});
const options={platform:'tiktok',category:'all',timeRange:'all',query:'',page:1};
(async()=>{
    let finish,calls=0;
    adapters.publicPageVideos=async(o,{onProgress})=>{
        calls++;
        onProgress({list:[video('7123456789012345678')],message:'首个来源',source:'isolated:fixture'});
        return new Promise(resolve=>{finish=resolve;});
    };
    const first=await sources.getVideos(options);
    assert.equal(first.list.length,1);assert.equal(first.refreshing,true);assert.equal(first.progressive,true);
    assert.ok(!fs.existsSync(process.env.HOTPOT_SOURCE_CACHE),'未完成结果不能写成持久终态缓存');
    const again=await sources.getVideos(options);
    assert.equal(again.list.length,1);assert.equal(calls,1,'轮询必须复用同一个采集任务');
    let forceReturned=false;
    const forced=sources.getVideos({...options,refresh:true}).then(value=>{forceReturned=true;return value;});
    let finalReturned=false;
    const finalWaiter=sources.getVideos({...options,final:true}).then(value=>{finalReturned=true;return value;});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(forceReturned,false,'显式强制核验应等待完整任务，而不是把进行中的首批当终态');
    assert.equal(finalReturned,false,'final=1即使遇到别的进行中首批，也必须等待终态');
    const final={list:[video('7123456789012345678'),video('7123456789012345679')],message:'采集完成',source:'isolated:fixture',hasMore:true};
    finish(final);await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await forced).list.length,2);
    assert.equal((await finalWaiter).list.length,2);
    const complete=await sources.getVideos(options);
    assert.equal(complete.list.length,2);assert.ok(!complete.refreshing);assert.equal(complete.hasMore,true);
    assert.equal(require('../lib/collection-index').query(options).total,2);
    let fail;
    adapters.publicPageVideos=async(o,{onProgress})=>{
        onProgress({list:[video('7123456789012345678')],message:'真实首批',source:'isolated:fixture'});
        return new Promise((resolve,reject)=>{fail=reject;});
    };
    const filtered={...options,category:'comedy'};
    // Force a cold independent key, not a warm preview of the all-category pool.
    const cold={...filtered,page:2};
    assert.equal((await sources.getVideos(cold)).refreshing,true);
    fail(new Error('隔离上游故障'));await new Promise(resolve=>setImmediate(resolve));
    const retained=await sources.getVideos(cold);
    assert.equal(retained.list.length,1);assert.equal(retained.refreshing,false);
    assert.match(retained.message,/隔离上游故障/);
    console.log('Progressive feed: real first batch, shared job, final replacement, persistence and failure backoff passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    adapters.publicPageVideos=original;await sources.closeBrowser();fs.rmSync(directory,{recursive:true,force:true});
});
