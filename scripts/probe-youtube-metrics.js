'use strict';
// Read the normal public watch document. Never execute scripts or use a personal session.
require('../lib/env');
const axios=require('axios'),{HttpsProxyAgent}=require('https-proxy-agent');
(async()=>{
    const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:4000';
    const feed=await(await fetch(base+'/api/trends?platform=youtube&final=1')).json(),video=process.argv[2]?feed.list?.find(v=>v.id===process.argv[2]):feed.list?.[0];
    if(!video || !/^[\w-]{11}$/.test(video.id))throw new Error('需要真实YouTube作品编号');
    const settings=await(await fetch(base+'/api/settings')).json(),proxy=process.env.MEDIA_PROXY || settings.proxy;
    const response=await axios.get('https://www.youtube.com/watch',{params:{v:video.id,hl:'en'},proxy:false,timeout:15000,maxContentLength:8*1024*1024,
        headers:{'User-Agent':require('../lib/live-sources').UA,'Accept-Language':'en-US,en;q=0.9'},...(proxy?{httpsAgent:new HttpsProxyAgent(proxy)}:{})});
    const notes=require('../lib/youtube-public'),value=notes.parseWatch(String(response.data),video.id);
    const data=notes.initialObject(String(response.data),'ytInitialData'),walk=require('../lib/platform-rankings').walk;
    const primary=walk(data,node=>Boolean(node.videoPrimaryInfoRenderer))[0]?.videoPrimaryInfoRenderer;
    const entities=walk(data,node=>Boolean(node.likeCountEntity)).map(node=>({keys:Object.keys(node.likeCountEntity),indifferent:node.likeCountEntity.likeCountIfIndifferentNumber,expanded:node.likeCountEntity.expandedLikeCountIfIndifferent?.content,display:node.likeCountEntity.likeCountIfIndifferent?.content}));
    const legacy=walk(primary,node=>Boolean(node.toggleButtonRenderer)).map(node=>({text:node.toggleButtonRenderer.defaultText,accessibility:node.toggleButtonRenderer.accessibility}));
    console.log(JSON.stringify({checkedAt:new Date().toISOString(),id:value.id,views:value.playRaw,likes:value.likeRaw,likePrecision:value.likePrecision,pubdate:value.pubdate,source:value.source,primaryKeys:Object.keys(primary || {}),entities,legacy}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
