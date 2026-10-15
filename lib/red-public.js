'use strict';
const axios=require('axios');
const {identity,redNote}=require('./media-identity');
const cache=new Map(),pending=new Map();
function parseState(html,url) {
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
    return redNote(JSON.parse(result),url);
}
function peek(url) {const row=cache.get(identity(url));return row && Date.now()-row.fetchedAt<300000?row:null;}
async function get(url) {
    require('./safe-network').platformUrl(url);
    const host=new URL(url).hostname,id=identity(url);
    if(!id || host!=='xiaohongshu.com' && !host.endsWith('.xiaohongshu.com'))throw new Error('需要小红书原站笔记链接');
    if(peek(url))return peek(url);
    if(pending.has(id))return pending.get(id);
    const operation=axios.get(url,{proxy:false,timeout:4500,maxContentLength:5*1024*1024,maxRedirects:3,
        beforeRedirect(options){const target=require('./safe-network').platformUrl(options.protocol+'//'+options.hostname+options.path);if(!target.hostname.endsWith('.xiaohongshu.com') && target.hostname!=='xiaohongshu.com')throw new Error('笔记跳转至其它平台');},
        headers:{'User-Agent':require('./live-sources').UA,Accept:'text/html'}}).then(response=>{
        const note=parseState(response.data,url),row={note,fetchedAt:Date.now()};cache.set(id,row);if(cache.size>500)cache.delete(cache.keys().next().value);return row;
    }).finally(()=>pending.delete(id));
    pending.set(id,operation);return operation;
}
function prefetch(list) {require('./live-sources').boundedMap(list.slice(0,30),4,video=>get(video.url)).catch(()=>{});}
module.exports={parseState,get,peek,prefetch};
