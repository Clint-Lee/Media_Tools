'use strict';
const {metricFields,readMetric}=require('./metric-evidence');
const {identity}=require('./media-identity');

function exactCount(raw) {
    const metric=readMetric(raw);
    return metric.precision==='integer'?metric.value:null;
}
function observation(raw,status,source,field,at,extra={}) {
    return {...metricFields('views',raw),viewSource:source,viewsFetchedAt:at,
        viewEvidence:{status,source,field,observedAt:at,...extra}};
}
function douyinViews(aweme,at=Date.now()) {
    const source='douyin:aweme-statistics',field='statistics.play_count',stats=aweme?.statistics;
    if(typeof aweme?.aweme_id!=='string' || !/^\d{15,22}$/.test(aweme.aweme_id) || stats?.aweme_id!=null && String(stats.aweme_id)!==aweme.aweme_id) {
        return observation(null,'identity-mismatch',source,field,at);
    }
    const count=exactCount(stats?.play_count);
    // In these anonymous Web responses zero is a hidden counter placeholder, not a measurement.
    return count>0?observation(count,'verified',source,field,at)
        :observation(null,count===0?'placeholder-zero':stats?.play_count==null?'not-provided':'invalid',source,field,at);
}
function structuredVideos(html) {
    const videos=[];
    function visit(value) {
        if(!value || typeof value!=='object')return;
        if([value['@type']].flat().some(type=>type==='VideoObject' || type==='https://schema.org/VideoObject'))videos.push(value);
        for(const [key,item] of Object.entries(value))if(['@graph','video','mainEntity','itemListElement','item'].includes(key) || Array.isArray(value))visit(item);
    }
    for(const match of String(html).matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
        try{visit(JSON.parse(match[1]));}catch{/* Never evaluate a site's scripts. */}
    }
    return videos;
}
const normalizeName=value=>String(value || '').replace(/\[话题\]/g,'').replace(/\s*-\s*小红书\s*$/,'').replace(/#+/g,'#').replace(/#\s*$/,'').replace(/\s+/g,' ').trim();
function redViews(html,url,note,at=Date.now()) {
    const source='xiaohongshu:public-note-jsonld',field='VideoObject.interactionStatistic.WatchAction.userInteractionCount';
    let id;
    try {
        const parsed=new URL(url);
        if(parsed.hostname!=='xiaohongshu.com' && !parsed.hostname.endsWith('.xiaohongshu.com'))throw new Error('Wrong platform');
        id=identity(url);
    }catch{}
    // 两种失败必须区分开，不能都叫 identity-mismatch：
    //  - 真正的身份不符：拿不到 id，或返回的笔记不是我们要的那件
    //  - 图文笔记：身份是对的，只是它不是视频，本来就没有"播放量"这个概念
    // 老写法 A!==id || B!=='video' && !C 会因 && 优先级把图文笔记误判成身份不符。
    if(!id || (note?.noteId || note?.note_id) && (note?.noteId || note?.note_id)!==id) {
        return observation(null,'identity-mismatch',source,field,at);
    }
    if(!note || note.type!=='video' && !note.video) {
        return observation(null,'note-not-video',source,field,at,{noteType:note?.type || null});
    }
    const expected=normalizeName(note.title || note.desc),stats=note.interactInfo || note.interact_info || {};
    const interactions=[stats.likedCount ?? stats.liked_count,stats.collectedCount ?? stats.collected_count,stats.commentCount ?? stats.comment_count].map(exactCount);
    const aggregate=interactions.every(value=>value!==null)?interactions.reduce((sum,value)=>sum+value,0):null;
    let found=false,reported=null;
    for(const video of structuredVideos(html)) {
        const ids=[video.url,video['@id'],video.embedUrl].filter(value=>typeof value==='string').map(value=>{try{return identity(new URL(value,url).href);}catch{return null;}}).filter(Boolean);
        // A schema without an ID must match the identity-verified note's title/description.
        if(ids.length?ids.some(value=>value!==id):!expected || normalizeName(video.name)!==expected)continue;
        for(const counter of [video.interactionStatistic].flat().filter(Boolean)) {
            const action=typeof counter.interactionType==='object'?counter.interactionType?.['@type']:counter.interactionType;
            if(!['WatchAction','https://schema.org/WatchAction','http://schema.org/WatchAction'].includes(action))continue;
            found=true;const count=exactCount(counter.userInteractionCount);if(count===null)continue;
            reported=count;
            if(aggregate!==null && count===aggregate)return observation(null,'aggregate-interactions',source,field,at,{reportedValue:count});
        }
    }
    // Real observed Xiaohongshu pages label likes+collects+comments as WatchAction. That label
    // alone cannot establish a video play counter, even when another schema count is non-null.
    return observation(null,reported!==null?'unverified-schema':'not-provided',source,found?field:'public-note',at,
        reported===null?{}:{reportedValue:reported});
}
module.exports={exactCount,douyinViews,redViews,structuredVideos};
