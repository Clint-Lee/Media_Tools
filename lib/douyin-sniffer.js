'use strict';

const { withPage, collectAwemes } = require('./live-sources');

async function sniffDouyinVideo(itemId) {
    if (!/^\d{15,22}$/.test(String(itemId))) throw new Error('无效的抖音作品编号');
    const aweme = await withPage('douyin', async page => {
        let selected;
        const captures = [];
        const inspect = data => {
            const match = collectAwemes(data).find(video => String(video.aweme_id) === String(itemId));
            if (match) selected = match;
        };
        page.on('response', response => {
            if (!response.url().includes('/aweme/')) return;
            captures.push(response.json().then(inspect).catch(() => {}));
        });
        await page.goto('https://www.douyin.com/video/' + itemId, { waitUntil: 'domcontentloaded', timeout: 18000 });
        for (let i = 0; i < 8 && !selected; i++) await new Promise(r => setTimeout(r, 600));
        const embedded = await page.evaluate(() => {
            const result = [];
            for (const selector of ['#RENDER_DATA', '#__NEXT_DATA__']) {
                const value = document.querySelector(selector)?.textContent;
                if (value) { try { result.push(JSON.parse(decodeURIComponent(value))); } catch {} }
            }
            if (window._ROUTER_DATA) result.push(window._ROUTER_DATA);
            return result;
        });
        embedded.forEach(inspect);
        await Promise.allSettled(captures);
        return selected;
    });
    if (!aweme) throw new Error('抖音没有返回与链接编号一致的作品数据，当前可能需要登录或验证码；不会使用推荐视频替代。');
    const images = (aweme.images || []).map((image, index) => ({ index:index+1, url:image.url_list?.[0] || image.download_url_list?.[0] })).filter(image=>image.url);
    return {
        title: aweme.desc || '', author: aweme.author?.nickname || '', avatar: aweme.author?.avatar_thumb?.url_list?.[0] || '',
        cover: aweme.video?.cover?.url_list?.[0] || images[0]?.url || '', duration: Math.round((aweme.video?.duration || 0)/1000),
        noteType:images.length ? 'image':'video', images:images.length?images:undefined,
        videoUrl:aweme.video?.play_addr?.url_list?.[0] || aweme.video?.play_addr_h264?.url_list?.[0],
        audioUrl:aweme.music?.play_url?.url_list?.[0]
    };
}
module.exports = { sniffDouyinVideo };
