'use strict';

const axios = require('axios');
const { biliGet } = require('./live-sources');

const USER_AGENT_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const USER_AGENT_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

// Global TTWID cache for Douyin web API
let cachedTtwid = '';
let cachedTtwidTime = 0;

// Daily parse statistics memory cache
function statsDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ || 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
const todayStats = {
    date: statsDate(),
    totalCount: 0,
    platforms: {
        douyin: 0,
        bilibili: 0,
        xiaohongshu: 0,
        kuaishou: 0,
        youtube: 0,
        tiktok: 0,
        other: 0
    }
};

function checkAndResetStats() {
    const today = statsDate();
    if (todayStats.date !== today) {
        todayStats.date = today;
        todayStats.totalCount = 0;
        todayStats.platforms = {
            douyin: 0,
            bilibili: 0,
            xiaohongshu: 0,
            kuaishou: 0,
            youtube: 0,
            tiktok: 0,
            other: 0
        };
    }
}

function recordParseSuccess(platform) {
    checkAndResetStats();
    todayStats.totalCount += 1;
    const p = String(platform || 'other').toLowerCase();
    if (todayStats.platforms[p] !== undefined) {
        todayStats.platforms[p] += 1;
    } else {
        todayStats.platforms.other += 1;
    }
}

function getTodayParseStats() {
    checkAndResetStats();
    return {
        success: true,
        date: todayStats.date,
        totalCount: todayStats.totalCount,
        platforms: { ...todayStats.platforms }
    };
}

/**
 * Fetch or refresh Douyin Web TTWID Cookie
 */
async function getDouyinTtwid() {
    if (cachedTtwid && Date.now() - cachedTtwidTime < 6 * 3600 * 1000) {
        return cachedTtwid;
    }

    try {
        const postData = {
            region: 'cn',
            aid: 1768,
            needFid: false,
            service: 'www.ixigua.com',
            migrate_info: { ticket: '', src_union_token: '' },
            cbUrlProtocol: 'https',
            union: true
        };

        const res = await axios.post('https://ttwid.bytedance.com/ttwid/union/register/', postData, {
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT_PC
            },
            timeout: 5000
        });

        const setCookies = res.headers['set-cookie'] || [];
        const ttwidCookie = setCookies.find(c => c.startsWith('ttwid='));
        if (ttwidCookie) {
            cachedTtwid = ttwidCookie.split(';')[0];
            cachedTtwidTime = Date.now();
            return cachedTtwid;
        }
    } catch (e) {
        console.warn('[Downloader Core] Failed to fetch Douyin ttwid:', e.message);
    }

    return 'passport_csrf_token=1';
}

/**
 * Extract clean http/https URL from user text / share commands
 */
function extractUrlFromText(text) {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(/https?:\/\/[^\s"'<>\u4e00-\u9fa5]+/i);
    if (match) return match[0].replace(/[)\]}>,.;，。]+$/, '');
    const biliId = text.match(/\b(BV[0-9a-zA-Z]{10}|av\d+)\b/i);
    return biliId ? 'https://www.bilibili.com/video/' + biliId[0] : null;
}

const { sniffDouyinVideo } = require('./douyin-sniffer');

/**
 * Clean up title from share text commands
 */
function cleanShareTitle(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    let clean = rawText.replace(/https?:\/\/[^\s]+/g, '');
    clean = clean.replace(/复制此链接[^\n\r]*/g, '');
    clean = clean.replace(/打开Dou音[^\n\r]*/g, '');
    clean = clean.replace(/打开快手[^\n\r]*/g, '');
    clean = clean.replace(/打开小红书[^\n\r]*/g, '');
    
    // If text contains Chinese characters or brackets, strip leading English/numeric/punctuation share codes
    const firstChineseIndex = clean.search(/[\u4e00-\u9fa5《【]/);
    if (firstChineseIndex > 0 && firstChineseIndex < 50) {
        clean = clean.substring(firstChineseIndex);
    } else {
        clean = clean.replace(/^[0-9.:apm\s/l@C.uSQxs\-]+/i, '');
    }
    
    clean = clean.replace(/[\r\n\t]+/g, ' ');
    return clean.trim();
}

