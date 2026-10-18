'use strict';

const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const sessions = require('./platform-session');
const collectionIndex = require('./collection-index');
const { videoDataQuality } = require('./data-quality');
const { prepareVideoList, TIME_RANGE_SECONDS, formatHeatChinese } = require('./video-pipeline');
const { attachVideoLocations } = require('./geo-hotspots');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const CATEGORY_QUERIES = {
    // 不把“热门”这个关键词误当成全站：跨主要内容领域发现历史作品。
    all: ['视频', 'bilibili', '鬼畜', '搞笑', '音乐', 'MV', '舞蹈', '动画', '游戏', '影视', '生活', '美食', '科技', '数码', '知识', '数学', '英语', '纪录片', '运动', '汽车', '动物', '时尚'],
    comedy: ['搞笑', '喜剧', '相声'], ent: ['娱乐', '综艺', '明星'],
    fashion: ['穿搭', '美妆', '时尚'], pets: ['萌宠', '猫咪', '宠物'],
    wildlife: ['野生动物', '动物世界', '自然纪录片'], tech: ['科技', '数码', '人工智能'],
    marketing: ['商业营销', '品牌营销', '自媒体运营'], kuso: ['鬼畜', '音MAD', '人力VOCALOID'],
    animal: ['萌宠', '动物', '野生动物']
};
let browserPromise;
const anonymousContexts = new Map();
let biliCookie = '';
let wbiCache;
const cache = new Map();
const pending = new Map();
const sourceStatus = new Map();
const snapshotRoot = process.env.HOTPOT_SOURCE_CACHE || path.join(__dirname,'..','.cache','source-snapshots-v3');
const MAX_SNAPSHOT_AGE = 30 * 60 * 1000;
async function observed(platform, kind, worker) {
    try {
        const result = await worker();
        sourceStatus.set(platform+':'+kind, { status:result.stale ? 'cached' : result.partial ? 'partial' : 'ok', checkedAt:Date.now(), collectedAt:result.list[0]?.fetchedAt || null, count:result.list.length, message:result.message,
            ...(kind === 'videos' ? { dataQuality: videoDataQuality(result.list, result) } : {}) });
        return result;
    } catch(error) { sourceStatus.set(platform+':'+kind, { status:'unavailable',checkedAt:Date.now(),count:0,message:error.message }); throw error; }
}
function getSourceStatus(platform) { return { videos:sourceStatus.get(platform+':videos') || {status:'not-verified'}, topics:sourceStatus.get(platform+':topics') || {status:'not-verified'} }; }

async function getBrowser() {
    if (!browserPromise) {
        browserPromise = puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
            .then(browser => {
                browser.on('disconnected', () => { browserPromise = null; anonymousContexts.clear(); });
                return browser;
            }).catch(error => { browserPromise = null; throw error; });
    }
    return browserPromise;
}

async function withPage(platform, worker, { anonymous=false } = {}) {
    const browser = await getBrowser();
    const contextOptions = { ...(['tiktok','twitter'].includes(platform) && process.env.MEDIA_PROXY ? { proxyServer: process.env.MEDIA_PROXY } : {}) };
    // Anonymous technical cookies stay in memory like a normal guest browser session.
    // Never share the optional personal-cookie context or reset a context to evade a challenge.
    const key = platform + ':' + (contextOptions.proxyServer || 'direct');
    // TikTok's parallel discover/tag/ads pages must keep their technical sessions separate.
    const sharedAnonymous = anonymous && platform !== 'tiktok';
    let context;
    if (sharedAnonymous) {
        if (!anonymousContexts.has(key)) {
            const opening = browser.createBrowserContext(contextOptions).catch(error => { anonymousContexts.delete(key); throw error; });
            anonymousContexts.set(key, opening);
        }
        context = await anonymousContexts.get(key);
    } else context = await browser.createBrowserContext(contextOptions);
    const page = await context.newPage();
    let timer;
    try {
        await page.setUserAgent(UA);
        await page.setViewport({ width: 1440, height: 900 });
        const cookies = anonymous ? [] : sessions.browserCookies(platform);
        if (cookies.length) await page.setCookie(...cookies);
        return await Promise.race([worker(page), new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('平台页面读取超过30秒，已停止本次抓取，可稍后重试。')), 30000);
        })]);
    } finally {
        clearTimeout(timer);
        if (sharedAnonymous) await page.close().catch(() => {});
        else await context.close().catch(() => {});
    }
}

