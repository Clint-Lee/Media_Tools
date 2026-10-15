'use strict';

// 每个适配器只读取对应平台的真实作品实体，不用话题 ID/推荐流充当搜索结果。
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { prepareVideoList, TIME_RANGE_SECONDS, parseHeat } = require('./video-pipeline');
const TERMS = { all: 'video', comedy: 'comedy', ent: 'entertainment', fashion: 'fashion', pets: 'pets', wildlife: 'wildlife', animal: 'animals', tech: 'technology', marketing: 'business marketing', kuso: 'meme' };
const ZH_TERMS = { all: '热门视频', comedy: '搞笑', ent: '娱乐', fashion: '穿搭', pets: '萌宠', wildlife: '野生动物', animal: '动物', tech: '科技', marketing: '商业营销', kuso: '鬼畜' };

function network() {
    return { proxy: false, timeout: 15000, ...(process.env.MEDIA_PROXY ? { httpsAgent: new HttpsProxyAgent(process.env.MEDIA_PROXY) } : {}) };
}
function walk(data, predicate, out = [], seen = new Set()) {
    if (!data || typeof data !== 'object' || seen.has(data)) return out;
    seen.add(data);
    if (predicate(data)) { out.push(data); return out; }
    for (const value of Object.values(data)) if (value && typeof value === 'object') walk(value, predicate, out, seen);
    return out;
}
function base(platform, id, title, metric, count) {
    return { platform, id: String(id), title, metric, metricRaw: count ?? null, playRaw: metric === 'views' ? count ?? null : null,
        metricLabel: metric === 'views' ? '播放' : '点赞', source: platform + ':official-page', fetchedAt: Date.now() };
}
function tiktokVideo(item) {
    if (!/^\d{15,22}$/.test(String(item.id)) || !item.video || !item.author || !item.stats) return null;
    const author = typeof item.author === 'string' ? item.author : item.author.uniqueId;
    if (!author) return null;
    return { ...base('tiktok', item.id, item.desc || '', 'views', item.statsV2?.playCount == null ? item.stats.playCount : Number(item.statsV2.playCount)),
        author: item.author.nickname || author, cover: item.video.cover || item.video.originCover || '', pubdate: item.createTime || 0,
        duration: item.video.duration ? item.video.duration + '秒' : '', url: 'https://www.tiktok.com/@' + encodeURIComponent(author) + '/video/' + item.id,
        likeRaw: item.stats.diggCount ?? null, commentCount: item.stats.commentCount ?? null };
}
function redVideo(item) {
    const note = item.note_card || item.noteCard;
    const id = item.id || item.note_id;
    if (!id || !note || note.type !== 'video') return null;
    const rawLikes = note.interact_info?.liked_count ?? note.interactInfo?.likedCount;
    return { ...base('xiaohongshu', id, note.display_title || note.title || '', 'likes', rawLikes == null ? null : parseHeat(rawLikes)),
        author: note.user?.nickname || '', cover: note.cover?.url_default || note.cover?.urlDefault || note.cover?.url || '',
        // 不从笔记 ID 编造发布日期；不公开精确日期的记录不能进入时效榜。
        pubdate: note.time || note.publish_time || 0, url: 'https://www.xiaohongshu.com/explore/' + id + (item.xsec_token ? '?xsec_token=' + encodeURIComponent(item.xsec_token) + '&xsec_source=' + encodeURIComponent(item.xsec_source || 'pc_feed') : '') };
}
function kuaishouVideo(item) {
    const photo = item.photo;
    if (!photo?.id || !photo.caption || !(photo.photoUrl || photo.manifest || photo.videoResource)) return null;
    return { ...base('kuaishou', photo.id, photo.caption, 'likes', photo.likeCount == null ? null : parseHeat(photo.likeCount)),
        playRaw: photo.viewCount == null ? null : parseHeat(photo.viewCount),
        author: item.author?.name || item.author?.userName || '', cover: photo.coverUrl || photo.cover?.url || '',
        pubdate: photo.timestamp || photo.createTime || 0, duration: photo.duration ? Math.round(photo.duration / 1000) + '秒' : '',
        url: 'https://www.kuaishou.com/short-video/' + photo.id };
}