/**
 * Resolve HTTP 301/302 redirects with custom headers
 */
async function resolveRedirect(url, customHeaders = {}) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': USER_AGENT_MOBILE,
                ...customHeaders
            },
            maxRedirects: 5,
            timeout: 8000,
            validateStatus: status => status >= 200 && status < 400
        });
        return response.request?.res?.responseUrl || response.config?.url || url;
    } catch (e) {
        if (e.response?.headers?.location) {
            return e.response.headers.location;
        }
        return url;
    }
}

/**
 * Construct local proxy download URL
 */
function buildLocalDownloadUrl(rawVideoUrl, filename, referer) {
    const params = new URLSearchParams({
        url: rawVideoUrl
    });
    if (filename) params.set('filename', filename);
    if (referer) params.set('referer', referer);
    return `/api/download?${params.toString()}`;
}

/**
 * Construct local proxy streaming player URL
 */
function buildLocalPlayUrl(rawVideoUrl, referer) {
    const params = new URLSearchParams({
        url: rawVideoUrl
    });
    if (referer) params.set('referer', referer);
    return `/api/play?${params.toString()}`;
}

/**
 * Build anti-hotlinking headers for proxy download and playback
 */
function resolveAntiHotlinkingHeaders(targetUrlStr, customReferer) {
    const headers = {
        'User-Agent': USER_AGENT_PC,
        'Accept': '*/*'
    };
    const urlLower = String(targetUrlStr || '').toLowerCase();
    const refLower = String(customReferer || '').toLowerCase();

    if (urlLower.includes('bilibili.com') || urlLower.includes('bilivideo.com') || urlLower.includes('hdslb.com') || refLower.includes('bilibili.com')) {
        headers['Referer'] = 'https://www.bilibili.com';
        headers['User-Agent'] = USER_AGENT_PC;
    } else if (urlLower.includes('douyinvod.com') || urlLower.includes('video/tos') || urlLower.includes('douyinpic.com') || urlLower.includes('douyinstatic.com')) {
        headers['Referer'] = 'https://www.douyin.com/';
        headers['User-Agent'] = USER_AGENT_PC;
    } else if (urlLower.includes('snssdk.com') || urlLower.includes('iesdouyin.com') || refLower.includes('douyin.com')) {
        delete headers['Referer'];
        headers['User-Agent'] = USER_AGENT_MOBILE;
    } else if (urlLower.includes('xiaohongshu.com') || urlLower.includes('xhscdn.com') || refLower.includes('xiaohongshu.com')) {
        headers['Referer'] = 'https://www.xiaohongshu.com';
        headers['User-Agent'] = USER_AGENT_PC;
    } else if (urlLower.includes('weibo.com') || urlLower.includes('sinaimg.cn') || refLower.includes('weibo.com')) {
        headers['Referer'] = 'https://weibo.com';
        headers['User-Agent'] = USER_AGENT_PC;
    } else if (urlLower.includes('kuaishou') || urlLower.includes('gifshow')) {
        headers['Referer'] = 'https://www.kuaishou.com';
        headers['User-Agent'] = USER_AGENT_MOBILE;
    } else if (customReferer) {
        headers['Referer'] = customReferer;
    }

    return headers;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Douyin / TikTok Parser
// ─────────────────────────────────────────────────────────────────────────────
async function parseDouyin(rawUrl, rawInput) {
    let targetUrl = rawUrl;
    if (targetUrl.includes('v.douyin.com')) {
        targetUrl = await resolveRedirect(targetUrl, { 'User-Agent': USER_AGENT_MOBILE });
    }

    let itemId = null;
    const videoMatch = targetUrl.match(/\/video\/(\d+)/i);
    const modalMatch = targetUrl.match(/modal_id=(\d+)/i);
    const noteMatch = targetUrl.match(/\/note\/(\d+)/i);

    if (videoMatch) itemId = videoMatch[1];
    else if (modalMatch) itemId = modalMatch[1];
    else if (noteMatch) itemId = noteMatch[1];

    if (!itemId) {
        const idFallback = targetUrl.match(/(\d{15,22})/);
        if (idFallback) itemId = idFallback[1];
    }

    let title = cleanShareTitle(rawInput || '') || '抖音短视频';
    let desc = '';
    let cover = null;
    let videoUrl = null;
    let originVideoUrl = null;
    let audioUrl = null;
    let duration = 0;
    let author = '抖音创作者';
    let avatar = null;
    let noteType = 'video';
    let images = [];

    // Stage 1: Try Douyin Web Detail API
    if (itemId) {
        try {
            const ttwid = await getDouyinTtwid();
            const detailApi = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${itemId}&device_platform=webapp&aid=6383`;

            const detailRes = await axios.get(detailApi, {
                headers: {
                    'User-Agent': USER_AGENT_PC,
                    'Cookie': require('./platform-session').cookieHeader('douyin') || ttwid,
                    'Referer': 'https://www.douyin.com/'
                },
                timeout: 5000
            });

            const aweme = detailRes.data?.aweme_detail;
            if (aweme && String(aweme.aweme_id) === String(itemId)) {
                if (aweme.desc) title = aweme.desc;
                desc = aweme.desc || '';
                cover = aweme.video?.cover?.url_list?.[0] || aweme.video?.dynamic_cover?.url_list?.[0] || null;
                duration = Math.round((aweme.video?.duration || 0) / 1000);
                author = aweme.author?.nickname || '抖音创作者';
                avatar = aweme.author?.avatar_thumb?.url_list?.[0] || null;

                if (aweme.music?.play_url?.url_list?.[0]) {
                    audioUrl = aweme.music.play_url.url_list[0];
                }

                if (Array.isArray(aweme.images) && aweme.images.length > 0) {
                    noteType = 'image';
                    aweme.images.forEach((img, idx) => {
                        const imgUrl = img.url_list?.[0] || img.download_url_list?.[0];
                        if (imgUrl) {
                            images.push({
                                index: idx + 1,
                                url: imgUrl,
                                downloadUrl: `/api/proxy-image?url=${encodeURIComponent(imgUrl)}`
                            });
                        }
                    });
                    if (!cover && images[0]) cover = images[0].url;
                } else {
                    noteType = 'video';
                    const playAddr = aweme.video?.play_addr?.url_list?.[0] ||
                                     aweme.video?.play_addr_h264?.url_list?.[0] ||
                                     aweme.video?.bit_rate?.[0]?.play_addr?.url_list?.[0];
                    if (playAddr) {
                        videoUrl = playAddr;
                        originVideoUrl = videoUrl;
                    }
                }
            }
        } catch (e) {
            console.warn('[Downloader Core] Douyin HTTP detail API warning:', e.message);
        }
    }

    // Stage 2: If videoUrl or metadata was not resolved by HTTP API, activate Puppeteer Sniffer
    if ((!videoUrl && noteType !== 'image') || !cover) {
        if (itemId) {
            try {
                console.log(`[Downloader Core] Launching Puppeteer Sniffer for Douyin ID: ${itemId}...`);
                const sniffed = await sniffDouyinVideo(itemId, rawInput);
                if (sniffed) {
                    if (sniffed.title) title = sniffed.title;
                    if (sniffed.author) author = sniffed.author;
                    if (sniffed.avatar) avatar = sniffed.avatar;
                    if (sniffed.cover) cover = sniffed.cover;
                    if (sniffed.duration) duration = sniffed.duration;
                    if (sniffed.noteType) noteType = sniffed.noteType;
                    if (sniffed.images) images = sniffed.images;
                    if (sniffed.videoUrl) {
                        videoUrl = sniffed.videoUrl;
                        originVideoUrl = videoUrl;
                    }
                    if (sniffed.audioUrl) audioUrl = sniffed.audioUrl;
                }
            } catch (sniffErr) {
                console.error('[Downloader Core] Puppeteer Douyin Sniffer failed:', sniffErr.message);
            }
        }
    }

    if (!videoUrl && noteType !== 'image') {
        throw new Error('匿名访问未取得与该抖音链接一致的视频流；作品可能被验证墙、地区或删除/私密限制，当前未能处理。无需在临时设备扫码，未用其它作品替代。');
    }

    const downloadVideoUrl = videoUrl ? buildLocalDownloadUrl(videoUrl, title, 'https://www.douyin.com/') : null;
    const playVideoUrl = videoUrl ? buildLocalPlayUrl(videoUrl, 'https://www.douyin.com/') : null;
    const downloadAudioUrl = audioUrl ? buildLocalDownloadUrl(audioUrl, `${title}_BGM`, 'https://www.douyin.com/') : null;

    recordParseSuccess('douyin');

    return {
        success: true,
        data: {
            title,
            desc: desc || title,
            cover,
            platform: 'douyin',
            url: targetUrl,
            noteType,
            duration,
            author,
            avatar,
            images: noteType === 'image' ? images : undefined,
            originDownloadVideoUrl: originVideoUrl,
            downloadVideoUrl,
            playVideoUrl,
            originDownloadAudioUrl: audioUrl,
            downloadAudioUrl,
            videoAudioMode: 'muxed',
            mediaActions: {
                video: downloadVideoUrl ? 'direct-download' : 'hide',
                audio: downloadAudioUrl ? 'direct-download' : 'extract-audio'
            }
        }
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Bilibili (B站) Parser
// ─────────────────────────────────────────────────────────────────────────────
async function parseBilibili(rawUrl) {
    let targetUrl = rawUrl;
    if (targetUrl.includes('b23.tv')) {
        targetUrl = await resolveRedirect(targetUrl, { 'User-Agent': USER_AGENT_PC });
    }

    let bvid = null;
    let aid = null;
    const bvidMatch = targetUrl.match(/\/video\/(BV[a-zA-Z0-9]+)/i);
    const aidMatch = targetUrl.match(/\/video\/av([0-9]+)/i);

    if (bvidMatch) bvid = bvidMatch[1];
    else if (aidMatch) aid = aidMatch[1];

    if (!bvid && !aid) {
        throw new Error('未识别到有效的 B 站视频 BV 号或 av 号');
    }

    const viewApiUrl = bvid
        ? `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`
        : `https://api.bilibili.com/x/web-interface/view?aid=${aid}`;

    const viewRes = { data: { code: 0, data: await biliGet(viewApiUrl) } };

    if (viewRes.data?.code !== 0 || !viewRes.data?.data) {
        throw new Error(`B站视频详情接口响应异常: ${viewRes.data?.message || '未知错误'}`);
    }

    const videoData = viewRes.data.data;
    const resolvedBvid = videoData.bvid || bvid;
    const title = videoData.title || '哔哩哔哩视频';
    const desc = videoData.desc || '';
    const cover = videoData.pic ? (videoData.pic.startsWith('//') ? 'https:' + videoData.pic : videoData.pic) : null;
    const author = videoData.owner?.name || 'B站UP主';
    const avatar = videoData.owner?.face ? (videoData.owner.face.startsWith('//') ? 'https:' + videoData.owner.face : videoData.owner.face) : null;
    let duration = videoData.duration || 0;

    // Multi-P Pages
    const pages = (videoData.pages || []).map(p => ({
        cid: p.cid,
        page: p.page,
        part: p.part || `第${p.page}P`,
        duration: p.duration
    }));

    const pageIndex = Math.max(0, (parseInt(new URL(targetUrl).searchParams.get('p')) || 1) - 1);
    if (pageIndex >= pages.length && pages.length) throw new Error('该视频分P不存在');
    const targetCid = pages[pageIndex]?.cid || videoData.cid;
    duration = pages[pageIndex]?.duration || duration;

    // Fetch video stream URL for cid
    let videoStreamUrl = null;
    let audioStreamUrl = null;
    let videoSegments;
    let formats = [];

    try {
        const playUrlApi = `https://api.bilibili.com/x/player/playurl?bvid=${resolvedBvid}&cid=${targetCid}&qn=80&fnval=16&type=mp4`;
        const playRes = { data: { code: 0, data: await biliGet(playUrlApi) } };

        if (playRes.data?.code === 0 && playRes.data?.data) {
            const durl = playRes.data.data.durl;
            const dash = playRes.data.data.dash;

            if (Array.isArray(durl) && durl.length > 0) {
                videoStreamUrl = durl[0].url;
                if (durl.length > 1) videoSegments = durl.map(part => part.url);
            } else if (dash) {
                if (Array.isArray(dash.video) && dash.video.length > 0) {
                    const compatible = dash.video.filter(v => v.codecid === 7);
                    const track = (compatible.length ? compatible : dash.video).sort((a,b) => b.id-a.id || (b.bandwidth || 0) - (a.bandwidth || 0))[0];
                    videoStreamUrl = track.baseUrl || track.base_url || (Array.isArray(track.backupUrl) ? track.backupUrl[0] : (Array.isArray(track.backup_url) ? track.backup_url[0] : null));
                }
                if (Array.isArray(dash.audio) && dash.audio.length > 0) {
                    const sortedAudio = [...dash.audio].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0) || (b.id || 0) - (a.id || 0));
                    const bestAudio = sortedAudio[0];
                    audioStreamUrl = bestAudio.baseUrl || bestAudio.base_url || (Array.isArray(bestAudio.backupUrl) ? bestAudio.backupUrl[0] : (Array.isArray(bestAudio.backup_url) ? bestAudio.backup_url[0] : null));
                }
            }

            if (Array.isArray(playRes.data.data.accept_description)) {
                formats = playRes.data.data.accept_description.map((descText, idx) => ({
                    quality: playRes.data.data.accept_quality?.[idx] || 80,
                    description: descText
                }));
            }
        }
    } catch (e) {
        console.warn('[Downloader Core] Bilibili playurl API warning:', e.message);
    }

    const downloadVideoUrl = videoStreamUrl ? buildLocalDownloadUrl(videoStreamUrl, title, 'https://www.bilibili.com') : null;
    const playVideoUrl = videoStreamUrl ? buildLocalPlayUrl(videoStreamUrl, 'https://www.bilibili.com') : null;
    const downloadAudioUrl = audioStreamUrl ? buildLocalDownloadUrl(audioStreamUrl, `${title}_音频`, 'https://www.bilibili.com') : null;

    if (!videoStreamUrl) throw new Error('B站未返回可访问的媒体轨，可能需要登录或该视频不允许下载');
    recordParseSuccess('bilibili');

    return {
        success: true,
        data: {
            title,
            desc: desc || title,
            cover,
            platform: 'bilibili',
            url: `https://www.bilibili.com/video/${resolvedBvid}${pageIndex ? '?p=' + (pageIndex + 1) : ''}`,
            noteType: 'video',
            duration,
            author,
            avatar,
            bvid: resolvedBvid,
            cid: targetCid,
            pages: pages.length > 1 ? pages : undefined,
            formats: formats.length > 0 ? formats : undefined,
            originDownloadVideoUrl: videoStreamUrl,
            videoSegments,
            downloadVideoUrl,
            playVideoUrl,
            originDownloadAudioUrl: audioStreamUrl,
            downloadAudioUrl,
            videoAudioMode: audioStreamUrl ? 'separate' : 'muxed',
            needsMux: Boolean(audioStreamUrl),
            mediaActions: {
                video: downloadVideoUrl ? 'direct-download' : 'hide',
                audio: downloadAudioUrl ? 'direct-download' : 'extract-audio'
            }
        }
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Xiaohongshu (小红书) Parser
// ─────────────────────────────────────────────────────────────────────────────
async function parseXiaohongshu(rawUrl) {
    let targetUrl = rawUrl;
    if (targetUrl.includes('xhslink.com')) {
        targetUrl = await resolveRedirect(targetUrl, { 'User-Agent': USER_AGENT_PC });
    }

    const noteData = (await require('./red-public').get(targetUrl)).note;
    const title = noteData.title || noteData.desc || '小红书笔记';
    const desc = noteData.desc || '';
    const cover = noteData.imageList?.[0]?.urlDefault || null;
    let videoUrl = null;
    const author = noteData.user?.nickname || '';
    const avatar = noteData.user?.avatar || null;
    let noteType = 'video';
    const images = [];

    if (noteData.type === 'video' || noteData.video) {
        const stream = noteData.video?.media?.stream;
        const formats = stream?.h264 || stream?.h265 || [];
        videoUrl = formats[0]?.masterUrl || formats[0]?.master_url || null;
    } else if (Array.isArray(noteData.imageList)) {
        noteType = 'image';
        noteData.imageList.forEach((image,index)=>{
            const url=image.urlDefault || image.urlOriginal;
            if(url)images.push({index:index+1,url,downloadUrl:'/api/proxy-image?url='+encodeURIComponent(url)});
        });
    }

    const downloadVideoUrl = videoUrl ? buildLocalDownloadUrl(videoUrl, title, 'https://www.xiaohongshu.com') : null;
    const playVideoUrl = videoUrl ? buildLocalPlayUrl(videoUrl, 'https://www.xiaohongshu.com') : null;

    if (noteType === 'video' && !videoUrl) throw new Error('小红书公开原链接没有返回对应的视频地址；未要求扫码，未用推荐笔记替代');
    if (noteType === 'image' && !images.length) throw new Error('小红书未返回可访问的图文内容');
    recordParseSuccess('xiaohongshu');

    return {
        success: true,
        data: {
            title,
            desc: desc || title,
            cover,
            platform: 'xiaohongshu',
            url: targetUrl,
            noteType,
            author,
            avatar,
            images: noteType === 'image' ? images : undefined,
            originDownloadVideoUrl: videoUrl,
            downloadVideoUrl,
            playVideoUrl,
            originDownloadAudioUrl: null,
            downloadAudioUrl: null,
            videoAudioMode: 'muxed',
            mediaActions: {
                video: downloadVideoUrl ? 'direct-download' : 'hide',
                audio: 'extract-audio'
            }
        }
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Kuaishou (快手) Parser
// ─────────────────────────────────────────────────────────────────────────────
async function parseKuaishou(rawUrl) {
    const targetUrl=rawUrl.includes('v.kuaishou.com') ? await resolveRedirect(rawUrl,{ 'User-Agent':USER_AGENT_MOBILE }) : rawUrl;
    // 不再用页面中第一个photoUrl（可能是推荐作品）；真实提取器必须核对原作品编号。
    return parseGeneric(targetUrl);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Generic / YouTube / TikTok / Other Web Parser
// ─────────────────────────────────────────────────────────────────────────────
async function parseGeneric(targetUrl) {
    let info;
    const targetHost = new URL(targetUrl).hostname;
    if (targetHost === 'tiktok.com' || targetHost.endsWith('.tiktok.com')) {
        try {
            info = await require('./tiktok-embed').extractTikTokEmbed(targetUrl);
            if (!require('./media-identity').identity(targetUrl)) targetUrl = info.webpage_url;
        }
        catch { /* 公开嵌入不可访问时再尝试通用提取器，仍不要求用户登录。 */ }
    }
    if (targetHost==='x.com' || targetHost.endsWith('.x.com') || targetHost==='twitter.com' || targetHost.endsWith('.twitter.com')) {
        try {info=await require('./x-public').extractPublicMetadata(targetUrl);}catch { /* 公开转述源失败时仍可尝试原站提取器。 */ }
    }
    if(targetHost==='kuaishou.com' || targetHost.endsWith('.kuaishou.com')) {
        try {info=await require('./kuaishou-public').extractPublicMetadata(targetUrl);}catch { /* 原站公开详情不可达时再尝试通用提取器。 */ }
    }
    if (!info) info = await require('./yt-dlp-parser').extractMetadata(targetUrl);
    require('./media-identity').assertIdentity(targetUrl,info);
    const formats = info.requested_formats || [];
    const video = formats.find(f => f.vcodec && f.vcodec !== 'none') || info;
    const audio = formats.find(f => f.acodec && f.acodec !== 'none' && f.vcodec === 'none');
    if (!video.url) throw new Error('平台没有返回可下载的实际媒体地址');
    const host = new URL(targetUrl).hostname;
    const matches=domain=>host===domain || host.endsWith('.'+domain);
    const platform=matches('youtube.com') || matches('youtu.be') ? 'youtube' : matches('tiktok.com') ? 'tiktok' : matches('x.com') || matches('twitter.com') ? 'twitter' : matches('instagram.com') ? 'instagram' : matches('kuaishou.com') || matches('gifshow.com') ? 'kuaishou' : matches('weibo.com') || matches('weibo.cn') ? 'weibo' : 'universal';
    const title = info.title || '在线媒体';
    recordParseSuccess(platform);
    return { success: true, data: {
        title, desc: info.description || '', cover: info.thumbnail || null, author: info.uploader || info.channel || '',
        platform, url: info.webpage_url || targetUrl, duration: info.duration || 0,
        noteType: video.vcodec === 'none' ? 'audio' : 'video',
        originDownloadVideoUrl: video.url, originDownloadAudioUrl: audio?.url || null,
        downloadVideoUrl: buildLocalDownloadUrl(video.url, title, targetUrl),
        playVideoUrl: buildLocalPlayUrl(video.url, targetUrl),
        downloadAudioUrl: audio ? buildLocalDownloadUrl(audio.url, title, targetUrl) : null,
        videoAudioMode: audio ? 'separate' : 'muxed', needsMux: Boolean(audio),
        mediaActions: { video: 'prepare-download', audio: 'extract-audio' },
        httpHeaders: {...info.http_headers,...video.http_headers},
        subtitleTracks: info.subtitles || {}, automaticCaptionTracks: info.automatic_captions || {}
    } };
}

/**
 * Master Unified Parse Entry Point
 */
async function unifiedParse(rawInput) {
    if (!rawInput || typeof rawInput !== 'string') {
        return { success: false, error: '缺少必需的视频链接或分享文本' };
    }

    const cleanInput = rawInput.trim();
    const targetUrl = extractUrlFromText(cleanInput) || cleanInput;

    try {
        require('./safe-network').platformUrl(targetUrl);
        const host = new URL(targetUrl).hostname.toLowerCase();
        const matches = domain => host === domain || host.endsWith('.' + domain);
        if (matches('bilibili.com') || matches('b23.tv')) {
            return await parseBilibili(targetUrl);
        } else if (matches('douyin.com') || matches('iesdouyin.com')) {
            return await parseDouyin(targetUrl, cleanInput);
        } else if (matches('xiaohongshu.com') || matches('xhslink.com')) {
            return await parseXiaohongshu(targetUrl);
        } else if (matches('kuaishou.com') || matches('gifshow.com')) {
            return await parseKuaishou(targetUrl);
        } else {
            return await parseGeneric(targetUrl);
        }
    } catch (error) {
        console.error('[Downloader Core] Parse exception:', error.message);
        return {
            success: false,
            error: error.message || '服务器解析发生错误，请检查链接有效性'
        };
    }
}

module.exports = {
    USER_AGENT_PC,
    USER_AGENT_MOBILE,
    extractUrlFromText,
    cleanShareTitle,
    resolveRedirect,
    buildLocalDownloadUrl,
    buildLocalPlayUrl,
    resolveAntiHotlinkingHeaders,
    unifiedParse,
    parseDouyin,
    parseBilibili,
    parseXiaohongshu,
    parseKuaishou,
    parseGeneric,
    getTodayParseStats,
    recordParseSuccess
};

