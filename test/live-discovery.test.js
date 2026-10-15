'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:4000';
(async()=>{
    const report={checkedAt:new Date().toISOString(),anonymous:true,platforms:[],filters:[]};
    async function read(params,route='/api/trends') {
        const start=Date.now(),response=await fetch(base+route+'?'+new URLSearchParams(params),{signal:AbortSignal.timeout(55000)}),data=await response.json();
        assert.equal(response.status,200,data.message);assert.equal(data.success,true);
        return {data,ms:Date.now()-start};
    }
    for(const platform of ['tiktok','kuaishou','xiaohongshu','twitter']) {
        const {data,ms}=await read({platform,refresh:1});
        assert.ok(data.list.length>0,platform+'需要实际作品，不能只返回成功空数组');
        let previous=Infinity;
        for(const v of data.list){assert.ok(v.id && v.url && v.cover);if(v.playRaw!=null){assert.ok(v.playRaw<=previous);previous=v.playRaw;}}
        if(platform==='tiktok')assert.ok(data.list.some(v=>v.playRaw>=1e8),'公开累计播放来源应覆盖已核验的过亿作品，不能退回单次推荐小池');
        const row={platform,count:data.list.length,knownViews:data.list.filter(v=>v.playRaw!=null).length,knownDates:data.list.filter(v=>v.pubdate).length,maxViews:data.list[0].playRaw,ms,source:data.source,coverage:data.coverage};
        report.platforms.push(row);console.log(JSON.stringify(row));
        if(platform==='tiktok')for(const timeRange of ['3days','7days']) {
            const filtered=await read({platform,timeRange});
            const now=Date.now()/1000,max=(timeRange==='3days'?3:7)*86400;
            assert.ok(filtered.data.list.every(v=>v.pubdate>0 && now-v.pubdate<=max+5 && v.pubdate<=now+300));
            const timing={platform,timeRange,ms:filtered.ms,count:filtered.data.list.length,preview:filtered.data.refreshing};report.filters.push(timing);console.log(JSON.stringify(timing));
        }
    }
    const directory=path.join(__dirname,'..','.cache','verification');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'live-discovery-report.json'),JSON.stringify(report,null,2));
    console.log('Real anonymous platform lists, >100M TikTok coverage, view sorting and strict filter checks passed');
})().catch(error=>{console.error(error);process.exitCode=1});
