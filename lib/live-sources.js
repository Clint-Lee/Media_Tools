'use strict';

const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
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
let biliCookie = '';
let wbiCache;
const cache = new Map();
const pending = new Map();
const sourceStatus = new Map();
async function observed(platform, kind, worker) {
    try {
        const result = await worker();
        sourceStatus.set(platform+':'+kind, { status:result.stale ? 'cached' : result.partial ? 'partial' : 'ok', checkedAt:Date.now(), collectedAt:result.list[0]?.fetchedAt || null, count:result.list.length, message:result.message });
        return result;
    } catch(error) { sourceStatus.set(platform+':'+kind, { status:'unavailable',checkedAt:Date.now(),count:0,message:error.message }); throw error; }
}
function getSourceStatus(platform) { return { videos:sourceStatus.get(platform+':videos') || {status:'not-verified'}, topics:sourceStatus.get(platform+':topics') || {status:'not-verified'} }; }

async function getBrowser() {
    if (!browserPromise) {
        browserPromise = puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
            .then(browser => {
                browser.on('disconnected', () => { browserPromise = null; });
                return browser;
            }).catch(error => { browserPromise = null; throw error; });
    }
    return browserPromise;
}

async function withPage(platform, worker) {
    const browser = await getBrowser();
    const context = await browser.createBrowserContext({ ...(platform === 'tiktok' && process.env.MEDIA_PROXY ? { proxyServer: process.env.MEDIA_PROXY } : {}) });
    const page = await context.newPage();
    let timer;
    try {
        await page.setUserAgent(UA);
        await page.setViewport({ width: 1440, height: 900 });
        const domains = { bilibili: 'bilibili.com', douyin: 'douyin.com', tiktok: 'tiktok.com', xiaohongshu: 'xiaohongshu.com', kuaishou: 'kuaishou.com' };
        const cookie = process.env[platform.toUpperCase() + '_COOKIE'];
        if (cookie) {
            await page.setCookie(...cookie.split(';').map(part => {
                const split = part.indexOf('=');
                return { name: split > 0 ? part.slice(0, split).trim() : '', value: part.slice(split + 1).trim(), domain: '.' + domains[platform], path: '/' };
            }).filter(part => part.name));
        }
        return await Promise.race([worker(page), new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('平台页面读取超过30秒，已停止本次抓取，可稍后重试。')), 30000);
        })]);
    } finally { clearTimeout(timer); await context.close().catch(() => {}); }
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

async function memo(key, worker, refresh = false) {
    if (!refresh && cache.get(key)?.expiresAt > Date.now()) return cache.get(key).value;
    if (pending.has(key)) return pending.get(key);
    const promise = worker().then(value => {
        if (cache.size > 150) cache.delete(cache.keys().next().value);
        cache.set(key, { value, createdAt: Date.now(), expiresAt: Date.now() + (value.partial ? 60000 : 120000) });
        return value;
    }).catch(error => {
        const old = cache.get(key);
        if (old && Date.now() - old.createdAt < 1800000) {
            // 源临时故障时只复用此前真实采集的数据，保留原采集时刻；不补日期或计数。
            return { ...old.value, stale: true, partial: true, message: old.value.message + ' 实时抓取暂不可用，显示30分钟内的真实采集缓存（非实时），可刷新重试。' };
        }
        throw error;
    }).finally(() => pending.delete(key));
    pending.set(key, promise);
    return promise;
}

