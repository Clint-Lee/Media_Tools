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
    return { ...base('tiktok', item.id, item.desc || '', 'views', item.stats.playCount),
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
        pubdate: note.time || note.publish_time || 0, url: 'https://www.xiaohongshu.com/explore/' + id + (item.xsec_token ? '?xsec_token=' + encodeURIComponent(item.xsec_token) + '&xsec_source=pc_search' : '') };
}
function kuaishouVideo(item) {
    const photo = item.photo;
    if (!photo?.id || !photo.caption || !(photo.photoUrl || photo.manifest || photo.videoResource)) return null;
    return { ...base('kuaishou', photo.id, photo.caption, 'likes', photo.likeCount == null ? null : parseHeat(photo.likeCount)),
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

async function publicPageVideos(options, { withPage }) {
    const config = PAGE_SOURCES[options.platform];
    const categoryTerm = config.keyword[options.category] || config.keyword.all;
    const term = [options.query, options.category !== 'all' || !options.query ? categoryTerm : ''].filter(Boolean).join(' ');
    const videos = await withPage(options.platform, async page => {
        const found = [], captures = [];
        page.on('response', response => {
            if (!config.accept(response.url(), response.request().postData() || '')) return;
            captures.push(response.json().then(data => found.push(...config.extract(data).filter(Boolean))).catch(() => {}));
        });
        await page.goto(config.target(term), { waitUntil: 'domcontentloaded', timeout: 18000 });
        for (let i = 0; i < Math.min(20, options.page * 5); i++) {
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
    });
    if (!videos.length) throw new Error(config.name + '没有返回可核验的视频搜索实体。可能需要合法登录态、地区访问或验证码；未使用固定素材替代。');
    const list = prepareVideoList(videos, { timeRange: options.timeRange, limit: 2000 });
    return { list, source: options.platform + ':official-search', hasMore: false,
        scope: { kind: 'search-sample', label: '平台搜索样本', exhaustive: false, metric: options.platform === 'tiktok' ? 'views' : 'likes' },
        coverage: { candidates: videos.length, unique: list.length },
        message: config.name + '真实搜索作品，按' + (options.platform === 'tiktok' ? '公开播放量' : '公开点赞量（不是播放量）') + '降序；不是全站历史榜。未知发布日期的作品不进入时效筛选。' };
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
        scope: { kind: 'official-search-sample', label: '视频帖子检索样本 · 点赞排序', exhaustive: false, metric: 'likes' },
        coverage: { candidates: data.data?.length || 0, unique: list.length },
        message: 'X 官方检索中的视频帖子按点赞排序；帖子曝光不作为视频播放。仅在已检索样本内排序，不是全站播放榜。' };
}

function capabilities() {
    return [
        { platform: 'bilibili', videos: 'public', topics: 'public', metric: 'views', label: '官方搜索与榜单', exhaustive: false },
        { platform: 'douyin', videos: 'session-dependent', topics: 'public', metric: 'likes', label: '官方热搜 / 登录态视频搜索', configured: Boolean(process.env.DOUYIN_COOKIE), exhaustive: false },
        { platform: 'youtube', videos: process.env.YOUTUBE_API_KEY ? 'official-api' : 'public-page', topics: 'unavailable', metric: 'views', label: process.env.YOUTUBE_API_KEY ? '官方 Data API' : '公开搜索 / 精确数据需 API Key', configured: Boolean(process.env.YOUTUBE_API_KEY), exhaustive: false },
        ...['tiktok', 'xiaohongshu', 'kuaishou'].map(platform => ({ platform, videos: 'session-dependent', topics: 'unavailable', metric: platform === 'tiktok' ? 'views' : 'likes', label: '真实搜索 / 登录与地区限制', configured: Boolean(process.env[platform.toUpperCase() + '_COOKIE']), exhaustive: false })),
        { platform: 'twitter', videos: process.env.X_BEARER_TOKEN ? 'official-api' : 'credentials-required', topics: 'unavailable', metric: 'likes', label: process.env.X_BEARER_TOKEN ? '官方 API 视频帖子' : '需配置官方 API 权限', configured: Boolean(process.env.X_BEARER_TOKEN), exhaustive: false }
    ];
}

module.exports = { publicPageVideos, youtubeApiVideos, xApiVideos, capabilities, tiktokVideo, redVideo, kuaishouVideo, youtubeVideo, xVideos, walk, PAGE_SOURCES };
