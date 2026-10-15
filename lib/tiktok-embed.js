'use strict';

const { identity } = require('./media-identity');

// 官方公开嵌入页的当前作品，不能把页面里其它推荐作品当成输入视频。
function metadataFromEmbed(state, targetUrl) {
    const id = identity(targetUrl);
    if (!/^\d{15,22}$/.test(id || '')) throw new Error('未识别到 TikTok 作品编号');
    const entry = state?.source?.data?.['/embed/v2/' + id];
    const data = entry?.videoData, item = data?.itemInfos;
    if (entry?.isError || !item || String(item.id) !== id) throw new Error('TikTok公开嵌入页未返回对应作品');
    const url = item.video?.urls?.find(value => {
        try {
            const parsed = new URL(value);
            return parsed.protocol === 'https:' && ['tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com'].some(domain => parsed.hostname === domain || parsed.hostname.endsWith('.' + domain));
        } catch { return false; }
    });
    if (!url) throw new Error('TikTok公开嵌入页未提供可用的媒体地址');
    const author = data.authorInfos || {};
    return {
        id, title: item.text || 'TikTok 视频', description: item.text || '',
        thumbnail: item.coversOrigin?.[0] || item.covers?.[0] || null,
        uploader: author.nickName || author.uniqueId || '', duration: Number(item.video.videoMeta?.duration) || 0,
        webpage_url: author.uniqueId ? 'https://www.tiktok.com/@' + encodeURIComponent(author.uniqueId) + '/video/' + id : targetUrl,
        url, http_headers: { Referer: 'https://www.tiktok.com/' },
        // 编码与有声状态在实际处理时探测，不凭页面字段声称 H.264 或有声。
        vcodec: 'unknown', acodec: 'unknown', ext: 'mp4', format_id: 'public-embed'
    };
}

async function extractTikTokEmbed(targetUrl) {
    let id = identity(targetUrl);
    return require('./live-sources').withPage('tiktok', async page => {
        await require('./public-browser').lightweightPage(page, { navigationDomain: 'tiktok.com' });
        // 官方分享短链必须先跟随实际页面跳转，再核验最终作品；不凭推荐数据猜ID。
        if (!id) {
            require('./safe-network').platformUrl(targetUrl);
            const host = new URL(targetUrl).hostname;
            if (host !== 'tiktok.com' && !host.endsWith('.tiktok.com')) throw new Error('不是TikTok原站链接');
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
            const resolved = require('./safe-network').platformUrl(page.url());
            if (resolved.hostname !== 'tiktok.com' && !resolved.hostname.endsWith('.tiktok.com')) throw new Error('TikTok分享链接跳转到其它平台');
            targetUrl = resolved.href; id = identity(targetUrl);
        }
        if (!/^\d{15,22}$/.test(id || '')) throw new Error('未识别到 TikTok 作品编号');
        await page.goto('https://www.tiktok.com/embed/v2/' + id, { waitUntil: 'domcontentloaded', timeout: 18000 });
        const state = await page.evaluate(() => {
            try { return JSON.parse(document.querySelector('#__FRONTITY_CONNECT_STATE__')?.textContent || 'null'); }
            catch { return null; }
        });
        const info = metadataFromEmbed(state, targetUrl);
        info.http_headers['User-Agent'] = await page.evaluate(() => navigator.userAgent);
        return info;
    }, { anonymous: true });
}

module.exports = { metadataFromEmbed, extractTikTokEmbed };
