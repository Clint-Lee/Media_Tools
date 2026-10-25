'use strict';
const axios=require('axios'),{HttpsProxyAgent}=require('https-proxy-agent');
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {metricFields}=require('./metric-evidence'),{walk}=require('./platform-rankings');
const TTL=300000,COOLDOWN=60000,MAX_ENTRIES=500;

// 代理是否显式配置。只作为"配置事实"透出，不代表故障。
const proxyConfigured=Boolean(process.env.MEDIA_PROXY && process.env.MEDIA_PROXY.trim());
let warnedProxyMissing=false, warnedFetchFailure=false;
function warnIfProxyMissing() {
    if(proxyConfigured || warnedProxyMissing)return;
    warnedProxyMissing=true;
    console.warn('[youtube] 未配置 MEDIA_PROXY，YouTube 指标将直连；'
        +'若当前网络无法访问 YouTube，请在 .env 配置 HTTP 代理（其它平台不受影响）。');
}

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
    const oldEntityLikes=entity?.likeCountIfIndifferentNumber ?? entity?.expandedLikeCountIfIndifferent?.content;
    // 2026-10 改版：点赞移到 segmentedLikeDislikeButtonViewModel。
    // accessibilityText 含精确数（"along with 19,494,293 other people"），按钮 title 只有 "19M" 缩写。
    const likeButton=walk(data,node=>Boolean(node.segmentedLikeDislikeButtonViewModel))[0]?.segmentedLikeDislikeButtonViewModel;
    const likeTexts=likeButton?(JSON.stringify(likeButton).match(/like this video along with ([\d,]+) other people/i) || [])[1]:null;
    const likeTitle=walk(likeButton||{},node=>node.buttonViewModel?.iconName==='LIKE'?node.buttonViewModel.title:null)
        .find(Boolean) ?? null;
    const likes=oldEntityLikes ?? (likeTexts?likeTexts.replace(/,/g,''):likeTitle);
    const date=player.microformat?.playerMicroformatRenderer?.publishDate;
    const timestamp=date && /T\d{2}:\d{2}:/.test(date)?Date.parse(date):NaN;
    return {id,platform:'youtube',title:details.title || '',description:details.shortDescription || '',author:details.author || '',
        cover:details.thumbnail?.thumbnails?.at(-1)?.url || '',url:'https://www.youtube.com/watch?v='+id,
        duration:details.lengthSeconds?Math.floor(Number(details.lengthSeconds)/60)+':'+String(Number(details.lengthSeconds)%60).padStart(2,'0'):'',
        ...(Number.isFinite(timestamp)?{pubdate:Math.floor(timestamp/1000),datePrecision:'exact'}:{}),
        ...metricFields('views',details.viewCount),...metricFields('likes',likes),
        viewSource:'youtube:public-watch',likeSource:'youtube:public-watch',viewsFetchedAt:now,likesFetchedAt:now,source:'youtube:public-watch',fetchedAt:now};
}
function createClient({http=axios,now=Date.now,io=fs,
    directory=process.env.HOTPOT_YOUTUBE_METRICS_DIR || path.join(__dirname,'..','.cache','youtube-public-metrics')}={}) {
    const cache=new Map(),attempts=new Map(),pending=new Map(),queue=[];
    let workers=0,loaded=false,storage=directory?'not-loaded':'disabled';
    const file=directory && path.join(directory,'metrics.json');
    const validTime=value=>Number.isFinite(value) && value>0 && value<=now();
    // Only counters and their observation evidence survive restart. No HTML, URLs or sessions.
    function persisted(row) {
        const result={id:row.id,fetchedAt:row.fetchedAt,source:'youtube:public-watch'};
        for(const [kind,key,prefix,time] of [['views','playRaw','view','viewsFetchedAt'],['likes','likeRaw','like','likesFetchedAt']]) {
            const fields=metricFields(kind,row[prefix+'CountText'] || row[key]);
            if(fields[key]!==row[key] || fields[prefix+'Precision']!==row[prefix+'Precision']
                || fields[prefix+'LowerBound']!==row[prefix+'LowerBound'] || !validTime(row[time]))throw new Error('Invalid metric evidence');
            Object.assign(result,fields,{[prefix+'Source']:'youtube:public-watch',[time]:row[time]});
        }
        return result;
    }
    function load() {
        if(loaded)return;loaded=true;
        if(!file)return;
        try {
            if(!io.existsSync(file)){storage='ready';return;}
            const data=JSON.parse(io.readFileSync(file,'utf8'));
            if(data.version!==1 || !Array.isArray(data.rows) || data.rows.length>MAX_ENTRIES)throw new Error('Invalid cache');
            const rows=data.rows.map(row=>{
                if(!/^[\w-]{11}$/.test(row?.id) || !validTime(row.fetchedAt))throw new Error('Invalid observation');
                return persisted(row);
            });
            for(const row of rows)if(now()-row.fetchedAt<TTL)cache.set(row.id,row);
            storage='ready';
        }catch {storage='read-failed';} // This disposable cache must never break a public feed.
    }
    function save() {
        if(!file)return;
        const temp=file+'.'+crypto.randomUUID()+'.tmp';
        try {
            io.mkdirSync(directory,{recursive:true});
            const rows=[...cache.values()].filter(row=>now()-row.fetchedAt<TTL).map(persisted);
            io.writeFileSync(temp,JSON.stringify({version:1,rows}),{mode:0o600,flag:'wx'});
            io.renameSync(temp,file);storage='ready';
        }catch {storage='write-failed';}
        finally {try{io.unlinkSync(temp);}catch{}}
    }
    function peek(id) {
        load();const row=cache.get(id);
        if(!row || now()-row.fetchedAt>=TTL || !validTime(row.fetchedAt))return null;
        cache.delete(id);cache.set(id,row);return row;
    }
    function trim(map) {while(map.size>MAX_ENTRIES)map.delete(map.keys().next().value);}
    // 抓取状态与代理配置事实。用于区分"网络没通"和"平台未公开播放量"，
    // 避免用户看到"未公开播放量"就误以为平台不给，其实是自己没配代理。
    // 注意：这两个值只描述事实，不能用来判断某条视频是否隐藏了播放量。
    let lastFetchState='not-attempted';
    function recordFetchFailure(error) {
        lastFetchState='fetch-failed';
        if(!warnedFetchFailure) {
            warnedFetchFailure=true;
            // 不输出代理地址，避免泄露凭证
            console.warn('[youtube] 指标抓取失败，这不等于该作品未公开播放量；'
                +(proxyConfigured?'请检查代理连通性与 YouTube 响应。':'当前未配置 MEDIA_PROXY，请检查直连网络或配置 HTTP 代理。'));
        }
        void error;
    }
    function pump() {
        while(workers<3 && queue.length) {
            const id=queue.shift(),job=pending.get(id);workers++;attempts.set(id,now());trim(attempts);
            (async()=>{
                try {
                    const response=await http.get('https://www.youtube.com/watch',{params:{v:id,hl:'en'},proxy:false,timeout:4500,maxRedirects:0,maxContentLength:8*1024*1024,
                        headers:{'User-Agent':require('./live-sources').UA,'Accept-Language':'en-US,en;q=0.9'},
                        ...(process.env.MEDIA_PROXY?{httpsAgent:new HttpsProxyAgent(process.env.MEDIA_PROXY)}:{})});
                    // 网络请求成功即记录 ok（解析失败另算，不该被当成网络故障）
                    lastFetchState='ok';
                    cache.delete(id);cache.set(id,parseWatch(String(response.data),id,now()));trim(cache);
                }catch (error) { recordFetchFailure(error); /* 抓不到就保持未知，绝不用推荐视频顶替 */ }
            })().finally(()=>{
                pending.delete(id);workers--;job.resolve();
                if(!workers && !queue.length)save();
                pump();
            });
        }
    }
    async function enrich(list) {
        load();warnIfProxyMissing();const waiting=[];let added=0;
        for(const video of list) {
            const id=video.id;if(!/^[\w-]{11}$/.test(id) || peek(id))continue;
            if(pending.has(id)){waiting.push(pending.get(id).promise);continue;}
            if(added>=30 || pending.size>=MAX_ENTRIES || attempts.has(id) && now()-attempts.get(id)<COOLDOWN)continue;
            let resolve;const promise=new Promise(done=>{resolve=done;});
            pending.set(id,{promise,resolve});queue.push(id);waiting.push(promise);added++;
        }
        pump();
        if(!waiting.length)return;
        // The request waits at most eight seconds; queued work continues without a UI refresh.
        let timer;
        try {await Promise.race([Promise.all(waiting),new Promise(resolve=>{timer=setTimeout(resolve,8000);})]);}
        finally {clearTimeout(timer);}
    }
    function apply(list) {
        return list.map(video=>{
            const detail=peek(video.id);if(!detail)return video;
            let result=video;
            // Compare each counter's own timestamp, not the search/metadata fetch timestamp.
            for(const [key,prefix,time] of [['playRaw','view','viewsFetchedAt'],['likeRaw','like','likesFetchedAt']]) {
                const previous=Number.isFinite(video[time])?video[time]:video.fetchedAt || 0;
                const observed=video[key]!=null || video[prefix+'Precision']==='lower-bound' && Number.isSafeInteger(video[prefix+'LowerBound']) || Number.isFinite(video[time]);
                if(observed && previous>detail[time])continue;
                result={...result,...Object.fromEntries([key,prefix+'Precision',prefix+'CountText',prefix+'LowerBound',prefix+'Source',time].map(field=>[field,detail[field]]))};
            }
            if(detail.title && detail.fetchedAt>=(video.fetchedAt || 0)) {
                result={...result,title:detail.title,author:detail.author || video.author,cover:detail.cover || video.cover};
            }
            if(detail.pubdate && !video.pubdate)result={...result,pubdate:detail.pubdate,datePrecision:detail.datePrecision};
            // Supplemental evidence must not turn a cached listing into a fresh observation.
            return result;
        });
    }
    function pendingCount(list) {return list.filter(video=>pending.has(video.id)).length;}
    function status() {load();return {storage,pending:pending.size,cached:[...cache.values()].filter(row=>validTime(row.fetchedAt) && now()-row.fetchedAt<TTL).length,ttlMs:TTL,
        proxyConfigured,lastFetchState};}
    return {enrich,apply,pendingCount,status};
}
module.exports={initialObject,parseWatch,createClient,...createClient()};
