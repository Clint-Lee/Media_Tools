'use strict';
// Read normal public pages only. Reports contain no cookies, signatures, media URLs or raw HTML.
require('../lib/env');
const fs=require('fs'),path=require('path');
const sources=require('../lib/live-sources'),red=require('../lib/red-public');
const platform=process.argv[2];
if(!['douyin','xiaohongshu'].includes(platform))throw new Error('Usage: node scripts/probe-public-video-views.js douyin|xiaohongshu');
const sampleCount=Math.min(5,Math.max(1,Number(process.argv[3]) || 3));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const counter=/^(?:play_?count|video_?play_?count|view_?count|video_?view_?count|read_?count|exposure_?count|impression_?count|watch_?count|digg_?count|liked_?count|like_?count)$/i;
function counters(value,prefix='',out=[],seen=new Set()) {
    if(!value || typeof value!=='object' || seen.has(value) || out.length>=100)return out;
    seen.add(value);
    for(const [key,item] of Object.entries(value)) {
        const field=prefix?prefix+'.'+key:key;
        if(counter.test(key) && (item===null || typeof item==='number' || typeof item==='string' && /^[\d,.万亿KMB千+ ]+$/i.test(item)))out.push({field,value:item});
        if(item && typeof item==='object')counters(item,field,out,seen);
    }
    return out;
}
function summaries(data,id) {
    if(platform==='douyin')return sources.collectAwemes(data).filter(v=>!id || String(v.aweme_id)===id)
        .map(v=>({id:String(v.aweme_id),fields:counters({statistics:v.statistics,video:v.video}),evidence:require('../lib/public-view-evidence').douyinViews(v)}));
    const matches=[];
    function visit(value) {
        if(!value || typeof value!=='object')return;
        const note=value.note_card || value.noteCard || value;
        const key=String(value.id || value.note_id || value.noteId || note.note_id || note.noteId || '');
        if(/^[a-f\d]{24}$/i.test(key) && (!id || key===id) && (note.type==='video' || note.video)) {
            matches.push({id:key,fields:counters(note)});return;
        }
        Object.values(value).forEach(visit);
    }
    visit(data);return matches;
}
async function inspect(url,{id,discovery=false}={}) {
    return sources.withPage(platform,async page=>{
        const records=[],captures=[];let targets=[],html='',matchedNote;
        page.on('response',response=>{
            const parsed=new URL(response.url());
            if(platform==='douyin'?!parsed.hostname.endsWith('.douyin.com') || !parsed.pathname.includes('/aweme/')
                :!parsed.hostname.endsWith('.xiaohongshu.com') || !/\/api\/sns\//.test(parsed.pathname))return;
            captures.push(response.json().then(data=>{
                const rows=summaries(data,id);
                if(rows.length)records.push({path:parsed.pathname,status:response.status(),rows});
            }).catch(()=>{}));
        });
        await require('../lib/public-browser').lightweightPage(page,{navigationDomain:platform==='douyin'?'douyin.com':'xiaohongshu.com'});
        const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:16000});
        if(response?.ok())html=await response.text();
        if(platform==='xiaohongshu') {
            try {
                const state=red.parseInitialState(html),rows=summaries(state,id);
                if(id)try{matchedNote=require('../lib/media-identity').redNote(state,url);}catch{}
                if(rows.length)records.push({path:new URL(response.url()).pathname,status:response.status(),kind:'SSR',rows});
                if(discovery)targets=require('../lib/public-discovery').redFeedFromHtml(html).slice(0,sampleCount);
            }catch{}
            if(discovery)try {await page.waitForSelector('.close-button',{visible:true,timeout:1500});await page.click('.close-button');}catch{}
        }
        await pause(1500);
        if(id)for(let attempt=0;attempt<9 && !records.some(row=>row.rows.some(video=>video.id===id));attempt++)await pause(500);
        if(discovery){await require('../lib/public-browser').scrollMore(page);await pause(700);}
        const embedded=await page.evaluate(()=>{
            const state=[];
            if(window._ROUTER_DATA)state.push(window._ROUTER_DATA);
            for(const selector of ['#RENDER_DATA','#__NEXT_DATA__'])try{state.push(JSON.parse(decodeURIComponent(document.querySelector(selector)?.textContent || '')));}catch{}
            return {state,structured:[...document.querySelectorAll('script[type="application/ld+json"]')].map(el=>{try{return JSON.parse(el.textContent);}catch{return null;}}),
                text:document.body?.innerText?.slice(0,350),path:location.pathname,
                challenge:Boolean(document.querySelector('.captcha_verify_container,#captcha_container,[id*="captcha-verify"]'))};
        });
        const rows=summaries(embedded.state,id);if(rows.length)records.push({path:embedded.path,kind:'embedded',rows});
        await Promise.race([Promise.allSettled(captures),pause(2000)]);
        if(discovery && !targets.length && records[0]?.rows[0]) {
            targets=records[0].rows.slice(0,sampleCount).map(row=>({id:row.id,url:'https://www.douyin.com/video/'+row.id}));
        }
        const structured=[];
        function schema(value) {
            if(!value || typeof value!=='object')return;
            if(value['@type']==='VideoObject')structured.push({type:value['@type'],keys:Object.keys(value),
                nameMatchesNote:Boolean(matchedNote && value.name && value.name===matchedNote.title),
                descriptionMatchesNote:Boolean(matchedNote && value.description && value.description===matchedNote.desc),
                interactionStatistic:[value.interactionStatistic].flat().filter(Boolean).map(row=>({type:row['@type'],action:row.interactionType,count:row.userInteractionCount ?? null})),
                // Only original platform identity paths, never contentUrl/signed media addresses.
                identity:[value.url,value['@id'],value.embedUrl].filter(v=>typeof v==='string').map(v=>{try{return new URL(v,url).pathname;}catch{return '';}})});
            Object.values(value).forEach(schema);
        }
        embedded.structured.forEach(schema);
        return {targets,report:{id,path:embedded.path,status:response?.status(),records,structured,
            ...(matchedNote?{views:require('../lib/public-view-evidence').redViews(html,url,matchedNote)}:{}),
            challenge:embedded.challenge,text:embedded.text}};
    },{anonymous:true});
}
(async()=>{
    const first=process.argv[4]?{targets:[],report:{kind:'known-original-id',records:[]}}
        :await inspect(platform==='douyin'?'https://www.douyin.com/jingxuan':'https://www.xiaohongshu.com/explore',{discovery:true});
    if(process.argv[4]) {
        const known=process.argv[4];
        if(!(platform==='douyin'?/^\d{15,22}$/:/^[a-f\d]{24}$/i).test(known))throw new Error('Invalid original video ID');
        first.targets=[{id:known,url:platform==='douyin'?'https://www.douyin.com/video/'+known:'https://www.xiaohongshu.com/explore/'+known}];
    }
    const privateDirectory=path.join(__dirname,'..','.cache','public-probes');fs.mkdirSync(privateDirectory,{recursive:true});
    fs.writeFileSync(path.join(privateDirectory,platform+'-view-targets.json'),JSON.stringify(first.targets));
    const results=[first.report];
    for(const target of first.targets) {
        if(results.some(row=>row.challenge))break;
        for(const url of [target.url,platform==='douyin'?'https://www.douyin.com/?modal_id='+target.id:target.url.replace('/explore/','/discovery/item/')]) {
            if(results.some(row=>row.challenge))break;
            try{results.push((await inspect(url,{id:target.id})).report);}catch{results.push({id:target.id,path:new URL(url).pathname,failed:true});}
        }
    }
    const verifiedIds=new Set(results.flatMap(result=>result.views?.playRaw!=null?[result.id]:(result.records || []).flatMap(record=>record.rows.filter(row=>row.evidence?.playRaw!=null).map(row=>row.id))));
    const report={checkedAt:new Date().toISOString(),platform,anonymous:true,sampledIds:first.targets.map(v=>v.id),
        verifiedViews:verifiedIds.size,goalMet:first.targets.length>0 && first.targets.every(target=>verifiedIds.has(target.id)),results};
    const directory=path.join(__dirname,'..','.cache','verification');fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,platform+'-public-views-audit-'+report.checkedAt.replace(/[:.]/g,'-')+'.json'),JSON.stringify(report,null,2));
    fs.writeFileSync(path.join(directory,platform+'-public-views-audit.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(sources.closeBrowser);