async function boundedMap(items, concurrency, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            try { results[index] = { value: await worker(items[index]) }; }
            catch (error) { results[index] = { error }; }
        }
    }));
    return results;
}

async function memo(key, worker, refresh = false, forceFinal = false) {
    let old = cache.get(key);
    const filename=path.join(snapshotRoot,crypto.createHash('sha256').update(key).digest('hex')+'.json');
    if (!old) try {
        const saved=JSON.parse(fs.readFileSync(filename,'utf8'));
        if(saved.key===key && saved.value?.list && Date.now()-saved.createdAt<MAX_SNAPSHOT_AGE) { old=saved; cache.set(key,saved); }
    } catch { /* 无真实快照则联网获取，不使用内置素材。 */ }
    if(!old && !refresh && key.startsWith('videos:')) {
        const options=JSON.parse(key.slice(7));
        if(options.page===1 && (options.category!=='all' || options.timeRange!=='all' || options.query)) {
            const {matchesCategory,matchesQuery}=require('./video-categories');
            const candidates=[...cache.values()].filter(saved=>Date.now()-saved.createdAt<MAX_SNAPSHOT_AGE).flatMap(saved=>saved.value.list || [])
                .filter(video=>require('./video-pipeline').normalizePlatform(video.normPlatform || video.platform)===options.platform && Date.now()-video.fetchedAt<MAX_SNAPSHOT_AGE && matchesCategory(video,options.category) && matchesQuery(video,options.query));
            const list=prepareVideoList(candidates,{timeRange:options.timeRange,limit:2000});
            if(list.length) {
                old={createdAt:Math.max(...list.map(v=>v.fetchedAt)),expiresAt:0,value:{list,hasMore:false,source:options.platform+':collected-preview',
                    scope:{kind:'public-discover-sample',label:'已采集作品内筛选预览 · 后台补充核验',exhaustive:false,metric:'views',categoryMethod:'semantic-title-tags'},
                    coverage:{candidates:candidates.length,unique:list.length},message:'先显示已采集且符合当前分类、关键词和原始发布时间的真实作品，后台正在补充分区；预览不是完整分区结果。'}};
                cache.set(key,old);
            }
        }
    }
    if (!refresh && old?.expiresAt > Date.now()) return old.value;
    if(!refresh && old?.retryAfter>Date.now()) return {...old.value,stale:true,partial:true,refreshing:false,message:old.value.message+' 上游本次更新失败，短暂退避后重试；保留原采集时间。'};
    // 过期但仍在30分钟保留期内的真实快照先显示，后台更新；不让首屏等待整批采集。
    const stale = !refresh && old && Date.now()-old.createdAt<MAX_SNAPSHOT_AGE;
    const staleValue = () => ({...old.value,stale:true,refreshing:true,message:old.value.message+' 显示此前真实采集快照，后台正在更新；采集时间未改写。'});
    if(!forceFinal && !refresh && pending.has(key) && old?.value.progressive) return old.value;
    if(stale && pending.has(key) && !forceFinal) return staleValue();
    if (pending.has(key)) return pending.get(key);
    let resolveProgress, published;
    const progress = new Promise(resolve => { resolveProgress=resolve; });
    // Only an actual, correctly filtered source batch can unblock a cold first screen.
    // Keep collecting in the same job; never persist an unfinished batch as a final cache hit.
    const publish = value => {
        if(refresh || forceFinal || !key.startsWith('videos:') || !value?.list?.length)return;
        published={...value,partial:true,refreshing:true,progressive:true,hasMore:false,
            message:value.message+' 已显示先到的真实数据，其余来源仍在采集，当前排名会继续更新。'};
        cache.set(key,{key,value:published,createdAt:Date.now(),expiresAt:0});
        resolveProgress(published);
    };
    const promise = Promise.resolve().then(()=>worker(publish)).then(value => {
        if (key.startsWith('videos:')) {
            const options = JSON.parse(key.slice(7));
            try { value = { ...value, collection: collectionIndex.record(options.platform, value.list, options) }; }
            catch (error) { value = { ...value, collection: { status: 'write-failed', message: error.message } }; }
        }
        if((key.startsWith('videos:') || key.startsWith('discover:')) && old && (value.partial || value.scope?.kind==='public-discover-sample' || key.startsWith('discover:'))) {
            const currentIds=new Set(value.list.map(v=>(v.normPlatform || v.platform)+':'+v.id));
            const retained=old.value.list.filter(v=>Date.now()-v.fetchedAt<MAX_SNAPSHOT_AGE && !currentIds.has((v.normPlatform || v.platform)+':'+v.id));
            if(retained.length) value={...value,list:prepareVideoList([...retained.map(v=>({...v,isCached:true})),...value.list],{timeRange:key.startsWith('videos:')?JSON.parse(key.slice(7)).timeRange:'all',limit:2000}),stale:true,
                coverage:{...value.coverage,retainedCandidates:retained.length},message:value.message+(value.partial?' 部分上游失败，另保留':' 公开发现流会轮换，另保留同一筛选下')+retained.length+'条30分钟内真实采集记录，未改写它们的时间/指标。'};
            if(value.coverage)value.coverage.unique=value.list.length;
        }
        if (cache.size > 150) cache.delete(cache.keys().next().value);
        const saved={ key, value, createdAt: Date.now(), expiresAt: Date.now() + (value.refreshing ? 2000 : value.partial ? 60000 : 120000) };
        cache.set(key, saved);
        // 原子替换真实快照。磁盘缓存失败不把成功的联网结果变成假失败。
        try { fs.mkdirSync(snapshotRoot,{recursive:true}); fs.writeFileSync(filename+'.tmp',JSON.stringify(saved),{mode:0o600}); fs.renameSync(filename+'.tmp',filename); }
        catch { console.warn('[Source Cache] 真实快照未能保存到磁盘'); }
        return value;
    }).catch(error => {
        const fallback=old || (published && cache.get(key));
        if (fallback && Date.now() - fallback.createdAt < MAX_SNAPSHOT_AGE) {
            fallback.retryAfter=Date.now()+30000;
            fallback.value={...fallback.value,progressive:false,refreshing:false,
                ...(!old?{message:'后续来源采集失败：'+error.message+'；保留本次已取得的真实数据。'}:{})};
            cache.set(key,fallback);
            // 源临时故障时只复用此前真实采集的数据，保留原采集时刻；不补日期或计数。
            return { ...fallback.value, stale: true, partial: true, message: fallback.value.message + ' 后续抓取暂不可用，保留此前真实采集结果，可刷新重试。' };
        }
        throw error;
    }).finally(() => pending.delete(key));
    pending.set(key, promise);
    if(stale && !forceFinal) { promise.catch(()=>{}); return staleValue(); }
    return forceFinal ? promise : Promise.race([promise,progress]);
}

