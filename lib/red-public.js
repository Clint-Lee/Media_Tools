'use strict';
const axios=require('axios');
const {identity,redNote}=require('./media-identity');
const cache=new Map(),pending=new Map(),failures=new Map();
let browserJob;
const browserAttempts=new Map();
function parseInitialState(html) {
    const match=String(html).match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
    if(!match)throw new Error('小红书公开页面未提供实际笔记数据');
    // 只替换字符串以外的undefined，避免改写标题/原文里的这个单词。绝不eval网页代码。
    let result='',quoted=false,escaped=false;
    for(let i=0;i<match[1].length;i++) {
        const char=match[1][i];
        if(quoted){result+=char;if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;}
        else if(char==='"'){quoted=true;result+=char;}
        else if(match[1].slice(i,i+9)==='undefined'){result+='null';i+=8;}
        else result+=char;
    }
    return JSON.parse(result);
}
function parseState(html,url) { return redNote(parseInitialState(html),url); }
function videoUrl(note) {
    if(!note || typeof note!=='object')return null;
    const sources=[note.video?.media,note.video?.mediaV2,note.video?.media_v2,note.media,note.video];
    for(let media of sources) {
        if(!media)continue;
        if(typeof media==='string')try {media=JSON.parse(media);}catch {continue;}
        const stream=media?.stream;if(!stream || typeof stream!=='object')continue;
        const codecs=new Set(['h264','avc','EF4','h265','hevc','EF5','EF6','av1',...Object.keys(stream)]);
        for(const codec of codecs) {
            const formats=Array.isArray(stream[codec])?stream[codec]:[];
            const ordered=[...formats.filter(f=>f.defaultStream || f.default_stream),...formats];
            for(const format of ordered) {
                if(!format || typeof format!=='object')continue;
                const candidates=[
                    format.masterUrl, format.master_url,
                    format.mainUrl, format.main_url,
                    ...(Array.isArray(format.backupUrls)?format.backupUrls:[]),
                    ...(Array.isArray(format.backup_urls)?format.backup_urls:[])
                ];
                for(const raw of candidates) {
                    if(!raw || typeof raw!=='string')continue;
                    try {
                        const url=require('./safe-network').parsePublicUrl(raw);
                        const host=url.hostname;
                        const isAllowed=(
                            url.protocol==='https:' &&
                            (host==='xhscdn.com' || host.endsWith('.xhscdn.com') ||
                             host==='xiaohongshu.com' || host.endsWith('.xiaohongshu.com') ||
                             host==='xhsimg.com' || host.endsWith('.xhsimg.com'))
                        );
                        if(isAllowed)return url.href;
                    }catch { /* Only an actual returned public platform media URL is usable. */ }
                }
            }
        }
    }
    return null;
}
function peek(url) {const row=cache.get(identity(url));return row && Date.now()-row.fetchedAt<300000?row:null;}
async function get(url) {
    require('./safe-network').platformUrl(url);
    const host=new URL(url).hostname,id=identity(url);
    if(!id || host!=='xiaohongshu.com' && !host.endsWith('.xiaohongshu.com'))throw new Error('需要小红书原站笔记链接');
    if(peek(url))return peek(url);
    if(pending.has(id))return pending.get(id);
    const failed=failures.get(id);
    if(failed && Date.now()-failed.at<30000)throw new Error(failed.message);
    const operation=axios.get(url,{proxy:false,timeout:4500,maxContentLength:5*1024*1024,maxRedirects:3,
        beforeRedirect(options){const target=require('./safe-network').platformUrl(options.protocol+'//'+options.hostname+options.path);if(!target.hostname.endsWith('.xiaohongshu.com') && target.hostname!=='xiaohongshu.com')throw new Error('笔记跳转至其它平台');},
        headers:{'User-Agent':require('./live-sources').UA,Accept:'text/html'}}).then(response=>{
        const note=parseState(response.data,url),row={note,fetchedAt:Date.now(),source:'xiaohongshu:public-note-html'};cache.set(id,row);if(cache.size>500)cache.delete(cache.keys().next().value);return row;
    }).catch(error=>{failures.set(id,{at:Date.now(),message:error.message});if(failures.size>500)failures.delete(failures.keys().next().value);throw error;}).finally(()=>pending.delete(id));
    pending.set(id,operation);return operation;
}
function remember(url,note) {
    const target=require('./safe-network').platformUrl(url);
    if(target.hostname!=='xiaohongshu.com' && !target.hostname.endsWith('.xiaohongshu.com'))throw new Error('需要小红书原站笔记链接');
    const verified=redNote({note:{noteDetailMap:{[identity(url)]:{note}}}},url);
    const row={note:verified,fetchedAt:Date.now(),source:'xiaohongshu:anonymous-note-page'};
    cache.set(identity(url),row);if(cache.size>500)cache.delete(cache.keys().next().value);
    return row;
}
async function enrichPublic(list) {
    if(browserJob)return browserJob.promise;
    const targets=list.filter(video=>{
        try {
            const url=require('./safe-network').platformUrl(video.url),id=identity(video.url);
            return id && (url.hostname==='xiaohongshu.com' || url.hostname.endsWith('.xiaohongshu.com')) && !peek(video.url) && Date.now()-(browserAttempts.get(id) || 0)>60000;
        }catch{return false;}
    }).slice(0,6);
    if(!targets.length)return;
    const job={ids:new Set(targets.map(v=>identity(v.url)))};
    browserJob=job;
    job.promise=require('./live-sources').withPage('xiaohongshu',async page=>{
        await require('./public-browser').lightweightPage(page,{navigationDomain:'xiaohongshu.com'});
        const deadline=Date.now()+8000;
        for(const video of targets) {
            if(Date.now()>deadline-500)break;
            browserAttempts.set(identity(video.url),Date.now());
            while(browserAttempts.size>500)browserAttempts.delete(browserAttempts.keys().next().value);
            try {
                // Ordinary guest share-page navigation; no private API signing or challenge handling.
                const response=await page.goto(video.url,{waitUntil:'domcontentloaded',timeout:Math.min(3500,deadline-Date.now())});
                if(response?.ok())remember(video.url,parseState(await response.text(),video.url));
            }catch { /* Keep unknown fields unknown; do not substitute recommendations. */ }
        }
    },{anonymous:true}).catch(()=>{}).finally(()=>{if(browserJob===job)browserJob=null;});
    return job.promise;
}
function prefetch(list) {enrichPublic(list).catch(()=>{});}
async function getWithBrowser(url) {
    try {return await get(url);}catch(error){
        await enrichPublic([{url}]);
        if(!peek(url))await enrichPublic([{url}]);
        const row=peek(url);if(row)return row;throw error;
    }
}
function pendingCount(list) {return list.filter(video=>pending.has(identity(video.url)) || browserJob?.ids.has(identity(video.url))).length;}
module.exports={parseState,parseInitialState,get,peek,prefetch,pendingCount,enrichPublic,getWithBrowser,remember,videoUrl};