async function biliGet(endpoint, params = {}) {
    const url = new URL(endpoint, 'https://api.bilibili.com');
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    let data;
    try {
        const response = await axios.get(url.toString(), { proxy: false, timeout: 10000, headers: {
            'User-Agent': UA, Referer: 'https://www.bilibili.com/',
            Cookie: process.env.BILIBILI_COOKIE || biliCookie
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

async function biliVideos({ category, timeRange, query, page = 1 }) {
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
    const results = await boundedMap(tasks, 6, task => {
        if (Date.now() > deadline) throw new Error('本批抓取超出25秒预算，可刷新重试');
        return task.run();
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
        id: String(aweme.aweme_id), title: aweme.desc || '', description: aweme.desc || '',
        cover: aweme.video.cover?.url_list?.[0] || aweme.video.origin_cover?.url_list?.[0] || '',
        author: aweme.author.nickname || '', authorAvatar: aweme.author.avatar_thumb?.url_list?.[0] || '',
        duration: Math.floor((aweme.video.duration || aweme.duration || 0) / 1000) + '秒',
        pubdate: aweme.create_time || 0, url: 'https://www.douyin.com/video/' + aweme.aweme_id,
        platform: 'douyin', playRaw: null, likeRaw: stats.digg_count ?? null,
        metric: 'likes', metricLabel: '点赞', metricRaw: stats.digg_count ?? null,
        commentCount: stats.comment_count ?? null, source: 'douyin:aweme', fetchedAt: Date.now()
    };
}

function collectAwemes(data, out = [], seen = new Set()) {
    if (!data || typeof data !== 'object' || seen.has(data)) return out;
    seen.add(data);
    if (data.aweme_id && data.video && data.author) { out.push(data); return out; }
    for (const value of Object.values(data)) if (value && typeof value === 'object') collectAwemes(value, out, seen);
    return out;
}

async function douyinVideos({ category, timeRange, query }) {
    let awemes = [];
    if (process.env.DOUYIN_COOKIE) {
        const term = [query, category !== 'all' || !query ? (CATEGORY_QUERIES[category] || ['热门'])[0] : ''].filter(Boolean).join(' ');
        const target = !query && category === 'all' ? 'https://www.douyin.com/discover' : 'https://www.douyin.com/search/' + encodeURIComponent(term) + '?type=video';
        awemes = await withPage('douyin', async page => {
            const found = [];
            const captures = [];
            page.on('response', response => {
                const url = response.url();
                const isSearch = /\/aweme\/v1\/web\/(?:search\/item|general\/search\/single)\//.test(url);
                const isDiscover = !query && category === 'all' && /\/aweme\/v1\/web\/(?:tab\/feed|hot\/video\/list)\//.test(url);
                if (!isSearch && !isDiscover) return;
                captures.push(response.json().then(data => collectAwemes(data, found)).catch(() => {}));
            });
            await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 18000 });
            for (let i = 0; i < 5; i++) {
                await new Promise(resolve => setTimeout(resolve, 700));
                await page.evaluate(() => window.scrollBy(0, 900));
                if (found.length >= 80) break;
            }
            const embedded = await page.evaluate(() => {
                const results = [];
                for (const selector of ['#RENDER_DATA', '#__NEXT_DATA__']) {
                    const content = document.querySelector(selector)?.textContent;
                    if (content) { try { results.push(JSON.parse(decodeURIComponent(content))); } catch {} }
                }
                // 仅收集搜索页的数据作用域，不能递归读整页推荐/侧栏视频。
                if (window._ROUTER_DATA?.loaderData) results.push(window._ROUTER_DATA.loaderData);
                return results;
            });
            embedded.forEach(data => {
                const scoped = data.search_data || data.searchData || data.video_search;
                if (scoped) collectAwemes(scoped, found);
            });
            await Promise.allSettled(captures);
            return found;
        });
    }
    if (!awemes.length) {
        // 当匿名视频搜索受平台登录态限制时，无缝回退使用抖音官方50条实时热搜作品，保障用户有真实内容可看
        const topics = await douyinTopics();
        const terms = {
            comedy: ['搞笑', '幽默', '段子', '喜剧'],
            ent: ['明星', '电影', '电视剧', '综艺', '音乐', '演唱会', '娱乐'],
            fashion: ['穿搭', '美妆', '时尚', '变装'],
            pets: ['猫', '狗', '宠物', '萌宠'],
            wildlife: ['动物', '野生', '自然'],
            tech: ['科技', '数码', '手机', 'AI', '芯片', '苹果', '华为', '新能源'],
            marketing: ['商业', '营销', '经济', '股市', '首富', '理财'],
            kuso: ['神曲', '热梗', '魔性', '鬼畜']
        };
        const filterTerms = terms[category];
        const matched = filterTerms ? topics.filter(t => filterTerms.some(term => t.title.toLowerCase().includes(term.toLowerCase()))) : topics;
        const selected = (matched.length ? matched : topics);
        const fallbackCards = selected.map((t, idx) => ({
            id: 'douyin_' + (t.sentenceId || t.groupId || (idx + 1)),
            title: t.title,
            description: t.desc || '抖音官方实时热搜榜作品',
            cover: t.cover || '',
            author: '抖音热搜榜 · 排名 #' + t.rank,
            duration: '热点',
            pubdate: t.eventTime || Math.floor(Date.now() / 1000),
            url: t.url || ('https://www.douyin.com/search/' + encodeURIComponent(t.title)),
            platform: 'douyin',
            normPlatform: 'douyin',
            playRaw: null,
            likeRaw: t.heatRaw,
            metric: 'heat',
            metricLabel: '热度',
            metricRaw: t.heatRaw,
            metricDisplay: t.heatDisplay || '未公开',
            source: 'douyin:official-hot-search',
            fetchedAt: t.fetchedAt || Date.now()
        }));
        const list = prepareVideoList(fallbackCards, { timeRange, limit: 50 });
        return {
            list,
            hasMore: false,
            scope: { kind: 'hot-search-cards', label: '抖音官方实时热搜榜 · 官方热度降序', exhaustive: false, metric: 'heat' },
            coverage: { candidates: topics.length, unique: list.length },
            source: 'douyin:official-hot-search',
            message: '已呈现抖音官方实时热搜榜真实作品（官方热度与封面）；由于抖音全网隐藏播放量（仅创作者可见），当前按官方热度排序。配置 DOUYIN_COOKIE 可解锁精准作品搜索。'
        };
    }
    const list = prepareVideoList(awemes.map(douyinVideo).filter(Boolean), { timeRange, limit: 2000 });
    return { list, hasMore: false, scope: { kind: !query && category === 'all' ? 'discover-sample' : 'search-sample', label: '真实作品样本 · 点赞排序', exhaustive: false, metric: 'likes' },
        coverage: { candidates: awemes.length, unique: list.length },
        source: 'douyin:official', message: '抖音' + (!query && category === 'all' ? '发现页' : '搜索') + '真实作品按公开点赞量排序；不是全站播放榜。发布时间筛选只保留可验证记录。' };
}

async function douyinTopics() {
    const url = 'https://www.douyin.com/aweme/v1/web/hot/search/list/';
    let data = (await axios.get(url, { proxy: false, timeout: 8000, headers: { 'User-Agent': UA, Referer: 'https://www.douyin.com/', Cookie: process.env.DOUYIN_COOKIE || '' } })).data;
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
    return observed(platform, 'videos', () => memo('videos:' + JSON.stringify(normalized), async () => {
        if (normalized.platform === 'bilibili') return biliVideos(normalized);
        if (normalized.platform === 'douyin') return douyinVideos(normalized);
        const adapters = require('./platform-rankings');
        if (normalized.platform === 'youtube' && process.env.YOUTUBE_API_KEY) return adapters.youtubeApiVideos(normalized);
        if (normalized.platform === 'youtube' && youtubeWorker) return youtubeWorker(normalized);
        if (normalized.platform === 'twitter') return adapters.xApiVideos(normalized);
        if (adapters.PAGE_SOURCES[normalized.platform]) return adapters.publicPageVideos(normalized, { withPage });
        throw new Error('该平台没有可核验的实时视频源，当前不展示固定素材。');
    }, options.refresh));
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
        color: row.count / max > 0.65 ? '#fb3f6c' : row.count / max > 0.3 ? '#facc15' : '#22d3ee',
        tier: row.count / max > 0.65 ? 'high' : row.count / max > 0.3 ? 'medium' : 'normal' }));
}

async function closeBrowser() { if (browserPromise) { const browser = await browserPromise; await browser.close(); browserPromise = null; } }
module.exports = { UA, withPage, getVideos, getTopics, biliGet, biliSearch, biliSearchPage, biliVideo, boundedMap, douyinVideo, collectAwemes, aggregateGeo, closeBrowser, getSourceStatus };