const PAGE_SOURCES = {
    tiktok: {
        name: 'TikTok', keyword: TERMS,
        target: term => 'https://www.tiktok.com/search/video?q=' + encodeURIComponent(term),
        accept: url => /^https:\/\/www\.tiktok\.com\/api\/search\/(?:item|general)\/full\//.test(url),
        extract: data => walk(data, item => /^\d{15,22}$/.test(String(item.id)) && item.video && item.author && item.stats).map(tiktokVideo),
        embedded: ['#__UNIVERSAL_DATA_FOR_REHYDRATION__', '#SIGI_STATE']
    },
    xiaohongshu: {
        name: '小红书', keyword: ZH_TERMS,
        target: term => 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(term) + '&type=51',
        accept: url => url.includes('/api/sns/web/v1/search/notes'),
        extract: data => walk(data, item => Boolean(item.note_card || item.noteCard)).map(redVideo), embedded: []
    },
    kuaishou: {
        name: '快手', keyword: ZH_TERMS,
        target: term => 'https://www.kuaishou.com/search/video?searchKey=' + encodeURIComponent(term),
        accept: (url, body) => url.includes('/rest/v/search/feed') || url.includes('/graphql') && /search/i.test(body),
        extract: data => walk(data, item => Boolean(item.photo && item.author)).map(kuaishouVideo), embedded: []
    }
};

async function tiktokPublicVideos(options,{withPage,memo=async(key,worker)=>worker()}) {
    const {lightweightPage,clickCategory,scrollMore}=require('./public-browser');
    const labels={comedy:['喜剧','Comedy'],ent:['表演','Performance'],fashion:['穿搭','Fashion'],pets:['动物','Animals'],wildlife:['动物','Animals'],animal:['动物','Animals'],tech:['科技','Science & Technology'],kuso:['喜剧','Comedy']};
    const discovery=memo('discover:tiktok:'+options.category+':'+options.page,()=>withPage('tiktok',async page=>{
        const found=[],captures=[];let epoch=0,nativeCategory=false,hasMore=false;
        const requestEpochs=new Map();
        page.on('request',request=>requestEpochs.set(request.url?.() || request,epoch));
        page.on('response',response=>{
            if(!new URL(response.url()).pathname.startsWith('/api/explore/item_list/'))return;
            const request=response.request(),current=requestEpochs.get(request.url?.() || request);
            if(current!==epoch)return;
            captures.push(response.json().then(data=>{if(epoch===current){found.push(...(data.itemList || []).map(tiktokVideo).filter(Boolean));hasMore=Boolean(data.hasMore);}}).catch(()=>{}));
        });
        await lightweightPage(page);
        await page.goto('https://www.tiktok.com/explore',{waitUntil:'domcontentloaded',timeout:18000});
        for(let i=0;i<4 && !found.length;i++)await new Promise(resolve=>setTimeout(resolve,500));
        if(options.category!=='all') {
            const previous=found.slice();epoch++;found.length=0;
            nativeCategory=await clickCategory(page,labels[options.category]);
            if(!nativeCategory){found.push(...previous);epoch--;}
        }
        for(let i=0;i<Math.min(20,options.page*10);i++) {
            await scrollMore(page);await new Promise(resolve=>setTimeout(resolve,550));
            if(new Set(found.map(v=>v.id)).size>=Math.max(60,options.page*30))break;
        }
        await Promise.allSettled(captures);
        if(!found.length)throw new Error('TikTok公开发现本次未返回作品');
        return {list:found,nativeCategory,hasMore};
    },{anonymous:true}),options.refresh);
    const {matchesCategory,matchesQuery}=require('./video-categories');
    const [result,creative,tag]=await Promise.all([discovery.catch(error=>({list:[],error:error.message})),options.page===1 && options.category==='all'?require('./public-discovery').tiktokCreativePool({withPage,memo,refresh:options.refresh}).catch(error=>({list:[],error:error.message})): {list:[]},require('./public-discovery').tiktokTagPool(options,{withPage,memo}).catch(error=>({list:[],error:error.message}))]);
    if(!result.list.length && !creative.list.length && !tag.list.length)throw new Error('TikTok公开来源未返回实际视频；'+(result.error || '')+'；'+(creative.error || '')+'；'+(tag.error || ''));
    const candidates=[...result.list.map(v=>({...v,sourceCategory:result.nativeCategory?options.category:undefined})),...creative.list,...tag.list.map(v=>({...v,sourceCategory:options.category}))];
    const list=prepareVideoList(candidates.filter(v=>matchesQuery(v,options.query)
        && (options.category==='all' || v.sourceCategory===options.category && !['kuso','wildlife','marketing'].includes(options.category) || matchesCategory(v,options.category))),{timeRange:options.timeRange,limit:2000});
    return {list,hasMore:options.page<5 && Boolean(result.hasMore || tag.hasMore),source:'tiktok:public-multi-source',
        scope:{kind:'public-discover-sample',label:options.query?'公开发现样本内检索（非全站搜索）':'免登录公开发现作品',metric:'views',exhaustive:false,categoryMethod:result.nativeCategory?'native-channel':'semantic-title'},
        partial:Boolean(result.error || creative.error || tag.error),coverage:{candidates:candidates.length,unique:list.length,sources:[{name:'官网公开发现',count:result.list.length,status:result.error?'failed':'ok',message:result.error || ''},{name:'官方Creative Center累计播放',count:creative.list.length,status:creative.error?'failed':'ok',message:creative.error || ''},{name:'官网主题标签视频',count:tag.list.length,status:tag.error?'failed':'ok',message:tag.error || ''}]},message:'无需注册或扫码：TikTok公开发现、主题标签和官方Creative Center真实视频，统一累计播放降序、严格按发布时间筛选；不是全站历史总榜。'+(options.query?'关键词只在已发现作品中匹配。':'')};
}

