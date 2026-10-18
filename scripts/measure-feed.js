'use strict';
// Non-mutating live diagnostics. Does not inject cookies or clear anyone's source caches.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:4000';
const platforms=(process.argv[2] || 'bilibili,tiktok').split(',');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function read(platform,extra={}) {
    const started=Date.now();
    const response=await fetch(base+'/api/trends?'+new URLSearchParams({platform,category:'all',timeRange:'all',...extra}),{signal:AbortSignal.timeout(60000)});
    const data=await response.json();
    return {ms:Date.now()-started,status:response.status,data};
}
function describe(result) {
    return {ms:result.ms,status:result.status,videos:result.data.list?.length || 0,withViews:(result.data.list || []).filter(v=>v.playRaw!=null).length,
        maxViews:result.data.list?.[0]?.playRaw ?? null,refreshing:Boolean(result.data.refreshing),stale:Boolean(result.data.stale),source:result.data.source};
}
(async()=>{
    const report={checkedAt:new Date().toISOString(),base,cacheState:'determined by server; this script never clears cache',platforms:[]};
    for(const platform of platforms) {
        const started=Date.now(),first=await read(platform);let current=first;
        while(current.data.refreshing && Date.now()-started<45000) {await pause(1000);current=await read(platform);}
        const settledAfterMs=Date.now()-started;
        const filters=[];
        for(const extra of [{timeRange:'7days'},{category:'tech'}]) {
            const result=await read(platform,extra),list=result.data.list || [];
            if(extra.timeRange)assert.ok(list.every(v=>v.pubdate>=Date.now()/1000-7*86400-2 && v.pubdate<=Date.now()/1000+2),'时效筛选不可混入旧日期或未知日期');
            const known=list.filter(v=>v.playRaw!=null);assert.ok(known.every((v,i)=>!i || known[i-1].playRaw>=v.playRaw),'真实播放必须降序');
            filters.push({...extra,...describe(result)});
        }
        const row={platform,first:describe(first),settled:describe(current),settledAfterMs,filters};
        report.platforms.push(row);console.log(JSON.stringify(row));
    }
    const directory=path.join(__dirname,'..','.cache','verification');fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,'feed-performance.json'),JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
