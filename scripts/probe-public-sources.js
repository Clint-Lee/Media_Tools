'use strict';
// 只检查正常公开页面；不使用登录Cookie，不处理或绕过验证码。
require('../lib/env');
const fs=require('fs'),path=require('path');
const {withPage,boundedMap,closeBrowser}=require('../lib/live-sources');
const targets=[
    ['douyin','discover','https://www.douyin.com/discover'],
    ['douyin','search','https://www.douyin.com/search/%E7%A7%91%E6%8A%80?type=video'],
    ['tiktok','trends','https://ads.tiktok.com/creative/creativeCenter/trends'],
    ['tiktok','trending-videos','https://ads.tiktok.com/creative/creativeCenter/trends/video?region=US'],
    ['tiktok','search','https://www.tiktok.com/search/video?q=technology'],
    ['tiktok','explore','https://www.tiktok.com/explore'],
    ['tiktok','viral','https://www.tiktok.com/tag/viral'],
    ['tiktok','mostviewed','https://www.tiktok.com/tag/mostviewed'],
    ['tiktok','discover','https://www.tiktok.com/discover/most-viewed-videos'],
    ['xiaohongshu','explore','https://www.xiaohongshu.com/explore'],
    ['xiaohongshu','home','https://www.xiaohongshu.com'],
    ['kuaishou','search','https://www.kuaishou.com/search/video?searchKey=%E7%A7%91%E6%8A%80'],
    ['kuaishou','brilliant','https://www2.kuaishou.com/brilliant'],
    ['twitter','timeline','https://syndication.twitter.com/srv/timeline-profile/screen-name/NASA']
].filter(row=>!process.argv[2] || row[0]===process.argv[2]);
(async()=>{
    if(!process.env.MEDIA_PROXY)try{const settings=await(await fetch('http://127.0.0.1:4000/api/settings',{signal:AbortSignal.timeout(1500)})).json();if(settings.proxy)process.env.MEDIA_PROXY=settings.proxy;}catch{}
    await boundedMap(targets,2,async([platform,kind,url])=>{
        const started=Date.now(),captures=[],records=[];
        try{
            const result=await withPage(platform,async page=>{
                await page.setRequestInterception(true);
                page.on('request',r=>['image','font','media'].includes(r.resourceType())?r.abort():r.continue());
                page.on('response',response=>{
                    if(!/json/.test(response.headers()['content-type'] || '') || !new URL(response.url()).hostname.endsWith(new URL(url).hostname.split('.').slice(-2).join('.')))return;
                    captures.push(response.json().then(data=>records.push({url:response.url(),status:response.status(),method:response.request().method(),body:response.request().postData(),data})).catch(()=>{}));
                });
                await page.goto(url,{waitUntil:'domcontentloaded',timeout:14000}).catch(()=>{});
                if(platform==='xiaohongshu') { const close=await page.$('.close-button'); if(close)await close.click().catch(()=>{}); }
                await page.evaluate(()=>window.scrollBy(0,800));
                await new Promise(resolve=>setTimeout(resolve,3000));
                const state=await page.evaluate(()=>({url:location.href,title:document.title,text:document.body?.innerText?.slice(0,1500),
                    controls:[...document.querySelectorAll('a,button,[role="button"]')].filter(e=>/科技|知识|喜剧|动物|穿搭|推荐|精选/.test(e.textContent) && e.textContent.length<30).map(e=>({tag:e.tagName,text:e.textContent,href:e.getAttribute('href'),attrs:[...e.attributes].filter(a=>/data-|class/.test(a.name)).map(a=>[a.name,a.value])})).slice(0,30),
                    scrollers:[...document.querySelectorAll('main,div')].filter(e=>e.clientHeight>300 && e.scrollHeight>e.clientHeight+200).slice(0,10).map(e=>({tag:e.tagName,classes:e.className,height:e.clientHeight,scrollHeight:e.scrollHeight})),
                    initial:window.__INITIAL_STATE__ || window.__APOLLO_STATE__ || null,router:window._ROUTER_DATA || null,
                    scripts:[...document.querySelectorAll('script[type="application/json"],#RENDER_DATA,#SIGI_STATE,#__UNIVERSAL_DATA_FOR_REHYDRATION__,#__NEXT_DATA__')].map(s=>({id:s.id,text:s.textContent?.slice(0,4000000)}))}));
                await Promise.allSettled(captures);return state;
            },{anonymous:true});
            const filename=path.join(__dirname,'..','.cache','public-probes',platform+'-'+kind+'.json');fs.mkdirSync(path.dirname(filename),{recursive:true});
            fs.writeFileSync(filename,JSON.stringify({checkedAt:new Date().toISOString(),anonymous:true,result,records}));
            console.log(JSON.stringify({platform,kind,ms:Date.now()-started,title:result.title,url:result.url,text:result.text?.slice(0,260),records:records.map(r=>({path:new URL(r.url).pathname,status:r.status,keys:r.data&&typeof r.data==='object'?Object.keys(r.data):[]})),initialKeys:result.initial?Object.keys(result.initial):[],routerKeys:result.router?Object.keys(result.router):[],scripts:result.scripts.map(s=>({id:s.id,bytes:s.text?.length}))}));
        }catch(error){console.log(JSON.stringify({platform,kind,ms:Date.now()-started,error:error.message}));}
    });
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(closeBrowser);
