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
        const note=parseState(response.data,url),fetchedAt=Date.now(),row={note,fetchedAt,source:'xiaohongshu:public-note-html',
            views:require('./public-view-evidence').redViews(response.data,url,note,fetchedAt)};cache.set(id,row);if(cache.size>500)cache.delete(cache.keys().next().value);return row;
    }).catch(error=>{failures.set(id,{at:Date.now(),message:error.message});if(failures.size>500)failures.delete(failures.keys().next().value);throw error;}).finally(()=>pending.delete(id));
    pending.set(id,operation);return operation;
}
function remember(url,note,html='') {
    const target=require('./safe-network').platformUrl(url);
    if(target.hostname!=='xiaohongshu.com' && !target.hostname.endsWith('.xiaohongshu.com'))throw new Error('需要小红书原站笔记链接');
    const verified=redNote({note:{noteDetailMap:{[identity(url)]:{note}}}},url);
    const fetchedAt=Date.now(),row={note:verified,fetchedAt,source:'xiaohongshu:anonymous-note-page',
        views:require('./public-view-evidence').redViews(html,url,verified,fetchedAt)};
    // 浏览器兜底成功说明这条能取到，清掉 axios 路径留下的退避记录，
    // 否则 30 秒内 get() 仍会被旧失败拒绝（缓存虽能绕过，但语义上不该继续退避）。
    failures.delete(identity(url));
    cache.set(identity(url),row);if(cache.size>500)cache.delete(cache.keys().next().value);
    return row;
}
// 并发池：有界并发 + 预算截止（不引入新依赖）
// 只截"派发"，已发出的任务等其自然结束（get 自带 timeout:4500 兜底）
async function runPool(tasks, { concurrency, deadline }) {
    const results = new Array(tasks.length);
    let next = 0;
    async function worker() {
        for (;;) {
            const i = next++;
            if (i >= tasks.length) return;
            if (Date.now() > deadline) { results[i] = { status: 'skipped' }; continue; }
            try { results[i] = { status: 'fulfilled', value: await tasks[i]() }; }
            catch (error) { results[i] = { status: 'rejected', reason: error }; }
        }
    }
    const n = Math.min(concurrency, tasks.length);
    if (n > 0) await Promise.all(Array.from({ length: n }, worker));
    return results;
}

// axios 快路径单批上限。实测 20 条 376ms 全部成功，远在预算内；
// 再往上收益递减而上游风控压力递增，20 是拐点。
const MAX_ENRICH = 20;
const ENRICH_CONCURRENCY = 6;   // 实测 6/12/20 并发均零失败，取保守值留容错余量
const AXIOS_BUDGET_MS = 6000;
const BROWSER_BUDGET_MS = 4000;

let lastEnrichStats = null;
function enrichStats() { return lastEnrichStats; }

async function enrichPublic(list) {
    const safe = require('./safe-network');
    const eligible = video => {
        try {
            const url = safe.platformUrl(video.url), id = identity(video.url);
            return id && (url.hostname === 'xiaohongshu.com' || url.hostname.endsWith('.xiaohongshu.com')) && !peek(video.url);
        } catch { return false; }
    };

    // 注意：axios 阶段不做全局单飞。
    // 旧实现用 browserJob 锁住整批，导致并发传入不同 list 时第二个 list 一条都抓不到
    // （实测 0/5）。axios 有 pending 去重 + failures 退避，天然安全，无需再加锁。
    const axiosTargets = list.filter(eligible).slice(0, MAX_ENRICH);
    if (!axiosTargets.length) return;

    const started = Date.now();
    const stats = { axiosTried: axiosTargets.length, axiosOk: 0, axiosFailed: 0, browserTried: 0, browserOk: 0, elapsedMs: 0, timedOut: false };
    lastEnrichStats = stats;

    // ── 第一阶段：并发 axios（快路径）──
    const settled = await runPool(
        axiosTargets.map(video => () => get(video.url)),
        { concurrency: ENRICH_CONCURRENCY, deadline: started + AXIOS_BUDGET_MS }
    );
    if (Date.now() > started + AXIOS_BUDGET_MS) stats.timedOut = true;

    const failed = [];
    settled.forEach((r, i) => {
        if (r.status === 'fulfilled') stats.axiosOk++;
        else { stats.axiosFailed++; failed.push(axiosTargets[i]); }
    });

    // axios 全成功就不启动浏览器，省掉几秒冷启动
    if (!failed.length) { stats.elapsedMs = Date.now() - started; return; }

    // ── 第二阶段：浏览器兜底（仅失败项，且套 60 秒退避）──
    // 浏览器是稀缺资源，这里才需要单飞。
    if (browserJob) return browserJob.promise;
    const browserTargets = failed.filter(video => {
        const id = identity(video.url);
        return Date.now() - (browserAttempts.get(id) || 0) > 60000;
    });
    if (!browserTargets.length) { stats.elapsedMs = Date.now() - started; return; }

    const job = { ids: new Set(browserTargets.map(v => identity(v.url))) };
    browserJob = job;
    stats.browserTried = browserTargets.length;

    job.promise = require('./live-sources').withPage('xiaohongshu', async page => {
        await require('./public-browser').lightweightPage(page, { navigationDomain: 'xiaohongshu.com' });
        const deadline = Date.now() + BROWSER_BUDGET_MS;
        for (const video of browserTargets) {
            if (Date.now() > deadline - 500) break;
            const id = identity(video.url);
            browserAttempts.set(id, Date.now());
            while (browserAttempts.size > 500) browserAttempts.delete(browserAttempts.keys().next().value);
            try {
                // Ordinary guest share-page navigation; no private API signing or challenge handling.
                const response = await page.goto(video.url, { waitUntil: 'domcontentloaded', timeout: Math.min(3500, deadline - Date.now()) });
                if (response?.ok()) { const html = await response.text(); remember(video.url, parseState(html, video.url), html); stats.browserOk++; }
            } catch { /* Keep unknown fields unknown; do not substitute recommendations. */ }
        }
    }, { anonymous: true }).catch(() => { }).finally(() => { stats.elapsedMs = Date.now() - started; if (browserJob === job) browserJob = null; });
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
module.exports={parseState,parseInitialState,get,peek,prefetch,pendingCount,enrichPublic,enrichStats,getWithBrowser,remember,videoUrl};