async function collectedGeoVideos(options, youtubeWorker) {
    const platforms=options.scope==='current' ? [options.platform] : ['bilibili','douyin','youtube','tiktok','xiaohongshu','kuaishou','twitter'];
    if(options.scope==='current')await getVideos(options,youtubeWorker);
    const collect=()=>[...cache.entries()].flatMap(([key,saved])=>{
        if(!key.startsWith('videos:') || Date.now()-saved.createdAt>=MAX_SNAPSHOT_AGE)return [];
        const filter=JSON.parse(key.slice(7));
        if(!platforms.includes(filter.platform) || filter.category!==options.category || filter.timeRange!==options.timeRange || filter.query!==options.query)return [];
        return saved.value.list.filter(v=>Date.now()-v.fetchedAt<MAX_SNAPSHOT_AGE);
    });
    let list=collect();
    if(!list.length && options.scope!=='current') { await getVideos({...options,platform:'bilibili',page:1,cursor:''},youtubeWorker); list=collect(); }
    list=prepareVideoList(list,{timeRange:options.timeRange,limit:10000});
    return {list,platforms:[...new Set(list.map(v=>v.normPlatform))]};
}

async function biliGet(endpoint, params = {}) {
    const url = new URL(endpoint, 'https://api.bilibili.com');
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    let data;
    try {
        const response = await axios.get(url.toString(), { proxy: false, timeout: 10000, headers: {
            'User-Agent': UA, Referer: 'https://www.bilibili.com/',
            Cookie: sessions.cookieHeader('bilibili') || biliCookie
        } });
        data = response.data;
    } catch (error) {
        if (error.response?.status !== 412) throw error;
    }
    if (!data || data.code === -352 || data.code === -412) {
        data = await withPage('bilibili', async page => {
            await page.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded', timeout: 18000 });
            biliCookie = (await page.cookies()).map(c => c.name + '=' + c.value).join('; ');
            return page.evaluate(async target => {
                const response = await fetch(target, { credentials: 'include', signal: AbortSignal.timeout(8000) });
                return response.json();
            }, url.toString());
        });
    }
    if (data?.code !== 0 && !(endpoint.endsWith('/nav') && data?.data?.wbi_img)) {
        throw new Error('B站接口拒绝请求：' + (data?.message || data?.code || '空响应'));
    }
    return data.data;
}

