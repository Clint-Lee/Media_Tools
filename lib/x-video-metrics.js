'use strict';

const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
// Public anonymous web-client identifier shipped in X's web app, not a user credential.
const PUBLIC_CLIENT = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

function metricFromConfig(data, video) {
    const track = data?.track;
    if (!video.mediaId || String(track?.contentId) !== video.mediaId) return null;
    if (track.expandedUrl) {
        let url;
        try { url = new URL(track.expandedUrl); } catch { return null; }
        if (!['x.com', 'twitter.com', 'www.twitter.com', 'www.x.com'].includes(url.hostname)
            || url.pathname.match(/\/status\/(\d+)/)?.[1] !== video.postId) return null;
    }
    const text = String(track.viewCount ?? '').trim();
    const rounded = text.match(/^(\d+(?:\.\d+)?)\s*([KMB])$/i);
    if (!rounded && !/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return null;
    const count = rounded ? Math.round(Number(rounded[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[rounded[2].toUpperCase()])) : Number(text.replace(/,/g, ''));
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function createClient({ http = axios, now = Date.now } = {}) {
    let guest, guestUntil = 0, pending;
    const cache = new Map();
    function options() {
        return { proxy: false, timeout: 7000, maxRedirects: 0, maxContentLength: 1024 * 1024,
            ...(process.env.MEDIA_PROXY ? { httpsAgent: new HttpsProxyAgent(process.env.MEDIA_PROXY) } : {}) };
    }
    async function guestToken() {
        if (guest && guestUntil > now()) return guest;
        if (pending) return pending;
        pending = http.post('https://api.twitter.com/1.1/guest/activate.json', null,
            { ...options(), headers: { Authorization: 'Bearer ' + PUBLIC_CLIENT } }).then(response => {
            if (typeof response.data?.guest_token !== 'string' || !response.data.guest_token) throw new Error('匿名访客配置不可用');
            guest = response.data.guest_token; guestUntil = now() + 20 * 60000; return guest;
        }).finally(() => { pending = null; });
        return pending;
    }
    async function get(video) {
        const key = video.postId + ':' + video.mediaId;
        const saved = cache.get(key);
        if (saved && now() - saved.at < (saved.value===null?30000:120000)) return saved.value;
        if (!/^\d+$/.test(video.postId || '') || !/^\d+$/.test(video.mediaId || '')) return null;
        const token = await guestToken();
        let response;
        try {
            response = await http.get('https://api.twitter.com/1.1/videos/tweet/config/' + video.postId + '.json',
                { ...options(), headers: { Authorization: 'Bearer ' + PUBLIC_CLIENT, 'x-guest-token': token } });
        } catch (error) {
            if ([401, 403].includes(error.response?.status)) { guest = null; guestUntil = 0; }
            throw new Error('X官方匿名视频统计暂不可用');
        }
        const count = metricFromConfig(response.data, video);
        const display = String(response.data.track?.viewCount ?? '').trim();
        const value = count === null ? null : { count, display, precision: /[KMB]$/i.test(display) ? 'source-rounded' : 'integer', fetchedAt: now(), source: 'twitter:official-anonymous-video-config' };
        if (cache.size >= 2000) cache.delete(cache.keys().next().value);
        cache.set(key, { at: now(), value });
        return value;
    }
    async function enrich(list, boundedMap) {
        const deadline = now() + 20000;
        const results = await boundedMap(list, 6, async video => {
            if (video.playRaw != null) return video;
            if (now() > deadline) return video;
            const metric = await get(video);
            return metric ? { ...video, playRaw: metric.count, playCount: undefined, metricRaw: metric.count,
                viewSource: metric.source, viewsFetchedAt: metric.fetchedAt, viewCountText: metric.display, viewPrecision: metric.precision } : video;
        });
        const enriched=results.map((row,i)=>row.value || list[i]);
        // A successful HTTP response can still explicitly withhold viewCount.
        // Missing values and deadline skips are incomplete metrics, not a fully healthy source.
        return { list:enriched,failed:enriched.filter(video=>video.playRaw==null).length,errors:results.filter(row=>row.error).length };
    }
    return { enrich };
}

module.exports = { ...createClient(), createClient, metricFromConfig };
