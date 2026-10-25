'use strict';

const axios = require('axios');
const crypto = require('crypto');
const { prepareVideoList } = require('./video-pipeline');
const { matchesCategory } = require('./video-categories');
const { platformUrl } = require('./safe-network');
const ORIGIN = 'https://open.douyin.com';
const count = value => (typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value))
    && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;

function hotVideo(item, fetchedAt = Date.now()) {
    if (item?.media_type !== 2 || !item.title || item.video_status != null && item.video_status !== 5) return null;
    let url;
    try {
        url = platformUrl(item.share_url);
        if (!['douyin.com', 'iesdouyin.com'].some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) return null;
        if (!/\/(?:share\/)?video\/[^/]+/.test(url.pathname)) return null;
    } catch { return null; }
    const id = item.video_id || item.item_id;
    if (!id || typeof id !== 'string' || id.length > 512) return null;
    return { id, title: item.title, description: item.title, author: item.author || '', cover: item.cover || '',
        platform: 'douyin', url: url.href, pubdate: item.create_time || 0,
        playRaw: count(item.statistics?.play_count), likeRaw: count(item.statistics?.digg_count),
        commentCount: count(item.statistics?.comment_count), source: 'douyin:open-hotsearch-videos', fetchedAt };
}

function createClient({ http = axios, env = process.env, now = Date.now } = {}) {
    let token, tokenUntil = 0, fingerprint = '', pending;
    const configured = () => Boolean(env.DOUYIN_CLIENT_TOKEN || env.DOUYIN_CLIENT_KEY && env.DOUYIN_CLIENT_SECRET);
    async function request(method, endpoint, config) {
        let response;
        try { response = await http[method](ORIGIN + endpoint, ...config); }
        catch { throw new Error('抖音开放接口请求失败，请检查服务端网络/权限；未输出凭证。'); }
        const data = response.data?.data;
        if (!data || data.error_code !== 0) throw new Error('抖音开放接口拒绝请求（错误码 ' + (Number(data?.error_code) || '未知') + '），请检查 hotsearch 应用权限与凭证。');
        return data;
    }
    async function clientToken() {
        if (env.DOUYIN_CLIENT_TOKEN) return env.DOUYIN_CLIENT_TOKEN;
        if (!configured()) throw new Error('抖音真实播放量的官方热点视频接口需要运营者配置应用凭证及 hotsearch 权限；最终用户无需登录。');
        const key = crypto.createHash('sha256').update(env.DOUYIN_CLIENT_KEY + ':' + env.DOUYIN_CLIENT_SECRET).digest('hex');
        if (token && tokenUntil > now() && fingerprint === key) return token;
        if (pending && fingerprint === key) return pending;
        fingerprint = key;
        pending = request('post', '/oauth/client_token/', [{ grant_type: 'client_credential', client_key: env.DOUYIN_CLIENT_KEY, client_secret: env.DOUYIN_CLIENT_SECRET },
            { proxy: false, timeout: 8000, maxRedirects: 0, maxContentLength: 1024 * 1024 }]).then(data => {
            if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('抖音应用凭证返回无效，未假报已配置。');
            token = data.access_token; tokenUntil = now() + Math.max(0, data.expires_in - 60) * 1000; return token;
        }).finally(() => { pending = null; });
        return pending;
    }
    async function get(endpoint, params) {
        return request('get', endpoint, [{ proxy: false, timeout: 8000, maxRedirects: 0, maxContentLength: 5 * 1024 * 1024,
            params, headers: { 'access-token': await clientToken() } }]);
    }
    async function videos(options, { boundedMap }) {
        const page = options.page || 1;
        // 关键词检索没有官方续页参数，第2页起必须明确拒绝，
        // 不能返回空列表伪装成"没有更多结果"，掩盖上游无续页的事实。
        if (options.query && page > 1) throw new Error('抖音开放接口的关键词检索没有可靠的续页参数，仅提供本批样本。');
        const terms = options.query ? [options.query] : (await get('/hotsearch/sentences/')).list?.map(row => row.sentence).filter(Boolean) || [];
        const selected = terms.slice((page - 1) * 6, page * 6);
        const results = await boundedMap(selected, 3, async term => {
            const data = await get('/hotsearch/videos/', { hot_sentence: term });
            return { term, list: (data.list || []).map(item => hotVideo(item, now())).filter(Boolean) };
        });
        const good = results.filter(row => row.value), errors = results.filter(row => row.error);
        if (selected.length && !good.length) throw errors[0].error;
        const candidates = good.flatMap(row => row.value.list);
        const list = prepareVideoList(candidates.filter(v => matchesCategory(v, options.category || 'all')), { timeRange: options.timeRange, limit: 2000 });
        return { list, source: 'douyin:open-hotsearch-videos', hasMore: !options.query && page * 6 < terms.length && page < 10,
            partial: errors.length > 0, scope: { kind: 'official-hot-topic-videos', label: '官方热点关联视频 · 实际播放量', metric: 'views', exhaustive: false, categoryMethod: 'semantic-title' },
            coverage: { candidates: candidates.length, unique: list.length, sources: results.map((row, i) => ({ name: selected[i], status: row.error ? 'failed' : 'ok', count: row.value?.list.length || 0, message: row.error?.message || '' })) },
            message: '抖音官方 hotsearch 视频实体（不是热搜话题卡片），播放量直接来自作品 statistics.play_count。仅热点关联作品，分类为标题匹配，关键词用于官方热点词关联检索；不是全站搜索/历史总榜。无需最终用户登录。' };
    }
    return { configured, videos };
}

module.exports = { ...createClient(), createClient, hotVideo };
