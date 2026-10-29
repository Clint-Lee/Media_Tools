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
        // 优先使用本机已安装的 Chrome：PUPPETEER_EXECUTABLE_PATH > 常见安装路径 > puppeteer 自带下载版。
        const fs = require('fs');
        const candidates = [
            process.env.PUPPETEER_EXECUTABLE_PATH,
            process.env['ProgramFiles'] && process.env['ProgramFiles'] + '\\Google\\Chrome\\Application\\chrome.exe',
            process.env['ProgramFiles(x86)'] && process.env['ProgramFiles(x86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
            process.env.LOCALAPPDATA && process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
        ].filter(Boolean);
        const executablePath = candidates.find(candidate => fs.existsSync(candidate));
        browserPromise = puppeteer.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox', '--disable-setuid-sandbox'] })
            .then(browser => {
                browser.on('disconnected', () => { browserPromise = null; anonymousContexts.clear(); });
                return browser;
            }).catch(error => { browserPromise = null; throw error; });
    }
    return browserPromise;
}

async function withPage(platform, worker, { anonymous=false, timeoutMs=30000, signal, fresh=false } = {}) {
    if (signal?.aborted) throw new Error('平台页面任务已取消');
    const browser = await getBrowser();
    if (signal?.aborted) throw new Error('平台页面任务已取消');
    const contextOptions = { ...(['tiktok','twitter'].includes(platform) && process.env.MEDIA_PROXY ? { proxyServer: process.env.MEDIA_PROXY } : {}) };
    // Anonymous technical cookies stay in memory like a normal guest browser session.
    // Never share the optional personal-cookie context or reset a context to evade a challenge.
    const key = platform + ':' + (contextOptions.proxyServer || 'direct');
    // TikTok's parallel discover/tag/ads pages must keep their technical sessions separate.
    const sharedAnonymous = anonymous && platform !== 'tiktok' && !fresh;
    let context;
    if (sharedAnonymous) {
        if (!anonymousContexts.has(key)) {
            const opening = browser.createBrowserContext(contextOptions).catch(error => { anonymousContexts.delete(key); throw error; });
            anonymousContexts.set(key, opening);
        }
        context = await anonymousContexts.get(key);
    } else context = await browser.createBrowserContext(contextOptions);
    const page = await context.newPage();
    let timer, onAbort;
    try {
        if (signal?.aborted) throw new Error('平台页面任务已取消');
        await page.setUserAgent(UA);
        await page.setViewport({ width: 1440, height: 900 });
        const cookies = anonymous ? [] : sessions.browserCookies(platform);
        if (cookies.length) await page.setCookie(...cookies);
        return await Promise.race([worker(page), new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('平台页面读取超过处理时限，已停止本次抓取，可稍后重试。')), Math.min(30000, Math.max(1, timeoutMs)));
            onAbort = () => reject(new Error('平台页面任务已取消'));
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted) onAbort();
        })]);
    } finally {
        clearTimeout(timer);
        if (onAbort) signal?.removeEventListener('abort', onAbort);
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
                // 逐项比较取最新观测时间，避免 Math.max(...大数组) 的栈溢出隐患
                let newestFetchedAt=0;
                for(const video of list)if(Number.isFinite(video.fetchedAt) && video.fetchedAt>newestFetchedAt)newestFetchedAt=video.fetchedAt;
                old={createdAt:newestFetchedAt,expiresAt:0,value:{list,hasMore:false,source:options.platform+':collected-preview',
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
        if((key.startsWith('videos:') || key.startsWith('discover:')) && old && (value.partial || key.startsWith('discover:') || value.scope?.kind==='public-discover-sample')) {
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
    const views=require('./public-view-evidence').douyinViews(aweme);
    return {
        id: String(aweme.aweme_id), title: aweme.desc || '', description: [aweme.desc,...(aweme.video_tag || []).map(t=>t.tag_name)].filter(Boolean).join(' '),
        cover: aweme.video.cover?.url_list?.[0] || aweme.video.origin_cover?.url_list?.[0] || '',
        author: aweme.author.nickname || '', authorAvatar: aweme.author.avatar_thumb?.url_list?.[0] || '',
        duration: Math.floor((aweme.video.duration || aweme.duration || 0) / 1000) + '秒',
        pubdate: aweme.create_time || 0, url: 'https://www.douyin.com/video/' + aweme.aweme_id,
        // 网页接口常用0占位隐藏播放，不能把它当成真实零播放或用点赞推算。
        platform: 'douyin', ...views, likeRaw: stats.digg_count ?? null,
        metric: 'views', metricLabel: '播放', metricRaw: views.playRaw,
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

async function collectDouyinPage(browserPage,{category,page=1},publish=()=>{},
    {now=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),budgetMs=25000,captureWaitMs=1500}={}) {
    const {lightweightPage,clickCategory,scrollMore}=require('./public-browser');
    const labels={comedy:['小剧场'],ent:['影视'],fashion:['穿搭'],pets:['动物'],wildlife:['动物'],animal:['动物'],tech:['知识'],marketing:['知识'],kuso:['二次元']};
    const deadline=now()+budgetMs;
    const found=[],captures=[];let epoch=0,nativeCategory=false,hasMore=false,paginationKnown=false,settled=0;
    const requestEpochs=new Map();
    browserPage.on('request',request=>requestEpochs.set(request,epoch));
    browserPage.on('response',response=>{
        if(!/\/aweme\/v2\/web\/module\/feed\/|\/aweme\/v1\/web\/(?:tab\/feed|hot\/video\/list|multi\/aweme\/detail)\//.test(response.url()))return;
        const request=response.request(),current=requestEpochs.get(request);
        if(current!==epoch)return;
        captures.push(response.json().then(data=>{if(epoch===current){collectAwemes(data,found);if(data.has_more!=null){hasMore=Boolean(data.has_more);paginationKnown=true;}}}).catch(()=>{}).finally(()=>{settled++;}));
    });
    await lightweightPage(browserPage);
    await browserPage.goto('https://www.douyin.com/jingxuan',{waitUntil:'domcontentloaded',timeout:18000});
    for(let i=0;i<4 && !found.length && now()<deadline-1000;i++)await wait(500);
    if(category!=='all') {
        nativeCategory=await clickCategory(browserPage,labels[category],()=>{epoch++;found.length=0;paginationKnown=false;hasMore=false;});
    }
    for(let i=0;i<Math.min(20,page*12);i++) {
        if(now()>=deadline-1000)break;
        await scrollMore(browserPage);await wait(600);
        if(found.length)publish({list:prepareVideoList(found.map(douyinVideo).filter(Boolean),{limit:2000}),nativeCategory,hasMore});
        if(new Set(found.map(v=>v.aweme_id)).size>=Math.max(60,page*30) || paginationKnown && !hasMore && found.length)break;
    }
    let timer;
    try {
        await Promise.race([Promise.allSettled(captures),new Promise(resolve=>{timer=setTimeout(resolve,Math.max(0,Math.min(captureWaitMs,deadline-now())));})]);
    }finally {clearTimeout(timer);}
    if(!found.length)throw new Error('抖音公开精选页本次未返回可核验作品；未要求用户登录、未以热搜替代视频。');
    return {list:prepareVideoList(found.map(douyinVideo).filter(Boolean),{limit:2000}),nativeCategory,hasMore,
        partial:settled<captures.length || now()>=deadline-1000};
}
async function douyinVideos({ category, timeRange, query, page=1, refresh=false },publish=()=>{}) {
    const batch=await memo('public-douyin:'+category+':'+page,()=>withPage('douyin',browserPage=>collectDouyinPage(browserPage,{category,page},value=>publish(combine(value))),{anonymous:true}),refresh);
    return combine(batch);
    function combine(batch) {
    const terms=(category==='tech'?['科技','数码','人工智能','手机','电脑','芯片','iphone','相机','机器人']:CATEGORY_QUERIES[category] || []).map(s=>s.toLowerCase());
    const list=prepareVideoList(batch.list.filter(v=>(!query || (v.title+' '+v.author).toLowerCase().includes(query.toLowerCase()))
        && (category==='all' || batch.nativeCategory && !['tech','marketing','kuso'].includes(category) || terms.some(t=>(v.title+' '+v.description).toLowerCase().includes(t)))),{timeRange,limit:2000});
    const estimatedRows=require('./estimated-views').apply(list),estimated=estimatedRows.estimatedViews;
    return {list:prepareVideoList(estimatedRows,{timeRange,limit:2000}),hasMore:page<5 && batch.hasMore,source:'douyin:anonymous-discover',partial:Boolean(batch.partial),
        scope:{kind:'public-discover-sample',label:query?'公开精选样本内检索（非全站搜索）':'免登录公开精选作品',exhaustive:false,metric:'views',categoryMethod:batch.nativeCategory?'native-channel':'semantic-title'},
        coverage:{candidates:batch.list.length,unique:list.length,estimatedViews:estimated},message:'无需扫码或账号：来自抖音官网公开精选页。'+(estimated?' 平台隐藏匿名播放计数，展示按真实点赞推算的预估播放（非平台数据）。':' 未公开播放量不入榜，点赞仅辅助。')+(query?'关键词仅在本次发现作品内匹配，不能冒充全站搜索。':'')+'时效按作品原始发布时间过滤。'+(batch.partial?' 部分响应尚未返回，保留本次已核验作品。':'')};
    }
}

async function douyinTopics() {
    const url = 'https://www.douyin.com/aweme/v1/web/hot/search/list/';
    const fallback = async () => {
        // 官方热榜接口受限时，退回公开热榜聚合源（真实话题与平台热度值，不是播放量）。
        const hotlists = require('./platform-hotlists');
        const result = await hotlists.fetchSource('60s-douyin');
        return result.list.map(topic => ({ ...topic, source: 'douyin:hot-search-aggregator', sourceUrl: hotlists.SOURCES['60s-douyin'].url,
            desc: '抖音热榜 · 公开聚合接口转述的平台热度值，不是视频播放量' }));
    };
    let list;
    try {
        let data = (await axios.get(url, { proxy: false, timeout: 8000, headers: { 'User-Agent': UA, Referer: 'https://www.douyin.com/', Cookie: sessions.cookieHeader('douyin') } })).data;
        if (!data?.data?.word_list?.length) {
            data = await withPage('douyin', async page => {
                await page.goto('https://www.douyin.com/hot', { waitUntil: 'domcontentloaded', timeout: 18000 });
                return page.evaluate(async target => (await fetch(target, { signal: AbortSignal.timeout(8000) })).json(), url);
            });
        }
        if (!data?.data?.word_list?.length) throw new Error('抖音官方热搜接口暂不可用');
        list = data.data.word_list.map((item, i) => ({
            id: String(item.sentence_id || item.group_id), title: item.word, rank: item.position || i + 1,
            heatRaw: item.hot_value ?? null, heatDisplay: item.hot_value == null ? '未公开' : formatHeatChinese(item.hot_value),
            worksCount: item.video_count ?? null, worksCountDisplay: item.video_count == null ? '作品数未公开' : item.video_count + '条关联作品',
            tag: item.label === 1 ? '新' : item.label === 2 ? '热' : '热搜', cover: item.word_cover?.url_list?.[0] || '',
            eventTime: item.event_time || 0, source: 'douyin:hot-search', sourceUrl: url,
            desc: '抖音官方热搜 · 原始热度值', fetchedAt: Date.now()
        }));
    } catch (error) {
        list = await fallback();
        return { list, source: list[0]?.source, partial: true,
            message: '抖音官方热搜接口本次不可用（' + error.message + '），已改用公开热榜聚合接口的真实话题与平台热度值；热度值不是视频播放量。' };
    }
    return { list, source: 'douyin:hot-search', message: '抖音官方实时热搜词，保留平台排名与原始热度值；热度不是视频播放量。' };
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
                    if (normalized.page > 1) throw error;
                    const publicResult = await douyinVideos({...normalized,refresh:options.refresh},publish);
                    return { ...publicResult, partial: true, message: publicResult.message + ' 官方播放量接口未接通：' + error.message };
                }
            }
            if (normalized.page > 1 && normalized.cursor) throw new Error('抖音公开发现不接受外部翻页游标');
            // 抖音有三个互补的真实来源：开放平台热点视频（需凭证）→ 官网热点视频榜 → 官网公开精选。
            // 子源不直接 publish，避免合并前的单源数据抢先成为首屏结果。
            // 第2页起：热点榜只提供第1页，公开精选按页深滚动继续采集真实作品。
            const sources = [
                { name: '官网热点视频榜', run: () => require('./douyin-hotspot').hotspotRanking(normalized, { withPage, memo, refresh: options.refresh }) },
                { name: '官网公开精选', run: () => douyinVideos({ ...normalized, refresh: options.refresh }, () => {}) }
            ];
            const results = (await boundedMap(sources, 2, async source => ({ name: source.name, value: await source.run().catch(error => ({ list: [], error })) })))
                .map(row => row.value || { name: '未知', value: { list: [], error: row.error } });
            const arrived = [];
            for (const result of results) if (result.value?.list) arrived.push(...result.value.list);
            // 先到的真实数据先显示，不让首屏等慢源。
            if (arrived.length >= 20) publish({ list: prepareVideoList(arrived, { timeRange: normalized.timeRange, limit: 2000 }),
                source: 'douyin:multi-source', scope: { kind: 'discovered-videos', label: '采集中 · 已收到作品的暂定排序', exhaustive: false, metric: 'views' },
                coverage: { candidates: arrived.length }, message: '抖音多来源真实作品分批返回，后台继续合并其余来源。' });
            const good = results.filter(result => result.value?.list?.length);
            if (!good.length) {
                const reason = results.map(result => result.name + ':' + (result.value?.error?.message || result.value?.error || '未知')).join('；');
                throw new Error('抖音本次两个来源均未返回真实作品。' + reason);
            }
            let list = prepareVideoList(good.flatMap(result => result.value.list), { timeRange: normalized.timeRange, limit: 2000 });
            // 详情补全为可选匿名钩子，不自动借用服务级个人凭证。
            const views = require('./douyin-views');
            list = prepareVideoList(views.apply(list), { timeRange: normalized.timeRange, limit: 2000 });
            if (options.enrichViews === true) views.enrich(list).catch(() => {});
            // 实验预估默认关闭；保留兼容显示，但不进入真实播放排名。
            const estimatedRows = require('./estimated-views').apply(list);
            list = prepareVideoList(estimatedRows, { timeRange: normalized.timeRange, limit: 2000 });
            const estimated = estimatedRows.estimatedViews;
            const coverage = { candidates: arrived.length, unique: list.length,
                sources: results.map(result => ({ name: result.name, status: result.value?.error ? 'failed' : 'ok', count: result.value?.list?.length || 0, message: result.value?.error?.message || '' })) };
            const hiddenViews = list.filter(video => video.playRaw == null && video.viewEvidence?.status === 'placeholder-zero').length;
            const unknownViews = list.filter(video => video.playRaw == null).length;
            const viewEnrichment = views.status();
            return { list, hasMore: normalized.page < 5 && good.some(result => result.value?.hasMore), source: 'douyin:multi-source',
                scope: { kind: 'discovered-videos', label: unknownViews || estimated ? '抖音热点榜 + 公开精选 · 仅已核验播放参与排名' : '抖音热点榜 + 公开精选 · 实际播放量', exhaustive: false, metric: 'views', categoryMethod: 'semantic-title' },
                coverage: { ...coverage, hiddenViews, estimatedViews: estimated }, metricEnrichment: viewEnrichment,
                partial: true,
                message: '抖音多来源真实作品：官网热点视频榜（channel/hotspot）+ 官网公开精选（module/feed）。'
                    + '匿名详情补全不借用个人凭证；授权配置也不保证返回播放量。'
                    + (estimated ? ' 实验预估仅作参考展示，不参与真实播放榜。' : '')
                    + (unknownViews ? ' 共 ' + unknownViews + ' 件仍未取得实际播放量，不参与播放榜，可主动切换公开点赞榜。' : ' ')
                    + '标题、作者、发布时间、互动计数均为平台实际返回。'
                    + (results.some(result => result.value?.error) ? ' 部分来源本次失败：' + results.filter(result => result.value?.error).map(result => result.name).join('、') + '。' : '')
            };
        }
        const adapters = require('./platform-rankings');
        if (normalized.platform === 'youtube' && process.env.YOUTUBE_API_KEY) return adapters.youtubeApiVideos(normalized);
        // 无 API Key 时优先用 innertube 公开检索（平台实际观看计数），失败再退回 HTML 解析路径。
        if (normalized.platform === 'youtube' && youtubeWorker) {
            try { return await require('./youtube-innertube').createClient({ withPage }).search(normalized); }
            catch (error) { return youtubeWorker({ ...normalized, refresh: options.refresh }, error); }
        }
        if (normalized.platform === 'twitter') return process.env.X_BEARER_TOKEN?adapters.xApiVideos(normalized):require('./x-public').publicVideos({...normalized,refresh:options.refresh},{memo,boundedMap});
        if (adapters.PAGE_SOURCES[normalized.platform]) return adapters.publicPageVideos({...normalized,refresh:options.refresh}, { withPage, memo, onProgress:publish });
        throw new Error('该平台没有可核验的实时视频源，当前不展示固定素材。');
    }, options.refresh, options.final));
}

async function getTopics(options) {
    return observed(options.platform, 'topics', () => memo('topics:' + options.platform, async () => {
        const result = options.platform === 'bilibili' ? { list: await biliTopics(), message: 'B站官方实时热搜 · 平台未提供热度时保留排名' }
            : options.platform === 'douyin' ? await douyinTopics() : null;
        if (!result?.list?.length) throw Object.assign(new Error('该平台没有已接通并核验的官方话题榜，不能用其它平台或视频搜索结果替代。'), { status: 501 });
        return { list: result.list, source: result.list[0]?.source, partial: Boolean(result.partial),
            message: result.message || '实时话题榜保留官方排名；发布时效筛选用于关联视频。' };
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
module.exports = { UA, withPage, getVideos, getTopics, biliGet, biliSearch, biliSearchPage, biliVideo, boundedMap, douyinVideo, collectAwemes, collectDouyinPage, aggregateGeo, closeBrowser, getSourceStatus, collectedGeoVideos };