async function publicPageVideos(options, { withPage, memo }) {
    if(options.platform==='tiktok')return tiktokPublicVideos(options,{withPage,memo});
    if(['kuaishou','xiaohongshu'].includes(options.platform))return require('./public-discovery').publicFeed(options,{withPage,memo});
    const config = PAGE_SOURCES[options.platform];
    const categoryTerm = config.keyword[options.category] || config.keyword.all;
    const term = [options.query, options.category !== 'all' || !options.query ? categoryTerm : ''].filter(Boolean).join(' ');
    const videos = await withPage(options.platform, async page => {
        const found = [], captures = []; let restricted=false;
        page.on('response', response => {
            if (!config.accept(response.url(), response.request().postData() || '')) return;
            captures.push(response.json().then(data => {if(data.data?.result===400002 || data.result===400002)restricted=true;found.push(...config.extract(data).filter(Boolean));}).catch(() => {}));
        });
        await page.goto(config.target(term), { waitUntil: 'domcontentloaded', timeout: 18000 });
        for (let i = 0; i < Math.min(20, options.page * 5); i++) {
            if(restricted)break;
            await new Promise(resolve => setTimeout(resolve, 600));
            await page.evaluate(() => window.scrollBy(0, 900));
        }
        const embedded = await page.evaluate(selectors => selectors.flatMap(selector => {
            const text = document.querySelector(selector)?.textContent;
            if (!text) return [];
            try { return [JSON.parse(text)]; } catch { return []; }
        }), config.embedded);
        // TikTok 的搜索作用域数据才可作为候选，排除其它页面注水推荐。
        for (const data of embedded) {
            const search = data.__DEFAULT_SCOPE__?.['webapp.search'] || data.SearchPage;
            if (search) found.push(...config.extract(search).filter(Boolean));
        }
        await Promise.allSettled(captures);
        return found;
    },{anonymous:true});
    if (!videos.length) throw new Error(config.name + '本次公开匿名访问未返回实际视频，平台可能限制公开搜索或要求验证。不会要求临时设备用户扫码，不会用固定素材或话题伪装成功。');
    const list = prepareVideoList(videos, { timeRange: options.timeRange, limit: 2000 });
    return { list, source: options.platform + ':official-search', hasMore: false,
        scope: { kind: 'search-sample', label: '真实搜索作品 · 未公开播放不入榜', exhaustive: false, metric: 'views' },
        coverage: { candidates: videos.length, unique: list.length },
        message: config.name + '真实搜索作品：已公开播放量降序，未公开播放量的作品置后且不参与排名；点赞仅作辅助。不是全站历史榜，未知发布日期不进入时效筛选。' };
}

