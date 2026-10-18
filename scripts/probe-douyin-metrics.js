'use strict';
require('../lib/env');
const fs=require('fs'),path=require('path'),axios=require('axios'),sources=require('../lib/live-sources');
(async()=>{
    const response=await fetch('http://127.0.0.1:4000/api/trends?platform=douyin&final=1',{signal:AbortSignal.timeout(45000)});
    const data=await response.json(),video=data.list?.[0];
    if(!video || !/^\d{15,22}$/.test(video.id))throw new Error('先取得真实抖音作品，不能使用虚构ID探查');
    const results=[];
    const oldUrl='https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids='+video.id;
    try {
        const response=await axios.get(oldUrl,{proxy:false,timeout:6000,headers:{'User-Agent':sources.UA}});
        const rows=sources.collectAwemes(response.data).filter(v=>String(v.aweme_id)===video.id);
        results.push({source:'legacy-public-iteminfo',status:response.status,matchingVideos:rows.length,statistics:rows.map(v=>v.statistics)});
    }catch(error){results.push({source:'legacy-public-iteminfo',status:error.response?.status || 0,error:error.message});}
    results.push(await sources.withPage('douyin',async page=>{
        await require('../lib/public-browser').lightweightPage(page);
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1');
        const response=await page.goto('https://www.iesdouyin.com/share/video/'+video.id,{waitUntil:'domcontentloaded',timeout:12000});
        const embedded=await page.evaluate(()=>{
            let render;try{render=JSON.parse(decodeURIComponent(document.querySelector('#RENDER_DATA')?.textContent || ''));}catch{}
            return {router:window._ROUTER_DATA,render,text:document.body?.innerText?.slice(0,180)};
        });
        const rows=sources.collectAwemes(embedded).filter(v=>String(v.aweme_id)===video.id);
        return {source:'normal-mobile-share',status:response.status(),matchingVideos:rows.length,statistics:rows.map(v=>v.statistics),text:embedded.text};
    },{anonymous:true}));
    const report={checkedAt:new Date().toISOString(),anonymous:true,id:video.id,feed:{playRaw:video.playRaw,likeRaw:video.likeRaw},results};
    const directory=path.join(__dirname,'..','.cache','verification');fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,'douyin-metric-probe.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(sources.closeBrowser);
