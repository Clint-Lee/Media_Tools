'use strict';
// Normal anonymous UI navigation only; no personal cookies, signatures or challenge handling.
require('../lib/env');
const fs=require('fs'),path=require('path');
const sources=require('../lib/live-sources'),{redFeedFromHtml}=require('../lib/public-discovery');
const {parseState}=require('../lib/red-public');
function videoShape(video) {
    return [video?.media,video?.mediaV2,video?.media_v2].filter(Boolean).map(media=>{
        if(typeof media==='string')try{media=JSON.parse(media);}catch{return {invalidJson:true};}
        return {keys:Object.keys(media),streams:Object.entries(media.stream || {}).map(([codec,formats])=>({codec,count:Array.isArray(formats)?formats.length:null,keys:Object.keys(formats?.[0] || {}),videoCodec:formats?.[0]?.video_codec || formats?.[0]?.videoCodec}))};
    });
}
(async()=>{
    const report=await sources.withPage('xiaohongshu',async page=>{
        const responses=[],captures=[];
        page.on('response',response=>{
            if(!/\/api\/sns\/web\/v\d+\/feed(?:\?|$)/.test(response.url()))return;
            captures.push(response.json().then(data=>responses.push({status:response.status(),code:data.code,items:(data.data?.items || []).map(item=>{
                const note=item.note_card || item.noteCard || {};
                return {id:item.id || note.note_id || note.noteId,type:note.type,time:note.time,metrics:note.interact_info || note.interactInfo || {},videoKeys:Object.keys(note.video || {}),videoShape:videoShape(note.video)};
            })})).catch(()=>{}));
        });
        await require('../lib/public-browser').lightweightPage(page);
        const navigation=await page.goto('https://www.xiaohongshu.com/explore',{waitUntil:'domcontentloaded',timeout:16000});
        const videos=redFeedFromHtml(await navigation.text());
        if(!videos.length)return {videos:0};
        const target=videos[0];
        try {await page.waitForSelector('.close-button',{visible:true,timeout:3000});await page.click('.close-button');}catch{}
        const selector='.note-item[data-note-id="'+target.id+'"] a.cover';
        const link=await page.$(selector);
        if(link){await link.click();await new Promise(resolve=>setTimeout(resolve,1800));}
        const ui=await page.evaluate(()=>({url:location.pathname,hasPlayer:Boolean(document.querySelector('video')),hasLoginPrompt:Boolean(document.querySelector('.login-container'))}));
        await Promise.allSettled(captures);
        let share;
        try {
            const response=await page.goto(target.url,{waitUntil:'domcontentloaded',timeout:10000});
            const note=parseState(await response.text(),target.url);
            share={matched:true,id:note.noteId || note.note_id,time:note.time,metrics:note.interactInfo || note.interact_info || {},videoKeys:Object.keys(note.video || {}),videoShape:videoShape(note.video)};
        }catch(error){share={matched:false,error:error.message};}
        return {videos:videos.length,id:target.id,ui,responses,share};
    },{anonymous:true});
    const directory=path.join(__dirname,'..','.cache','verification');fs.mkdirSync(directory,{recursive:true});
    const output={checkedAt:new Date().toISOString(),anonymous:true,...report};
    fs.writeFileSync(path.join(directory,'red-note-metric-probe-latest.json'),JSON.stringify(output,null,2));
    console.log(JSON.stringify(output));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(sources.closeBrowser);
