'use strict';
const axios=require('axios'),{HttpsProxyAgent}=require('https-proxy-agent');
const {metricFields}=require('./metric-evidence'),{walk}=require('./platform-rankings');
const cache=new Map(),attempts=new Map();let active;

function initialObject(html,name) {
    const match=String(html).match(new RegExp('(?:var\\s+)?'+name+'\\s*=\\s*(?=\\{)'));
    if(!match)return null;
    const start=match.index+match[0].length;
    let depth=0,quoted=false,escaped=false;
    for(let i=start;i<html.length;i++) {
        const c=html[i];
        if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}
        else if(c==='"')quoted=true;
        else if(c==='{')depth++;
        else if(c==='}' && --depth===0)return JSON.parse(html.slice(start,i+1));
    }
    return null;
}
function parseWatch(html,id,now=Date.now()) {
    const player=initialObject(html,'ytInitialPlayerResponse'),data=initialObject(html,'ytInitialData');
    const details=player?.videoDetails,endpoint=data?.currentVideoEndpoint?.watchEndpoint?.videoId;
    if(!/^[\w-]{11}$/.test(id) || details?.videoId!==id || endpoint && endpoint!==id)throw new Error('YouTube详情编号不一致，不采用推荐视频指标');
    const primary=walk(data,node=>Boolean(node.videoPrimaryInfoRenderer))[0]?.videoPrimaryInfoRenderer;
    const entity=walk(primary,node=>Boolean(node.likeCountEntity))[0]?.likeCountEntity;
    // "IfLiked" and the action's accessibility text include a hypothetical extra like.
    const likes=entity?.likeCountIfIndifferentNumber ?? entity?.expandedLikeCountIfIndifferent?.content;
    const date=player.microformat?.playerMicroformatRenderer?.publishDate;
    const timestamp=date && /T\d{2}:\d{2}:/.test(date)?Date.parse(date):NaN;
    return {id,platform:'youtube',title:details.title || '',description:details.shortDescription || '',author:details.author || '',
        cover:details.thumbnail?.thumbnails?.at(-1)?.url || '',url:'https://www.youtube.com/watch?v='+id,
        duration:details.lengthSeconds?Math.floor(Number(details.lengthSeconds)/60)+':'+String(Number(details.lengthSeconds)%60).padStart(2,'0'):'',
        ...(Number.isFinite(timestamp)?{pubdate:Math.floor(timestamp/1000),datePrecision:'exact'}:{}),
        ...metricFields('views',details.viewCount),...metricFields('likes',likes),
        viewSource:'youtube:public-watch',likeSource:'youtube:public-watch',viewsFetchedAt:now,likesFetchedAt:now,source:'youtube:public-watch',fetchedAt:now};
}
function peek(id) {const row=cache.get(id);return row && Date.now()-row.fetchedAt<300000?row:null;}
async function enrich(list) {
    if(active)return active.promise;
    const targets=list.filter(v=>/^[\w-]{11}$/.test(v.id) && !peek(v.id) && Date.now()-(attempts.get(v.id) || 0)>60000).slice(0,30);
    if(!targets.length)return;
    const job={ids:new Set(targets.map(v=>v.id))};active=job;
    job.promise=(async()=>{
        const deadline=Date.now()+8000;let next=0;
        await Promise.all(Array.from({length:3},async()=>{
            while(next<targets.length && Date.now()<deadline-500) {
                const video=targets[next++];attempts.set(video.id,Date.now());
                try {
                    const response=await axios.get('https://www.youtube.com/watch',{params:{v:video.id,hl:'en'},proxy:false,timeout:Math.min(4500,deadline-Date.now()),maxRedirects:0,maxContentLength:8*1024*1024,
                        headers:{'User-Agent':require('./live-sources').UA,'Accept-Language':'en-US,en;q=0.9'},
                        ...(process.env.MEDIA_PROXY?{httpsAgent:new HttpsProxyAgent(process.env.MEDIA_PROXY)}:{})});
                    cache.set(video.id,parseWatch(String(response.data),video.id));
                }catch { /* Inaccessible or hidden metrics remain unknown; never use recommendations. */ }
            }
        }));
        for(const map of [cache,attempts])while(map.size>500)map.delete(map.keys().next().value);
    })().finally(()=>{if(active===job)active=null;});
    return job.promise;
}
function apply(list) {
    return list.map(video=>{
        const detail=peek(video.id);if(!detail)return video;
        if(detail.fetchedAt>=video.fetchedAt)return {...video,...detail,isCached:false,
            title:detail.title || video.title,cover:detail.cover || video.cover,author:detail.author || video.author};
        // A newer search observation can have fresher views but contains no like counter.
        return {...video,...Object.fromEntries(['likeRaw','likePrecision','likeCountText','likeLowerBound','likeSource','likesFetchedAt'].map(key=>[key,detail[key]])),
            ...(detail.pubdate?{pubdate:detail.pubdate,datePrecision:detail.datePrecision}:{})};
    });
}
function pendingCount(list) {return list.filter(video=>active?.ids.has(video.id)).length;}
module.exports={initialObject,parseWatch,enrich,apply,pendingCount};