async function signWbi(params) {
    if (!wbiCache || wbiCache.expiresAt < Date.now()) {
        const nav = await biliGet('/x/web-interface/nav');
        const keys = nav.wbi_img.img_url.split('/').pop().split('.')[0] + nav.wbi_img.sub_url.split('/').pop().split('.')[0];
        const table = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
        wbiCache = { key: table.map(n => keys[n]).join('').slice(0, 32), expiresAt: Date.now() + 1800000 };
    }
    const signed = { ...params, wts: Math.floor(Date.now() / 1000) };
    const query = Object.keys(signed).sort().map(key => encodeURIComponent(key) + '=' + encodeURIComponent(String(signed[key]).replace(/[!'()*]/g, ''))).join('&');
    return { ...signed, w_rid: crypto.createHash('md5').update(query + wbiCache.key).digest('hex') };
}

function biliVideo(item, source) {
    return {
        id: item.bvid, title: (item.title || '').replace(/<[^>]+>/g, ''),
        description: item.desc || item.description || '',
        cover: (item.pic || '').replace(/^http:\/\//, 'https://').replace(/^\/\//, 'https://'),
        author: item.owner?.name || item.author || '', authorAvatar: item.owner?.face || '',
        duration: typeof item.duration === 'number' ? Math.floor(item.duration / 60) + ':' + String(item.duration % 60).padStart(2, '0') : String(item.duration || '').split(':').map((part, i) => i ? part.padStart(2, '0') : part).join(':'),
        playRaw: item.stat?.view ?? item.play ?? null, commentCount: item.stat?.reply ?? item.review ?? null,
        likeRaw:item.stat?.like ?? item.like ?? null,
        collectCount:item.stat?.favorite ?? item.favorites ?? null,shareCount:item.stat?.share ?? null,
        categoryId: Number(item.tid || item.typeid) || null,
        partsCount: Number(item.videos || item.pages?.length) || null,
        pubdate: item.pubdate || 0, url: 'https://www.bilibili.com/video/' + item.bvid,
        platform: 'bilibili', metric: 'views', metricLabel: '播放', source, fetchedAt: Date.now()
    };
}

async function biliSearchPage(keyword, timeRange, page = 1, categoryId = 0) {
    const params = { search_type: 'video', keyword, page, page_size: 20, order: 'click' };
    if (categoryId) params.tids = categoryId;
    if (TIME_RANGE_SECONDS[timeRange]) {
        params.pubtime_begin_s = Math.floor(Date.now() / 1000) - TIME_RANGE_SECONDS[timeRange];
        params.pubtime_end_s = Math.floor(Date.now() / 1000);
    }
    const data = await biliGet('/x/web-interface/wbi/search/type', await signWbi(params));
    return { list: (data.result || []).filter(v => v.bvid).map(v => biliVideo(v, 'bilibili:search')),
        hasMore: page < Number(data.numPages || 0), total: Number(data.numResults || 0) };
}

async function biliSearch(keyword, timeRange, page = 1) {
    return (await biliSearchPage(keyword, timeRange, page)).list;
}

async function biliVideos({ category, timeRange, query, page = 1 }, publish=()=>{}) {
    const deadline = Date.now() + 25000;
    const terms = CATEGORY_QUERIES[category] || CATEGORY_QUERIES.all;
    // 用户关键词不强行追加分类词（会丢失标题未写分类词的作品）。
    // 明确分区走官方分区参数，其余语义分类才使用多关键词检索。
    const partition = { kuso: 119, tech: 188, fashion: 155, ent: 5 }[category] || 0;
    const queries = query ? (partition || category === 'all' ? [query] : terms.map(term => query + ' ' + term)) : terms;
    const tasks = queries.flatMap(term => [0, 1, 2].map(offset => ({ name: '搜索:' + term + ':' + ((page - 1) * 3 + offset + 1),
        run: () => biliSearchPage(term, timeRange, (page - 1) * 3 + offset + 1, partition) })));
    if (!query && category === 'all' && page === 1) {
        for (const [name, endpoint, params] of [
            ['官方当期榜', '/x/web-interface/ranking/v2', { rid: 0, type: 'all' }],
            ['官方热门', '/x/web-interface/popular', { pn: 1, ps: 50 }],
            ['官方入站必刷', '/x/web-interface/popular/precious', {}]
        ]) tasks.unshift({ name, run: async () => ({ list: (await biliGet(endpoint, params)).list.map(v => biliVideo(v, 'bilibili:' + endpoint.split('/').pop())), hasMore: false }) });
    }
    const arrived=[];let lastPublished=0;
    const results = await boundedMap(tasks, 6, async task => {
        if (Date.now() > deadline) throw new Error('本批抓取超出25秒预算，可刷新重试');
        const result=await task.run();
        arrived.push(...result.list);
        if(Date.now()-lastPublished>300) {
            const preview=prepareVideoList(arrived,{timeRange,limit:2000});
            if(preview.length>=30) {
                lastPublished=Date.now();
                publish({list:preview,source:'bilibili:official',scope:{kind:'discovered-videos',label:'采集中 · 已收到作品的暂定播放排序',exhaustive:false,metric:'views'},
                    coverage:{candidates:arrived.length,unique:preview.length},message:'B站官方真实作品分批返回，后台继续多领域检索与首屏详情核验。'});
            }
        }
        return result;
    });
    const good = results.filter(r => r.value);
    if (!good.length) throw results[0].error;
    const candidates = good.flatMap(r => r.value.list);
    let list = prepareVideoList(candidates, { timeRange, limit: 2000 });
    // 官方当期榜/热门/入站必刷已具备准确计数；仅需对前排搜索条目按需核验详情，大幅降低首屏等待时间。
    const needsVerification = list.slice(0, 30).filter(v => v.source === 'bilibili:search');
    const verified = await boundedMap(needsVerification, 6, async video => {
        if (Date.now() > deadline) throw new Error('本批详情核验预算已用完');
        return biliVideo(await biliGet('/x/web-interface/view', { bvid: video.id }), 'bilibili:verified-detail');
    });
    const verifiedMap = new Map(verified.filter(r => r.value).map(r => [r.value.id, r.value]));
    list = prepareVideoList(list.map(v => verifiedMap.get(v.id) || v), { timeRange, limit: 2000 });
    const sources = results.map((result, i) => ({ name: tasks[i].name, status: result.error ? 'failed' : 'ok', count: result.value?.list.length || 0, message: result.error?.message }));
    const searchAvailable = results.some((r, i) => tasks[i].name.startsWith('搜索:') && r.value?.list.length);
    return { list, hasMore: page < 10 && good.some(r => r.value.hasMore), source: 'bilibili:official',
        scope: { kind: 'discovered-videos', label: timeRange === 'all' ? '历史高播放 · 已发现作品' : '发布时效内 · 已发现作品', exhaustive: false, metric: 'views', categoryMethod: partition ? 'platform-partition' : 'semantic-search' },
        coverage: { candidates: candidates.length, unique: list.length, sources, searchAvailable, detailsVerified: verified.filter(r => r.value).length, detailsFailed: verified.filter(r => r.error).length },
        message: 'B站多领域搜索' + (!query && category === 'all' && page === 1 ? ' + 官方热门/当期榜/入站必刷' : '') + '，按真实播放量排序。' + (!searchAvailable ? '历史检索暂不可用，当前仅有当期样本。' : '仅对已发现作品排名，不冒充全站历史总榜。') + '多P作品为作品累计播放。', partial: good.length < results.length || verified.some(r => r.error) };
}

function douyinVideo(aweme) {
    if (!aweme?.aweme_id || !aweme.video || !aweme.author) return null;
    const stats = aweme.statistics || {};
    return {
        id: String(aweme.aweme_id), title: aweme.desc || '', description: [aweme.desc,...(aweme.video_tag || []).map(t=>t.tag_name)].filter(Boolean).join(' '),
        cover: aweme.video.cover?.url_list?.[0] || aweme.video.origin_cover?.url_list?.[0] || '',
        author: aweme.author.nickname || '', authorAvatar: aweme.author.avatar_thumb?.url_list?.[0] || '',
        duration: Math.floor((aweme.video.duration || aweme.duration || 0) / 1000) + '秒',
        pubdate: aweme.create_time || 0, url: 'https://www.douyin.com/video/' + aweme.aweme_id,
        // 网页接口常用0占位隐藏播放，不能把它当成真实零播放或用点赞推算。
        platform: 'douyin', playRaw: Number(stats.play_count)>0 ? Number(stats.play_count) : null, likeRaw: stats.digg_count ?? null,
        metric: 'views', metricLabel: '播放', metricRaw: Number(stats.play_count)>0 ? Number(stats.play_count) : null,
        commentCount: stats.comment_count ?? null,collectCount:stats.collect_count ?? null,shareCount:stats.share_count ?? null,
        source: 'douyin:aweme', fetchedAt: Date.now()
    };
}

function collectAwemes(data, out = [], seen = new Set()) {
    if (!data || typeof data !== 'object' || seen.has(data)) return out;
    seen.add(data);
    if (data.aweme_id && data.video && data.author) { out.push(data); return out; }
    for (const value of Object.values(data)) if (value && typeof value === 'object') collectAwemes(value, out, seen);
    return out;
}

async function douyinVideos({ category, timeRange, query, page=1, refresh=false },publish=()=>{}) {
    const {lightweightPage,clickCategory,scrollMore}=require('./public-browser');
    const labels={comedy:['小剧场'],ent:['影视'],fashion:['穿搭'],pets:['动物'],wildlife:['动物'],animal:['动物'],tech:['知识'],marketing:['知识'],kuso:['二次元']};
    const batch=await memo('public-douyin:'+category+':'+page,()=>withPage('douyin',async browserPage=>{
        const found=[],captures=[];let epoch=0,nativeCategory=false,hasMore=false;
        const requestEpochs=new Map();
        browserPage.on('request',request=>requestEpochs.set(request,epoch));
        browserPage.on('response',response=>{
            if(!/\/aweme\/v2\/web\/module\/feed\/|\/aweme\/v1\/web\/(?:tab\/feed|hot\/video\/list|multi\/aweme\/detail)\//.test(response.url()))return;
            const request=response.request(),current=requestEpochs.get(request);
            if(current!==epoch)return;
            captures.push(response.json().then(data=>{if(epoch===current){collectAwemes(data,found);if(data.has_more!=null)hasMore=Boolean(data.has_more);}}).catch(()=>{}));
        });
        await lightweightPage(browserPage);
        await browserPage.goto('https://www.douyin.com/jingxuan',{waitUntil:'domcontentloaded',timeout:18000});
        for(let i=0;i<4 && !found.length;i++)await new Promise(resolve=>setTimeout(resolve,500));
        if(category!=='all') {
            nativeCategory=await clickCategory(browserPage,labels[category],()=>{epoch++;found.length=0;});
        }
        for(let i=0;i<Math.min(20,page*12);i++) {
            await scrollMore(browserPage);await new Promise(resolve=>setTimeout(resolve,600));
            if(found.length)publish(combine({list:prepareVideoList(found.map(douyinVideo).filter(Boolean),{limit:2000}),nativeCategory,hasMore}));
            if(new Set(found.map(v=>v.aweme_id)).size>=Math.max(60,page*30))break;
        }
        await Promise.allSettled(captures);
        if(!found.length)throw new Error('抖音公开精选页本次未返回可核验作品；未要求用户登录、未以热搜替代视频。');
        return {list:prepareVideoList(found.map(douyinVideo).filter(Boolean),{limit:2000}),nativeCategory,hasMore};
    },{anonymous:true}),refresh);
    return combine(batch);
    function combine(batch) {
    const terms=(category==='tech'?['科技','数码','人工智能','手机','电脑','芯片','iphone','相机','机器人']:CATEGORY_QUERIES[category] || []).map(s=>s.toLowerCase());
    const list=prepareVideoList(batch.list.filter(v=>(!query || (v.title+' '+v.author).toLowerCase().includes(query.toLowerCase()))
        && (category==='all' || batch.nativeCategory && !['tech','marketing','kuso'].includes(category) || terms.some(t=>(v.title+' '+v.description).toLowerCase().includes(t)))),{timeRange,limit:2000});
    return {list,hasMore:page<5 && batch.hasMore,source:'douyin:anonymous-discover',
        scope:{kind:'public-discover-sample',label:query?'公开精选样本内检索（非全站搜索）':'免登录公开精选作品',exhaustive:false,metric:'views',categoryMethod:batch.nativeCategory?'native-channel':'semantic-title'},
        coverage:{candidates:batch.list.length,unique:list.length},message:'无需扫码或账号：来自抖音官网公开精选页。只对公开播放计数排名；未公开播放量不入榜，点赞仅辅助。'+(query?'关键词仅在本次发现作品内匹配，不能冒充全站搜索。':'')+'时效按作品原始发布时间过滤。'};
    }
}

async function douyinTopics() {
    const url = 'https://www.douyin.com/aweme/v1/web/hot/search/list/';
    let data = (await axios.get(url, { proxy: false, timeout: 8000, headers: { 'User-Agent': UA, Referer: 'https://www.douyin.com/', Cookie: sessions.cookieHeader('douyin') } })).data;
    if (!data?.data?.word_list?.length) {
        data = await withPage('douyin', async page => {
            await page.goto('https://www.douyin.com/hot', { waitUntil: 'domcontentloaded', timeout: 18000 });
            return page.evaluate(async target => (await fetch(target, { signal: AbortSignal.timeout(8000) })).json(), url);
        });
    }
    if (!data?.data?.word_list?.length) throw new Error('抖音官方热搜接口暂不可用');
    return data.data.word_list.map((item, i) => ({
        id: String(item.sentence_id || item.group_id), title: item.word, rank: item.position || i + 1,
        heatRaw: item.hot_value ?? null, heatDisplay: item.hot_value == null ? '未公开' : formatHeatChinese(item.hot_value),
        worksCount: item.video_count ?? null, worksCountDisplay: item.video_count == null ? '作品数未公开' : item.video_count + '条关联作品',
        tag: item.label === 1 ? '新' : item.label === 2 ? '热' : '热搜', cover: item.word_cover?.url_list?.[0] || '',
        eventTime: item.event_time || 0, source: 'douyin:hot-search', sourceUrl: url,
        desc: '抖音官方热搜 · 原始热度值', fetchedAt: Date.now()
    }));
}

async function biliTopics() {
    const data = await biliGet('/x/web-interface/search/square', { limit: 50 });
    const raw = data.trending?.list || data.data?.trending?.list || [];
    if (!raw.length) throw new Error('B站官方热搜暂不可用');
    return raw.map((item, i) => ({
        id: 'bili:' + (item.keyword || item.show_name), title: item.show_name || item.keyword,
        rank: i + 1, tag: '热搜', heatRaw: item.heat_score ?? null,
        heatDisplay: item.heat_score == null ? '未公开' : formatHeatChinese(item.heat_score),
        worksCount: null, worksCountDisplay: '作品数未公开', desc: 'B站官方实时热搜 · 平台未提供热度时保留排名',
        source: 'bilibili:hot-search', sourceUrl: 'https://search.bilibili.com/', fetchedAt: Date.now()
    }));
}

async function getVideos(options, youtubeWorker) {
    const { platform = 'bilibili', category = 'all', timeRange = 'all', query = '', page = 1, cursor = '' } = options;
    const normalized = { platform, category, timeRange, query, page, cursor };
    return observed(platform, 'videos', () => memo('videos:' + JSON.stringify(normalized), async publish => {
        if (normalized.platform === 'bilibili') return biliVideos(normalized,publish);
        if (normalized.platform === 'douyin') {
            const open = require('./douyin-open');
            if (open.configured()) {
                try { return await open.videos(normalized, { boundedMap }); }
                catch (error) {
                    const publicResult = await douyinVideos({...normalized,refresh:options.refresh},publish);
                    return { ...publicResult, partial: true, message: publicResult.message + ' 官方播放量接口未接通：' + error.message };
                }
            }
            return douyinVideos({...normalized,refresh:options.refresh},publish);
        }
        const adapters = require('./platform-rankings');
        if (normalized.platform === 'youtube' && process.env.YOUTUBE_API_KEY) return adapters.youtubeApiVideos(normalized);
        if (normalized.platform === 'youtube' && youtubeWorker) return youtubeWorker(normalized);
        if (normalized.platform === 'twitter') return process.env.X_BEARER_TOKEN?adapters.xApiVideos(normalized):require('./x-public').publicVideos({...normalized,refresh:options.refresh},{memo,boundedMap});
        if (adapters.PAGE_SOURCES[normalized.platform]) return adapters.publicPageVideos({...normalized,refresh:options.refresh}, { withPage, memo, onProgress:publish });
        throw new Error('该平台没有可核验的实时视频源，当前不展示固定素材。');
    }, options.refresh, options.final));
}

async function getTopics(options) {
    return observed(options.platform, 'topics', () => memo('topics:' + options.platform, async () => {
        const list = options.platform === 'bilibili' ? await biliTopics() : options.platform === 'douyin' ? await douyinTopics() : null;
        if (!list) throw Object.assign(new Error('该平台没有已接通并核验的官方话题榜，不能用其它平台或视频搜索结果替代。'), {status:501});
        return { list, source: list[0]?.source, message: '实时话题榜保留官方排名；发布时效筛选用于关联视频。' };
    }, options.refresh));
}

function aggregateGeo(list) {
    const cities = new Map();
    for (const video of attachVideoLocations(list)) {
        if (!video.geo) continue;
        const key = video.geo.country + ':' + video.geo.city;
        const row = cities.get(key) || { ...video.geo, count: 0, totalHeat: 0, samples: [] };
        row.count += 1;
        row.totalHeat += Number(video.metricRaw || 0);
        if (row.samples.length < 3) row.samples.push({ id: video.id, title: video.title });
        cities.set(key, row);
    }
    const rows = [...cities.values()].sort((a, b) => b.count - a.count || b.totalHeat - a.totalHeat);
    const max = Math.max(1, ...rows.map(r => r.count));
    return rows.map(row => ({ ...row, radius: 0.35 + Math.sqrt(row.count / max) * 1.25,
        color: row.count / max > 0.65 ? '#ff2442' : row.count / max > 0.3 ? '#f59e0b' : '#22d3ee',
        tier: row.count / max > 0.65 ? 'high' : row.count / max > 0.3 ? 'medium' : 'normal' }));
}

async function closeBrowser() { if (browserPromise) { const browser = await browserPromise; await browser.close(); browserPromise = null; } anonymousContexts.clear(); }
module.exports = { UA, withPage, getVideos, getTopics, biliGet, biliSearch, biliSearchPage, biliVideo, boundedMap, douyinVideo, collectAwemes, aggregateGeo, closeBrowser, getSourceStatus, collectedGeoVideos };