function isoDuration(text) {
    const m = String(text || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return '';
    const seconds = Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
function youtubeVideo(item) {
    const s = item.snippet || {}, stats = item.statistics || {};
    return { ...base('youtube', item.id, s.title || '', 'views', stats.viewCount == null ? null : Number(stats.viewCount)),
        source: 'youtube:data-api', description: s.description || '', author: s.channelTitle || '',
        cover: s.thumbnails?.high?.url || s.thumbnails?.medium?.url || '', pubdate: s.publishedAt || 0,
        duration: isoDuration(item.contentDetails?.duration), commentCount: stats.commentCount == null ? null : Number(stats.commentCount),
        url: 'https://www.youtube.com/watch?v=' + item.id };
}
async function youtubeApiVideos(options) {
    const key = process.env.YOUTUBE_API_KEY;
    const request = async (endpoint, params) => (await axios.get('https://www.googleapis.com/youtube/v3/' + endpoint, { ...network(), params: { key, ...params } })).data;
    const categoryIds = { comedy: '23', ent: '24', tech: '28', pets: '15', wildlife: '15', animal: '15', kuso: '23' };
    const params = { part: 'snippet', type: 'video', order: 'viewCount', maxResults: 50 };
    if (options.query) params.q = options.query;
    if (categoryIds[options.category]) params.videoCategoryId = categoryIds[options.category];
    else if (options.category !== 'all') params.q = [params.q, TERMS[options.category]].filter(Boolean).join(' ');
    if (['pets', 'wildlife', 'kuso'].includes(options.category)) params.q = [params.q, TERMS[options.category]].filter(Boolean).join(' ');
    if (TIME_RANGE_SECONDS[options.timeRange]) params.publishedAfter = new Date(Date.now() - TIME_RANGE_SECONDS[options.timeRange] * 1000).toISOString();
    if (options.cursor) params.pageToken = options.cursor;
    const search = await request('search', params);
    const ids = (search.items || []).map(item => item.id?.videoId).filter(Boolean);
    const details = ids.length ? await request('videos', { part: 'snippet,statistics,contentDetails', id: ids.join(',') }) : { items: [] };
    const list = prepareVideoList(details.items.map(youtubeVideo), { timeRange: options.timeRange, limit: 2000 });
    return { list, source: 'youtube:data-api', hasMore: Boolean(search.nextPageToken), nextCursor: search.nextPageToken || '',
        scope: { kind: 'official-search', label: '官方搜索 · 播放量排序', exhaustive: false, metric: 'views' },
        coverage: { candidates: ids.length, unique: list.length },
        message: 'YouTube Data API 按播放量检索，详情接口核验播放、封面和精确发布时间。搜索结果不保证覆盖全站。' };
}

function xVideos(data) {
    const media = new Map((data.includes?.media || []).map(item => [item.media_key, item]));
    const users = new Map((data.includes?.users || []).map(item => [item.id, item]));
    return (data.data || []).flatMap(tweet => (tweet.attachments?.media_keys || []).map(key => {
        const item = media.get(key), user = users.get(tweet.author_id);
        if (!item || !['video', 'animated_gif'].includes(item.type)) return null;
        return { ...base('twitter', tweet.id + ':' + key, tweet.text, 'likes', tweet.public_metrics?.like_count), source: 'twitter:data-api',
            author: user?.name || user?.username || '', cover: item.preview_image_url || '', pubdate: tweet.created_at || 0,
            url: 'https://x.com/' + (user?.username || 'i') + '/status/' + tweet.id, postId: tweet.id,
            // 帖子曝光量不是视频播放量；视频 view_count 缺失时保持未公开。
            playRaw: item.public_metrics?.view_count ?? null, duration: item.duration_ms ? Math.round(item.duration_ms / 1000) + '秒' : '' };
    }).filter(Boolean));
}
async function xApiVideos(options) {
    if (!process.env.X_BEARER_TOKEN) throw new Error('X 视频搜索需要 X_BEARER_TOKEN 和对应官方 API 权限；未用其它平台数据替代。');
    const archive = process.env.X_SEARCH_ARCHIVE === '1';
    if (!archive && !['3days', '7days'].includes(options.timeRange)) throw new Error('X 当前只有近7天检索权限。请选3天/7天；历史检索需配置 X_SEARCH_ARCHIVE=1 及官方权限。');
    const term = [options.query || (options.category === 'all' ? 'video' : ''), options.category !== 'all' ? TERMS[options.category] : ''].filter(Boolean).join(' ');
    const params = { query: [term, 'has:videos -is:retweet'].filter(Boolean).join(' '), max_results: 100,
        expansions: 'attachments.media_keys,author_id', 'tweet.fields': 'created_at,public_metrics,attachments',
        'media.fields': 'type,preview_image_url,duration_ms,public_metrics', 'user.fields': 'name,username' };
    if (TIME_RANGE_SECONDS[options.timeRange] && (archive || options.timeRange !== '7days')) params.start_time = new Date(Date.now() - TIME_RANGE_SECONDS[options.timeRange] * 1000).toISOString();
    if (options.cursor) params.next_token = options.cursor;
    const data = (await axios.get('https://api.x.com/2/tweets/search/' + (archive ? 'all' : 'recent'), { ...network(), params, headers: { Authorization: 'Bearer ' + process.env.X_BEARER_TOKEN } })).data;
    if (data.errors?.length && !data.data) throw new Error('X 官方接口未返回作品，请检查 API 权限与额度。');
    const list = prepareVideoList(xVideos(data), { timeRange: options.timeRange, limit: 2000 });
    return { list, source: 'twitter:data-api', hasMore: Boolean(data.meta?.next_token), nextCursor: data.meta?.next_token || '',
        scope: { kind: 'official-search-sample', label: '视频帖子 · 实际视频播放排序', exhaustive: false, metric: 'views' },
        coverage: { candidates: data.data?.length || 0, unique: list.length },
        message: 'X 实际视频播放量降序，缺失播放的作品置后且不入榜；点赞和帖子曝光不冒充视频播放。仅在已检索作品内排序。' };
}

function capabilities() {
    return [
        { platform: 'bilibili', videos: 'public', topics: 'public', metric: 'views', label: '官方搜索与榜单', exhaustive: false },
        { platform: 'douyin', videos: 'public-discover', topics: 'public', metric: 'views', label: '免登录公开精选；播放未公开不入榜', requiresUserLogin:false, exhaustive: false },
        { platform: 'youtube', videos: process.env.YOUTUBE_API_KEY ? 'official-api' : 'public-page', topics: 'unavailable', metric: 'views', label: process.env.YOUTUBE_API_KEY ? '官方 Data API' : '公开搜索 / 精确数据需 API Key', configured: Boolean(process.env.YOUTUBE_API_KEY), exhaustive: false },
        { platform:'tiktok',videos:'public-discover',topics:'unavailable',metric:'views',label:'免登录公开发现 · 实际播放量',requiresUserLogin:false,exhaustive:false },
        { platform:'xiaohongshu',videos:'public-discover',topics:'unavailable',metric:'views',label:'免登录公开推荐 · 播放未公开不入榜',requiresUserLogin:false,exhaustive:false },
        { platform:'kuaishou',videos:'public-discover',topics:'unavailable',metric:'views',label:'官网精彩短视频 · 实际播放量',requiresUserLogin:false,exhaustive:false },
        { platform: 'twitter', videos: process.env.X_BEARER_TOKEN ? 'official-api' : 'public-account-samples', topics: 'unavailable', metric: 'views', label: process.env.X_BEARER_TOKEN ? '官方 API 视频帖子' : '免登录公开账号样本 · 第三方转述', requiresUserLogin:false,configured: Boolean(process.env.X_BEARER_TOKEN), exhaustive: false }
    ];
}

module.exports = { publicPageVideos, youtubeApiVideos, xApiVideos, capabilities, tiktokVideo, redVideo, kuaishouVideo, youtubeVideo, xVideos, walk, PAGE_SOURCES };
