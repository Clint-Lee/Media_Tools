require('./lib/env');
const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const path = require('path');
const fs = require('fs');
const { prepareVideoList, parseHeat } = require('./lib/video-pipeline');
const { attachVideoLocations } = require('./lib/geo-hotspots');
const liveSources = require('./lib/live-sources');
const mediaJobs = require('./lib/media-jobs');
const safeNetwork = require('./lib/safe-network');
const {
    unifiedParse,
    resolveAntiHotlinkingHeaders,
    extractUrlFromText
} = require('./lib/downloader-core');

// Only use the proxy explicitly detected/configured by HotPot. Stale HTTP_PROXY

// environment variables otherwise make domestic sources fail unexpectedly.
axios.defaults.proxy = false;

const app = express();
const PORT = process.env.PORT || 4000;
const globeDistDir = path.dirname(require.resolve('globe.gl'));
const threeGlobeAssetsDir = path.join(globeDistDir, '..', '..', 'three-globe', 'example', 'img');

app.use(express.json());
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');next();});
app.use((req,res,next)=>{
    const localMode=['127.0.0.1','localhost','::1'].includes(process.env.HOST || '127.0.0.1');
    const allowed=process.env.HOTPOT_ALLOWED_HOSTS?.split(',').map(s=>s.trim().toLowerCase()) || (localMode?['localhost','127.0.0.1','::1']:null);
    if(allowed && !allowed.includes(String(req.hostname || '').toLowerCase().replace(/^\[|\]$/g,''))) return res.status(403).json({success:false,message:'请求Host不在本服务允许列表中'});
    next();
});
app.get('/vendor/globe.gl.min.js', (req, res) => {
    res.sendFile(path.join(globeDistDir, 'globe.gl.min.js'));
});
app.get('/vendor/earth-blue-marble.jpg', (req, res) => {
    const local = path.join(__dirname, 'public', 'vendor', 'earth-blue-marble.jpg');
    if (fs.existsSync(local)) return res.sendFile(local);
    res.redirect('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg');
});
app.get('/vendor/earth-topology.png', (req, res) => {
    const local = path.join(__dirname, 'public', 'vendor', 'earth-topology.png');
    if (fs.existsSync(local)) return res.sendFile(local);
    res.redirect('https://unpkg.com/three-globe/example/img/earth-topology.png');
});
app.get('/vendor/earth-dark.jpg', (req, res) => {
    const local = path.join(__dirname, 'public', 'vendor', 'earth-blue-marble.jpg');
    if (fs.existsSync(local)) return res.sendFile(local);
    res.redirect('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg');
});
app.get('/vendor/night-sky.png', (req, res) => {
    const local = path.join(__dirname, 'public', 'vendor', 'night-sky.png');
    if (fs.existsSync(local)) return res.sendFile(local);
    res.sendFile(path.join(threeGlobeAssetsDir, 'night-sky.png'));
});
app.use(express.static(path.join(__dirname, 'public')));

const accounts = require('./lib/accounts');
const authenticate = accounts.auth;
app.use('/api', accounts.sameOrigin);
accounts.mount(app);

// ── Universal Media Parser API (GET & POST) ──────────────────────────────────
async function handleUnifiedParse(req, res) {
    const rawUrl = (req.method === 'GET' ? req.query.url : req.body?.url) || '';
    if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
        return res.status(400).json({ success: false, error: '请提供视频链接或分享口令文本' });
    }

    let reservation;
    try {
        safeNetwork.platformUrl(extractUrlFromText(rawUrl) || rawUrl);
        reservation = accounts.store.reserve(req.user.username, 'parse');
        console.log(`[Downloader API] Parsing media link: ${String(rawUrl).substring(0, 80)}...`);
        const result = await unifiedParse(rawUrl);

        if (!result || !result.success) {
            accounts.store.settle(reservation, false);
            return res.status(400).json(result || { success: false, error: '解析失败，请检查链接有效性' });
        }

        result.data.mediaId = mediaJobs.registerMedia(result.data, req.user.username);
        result.data.transcript = null;
        result.data.aiAnalysis = null;
        result.data.analysisStatus = result.data.noteType === 'image' ? 'unsupported' : 'pending';
        const { httpHeaders, ...publicData } = result.data;

        accounts.store.settle(reservation, true);
        accounts.store.log(req.user.username, { kind: 'parse', status: 'parsed', url: result.data.url || rawUrl, title: result.data.title, cover: result.data.cover, platform: result.data.platform });

        return res.json({
            success: true,
            data: publicData,
            // Backwards compatibility convenience properties
            videoUrl: result.data.originDownloadVideoUrl || result.data.downloadVideoUrl,
            downloadVideoUrl: result.data.downloadVideoUrl,
            originDownloadVideoUrl: result.data.originDownloadVideoUrl,
            playUrl: result.data.playVideoUrl,
            title: result.data.title,
            description: result.data.desc,
            cover: result.data.cover,
            author: result.data.author,
            platform: result.data.platform,
            duration: result.data.duration,
            originUrl: result.data.url,
            transcript: result.data.transcript,
            aiAnalysis: result.data.aiAnalysis
        });
    } catch (e) {
        if (reservation) accounts.store.settle(reservation, false);
        console.error('[Downloader API] Parse exception:', e.message);
        return res.status(e.status || 502).json({ success: false, error: '真实媒体解析失败: ' + e.message });
    }
}

app.get('/api/parse', authenticate, handleUnifiedParse);
app.post('/api/parse', authenticate, handleUnifiedParse);

// ── Today Parse Statistics API ───────────────────────────────────────────────
app.get('/api/stats/today', (req, res) => {
    return res.json(accounts.store.statistics());
});

app.get('/api/media/capabilities', (req, res) => res.json({ success: true, ...mediaJobs.capabilities() }));

function handleMediaJob(req, res) {
    let reservation;
    try {
        const input = req.body?.url;
        if (typeof input !== 'string' || input.length > 4000) throw new Error('需要提供真实视频链接');
        const url = (extractUrlFromText(input) || input).trim();
        safeNetwork.platformUrl(url);
        const reused = mediaJobs.findReusable({ url, kind:req.body.kind || 'analyze', owner:req.user.username });
        if (reused) return res.status(202).json({ success:true, job:{...mediaJobs.getJob(reused.id,req.user.username),reused:true} });
        reservation = accounts.store.reserve(req.user.username, req.body.kind || 'analyze');
        const job = mediaJobs.createJob({ url, mediaId: req.body.mediaId, kind: req.body.kind || 'analyze', owner: req.user.username,
            onFinished: current => {
                accounts.store.settle(reservation, current.status === 'complete');
                accounts.store.log(current.owner, { kind: current.kind, status: current.status === 'complete' ? 'prepared' : 'failed',
                    url: current.url, title: current.title, jobId: current.id, message: current.message });
            } });
        if (job.reused) accounts.store.settle(reservation, false);
        return res.status(202).json({ success: true, job });
    } catch (error) {
        if (reservation) accounts.store.settle(reservation, false);
        return res.status(error.status || (/队列已满/.test(error.message) ? 429 : 400)).json({ success: false, message: error.message });
    }
}
app.post('/api/media/jobs', authenticate, handleMediaJob);
app.get('/api/media/jobs/:id', authenticate, (req, res) => {
    const job = mediaJobs.getJob(req.params.id, req.user.username);
    return job ? res.json({ success: true, job }) : res.status(404).json({ success: false, message: '任务不存在或已过期' });
});
app.get('/api/media/jobs/:id/file', authenticate, (req, res) => {
    const file = mediaJobs.getJobFile(req.params.id, req.user.username);
    if (!file) return res.status(404).json({ success: false, message: '媒体文件尚未生成' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.on('finish', () => { if (res.statusCode < 400) accounts.store.log(req.user.username, { kind: file.kind, status: req.headers.range ? 'streamed' : 'sent', url: file.url, title: file.title, jobId: req.params.id }); });
    return res.download(file.path, file.filename);
});

function resolveMediaExtension(contentType, safeFilename) {
    const lowerName = (safeFilename || '').toLowerCase();
    const ct = (contentType || '').toLowerCase().split(';')[0].trim();
    if (/\.(mp4|mp3|m4a|aac|wav|ogg|flac|webm|mov|mkv|jpg|jpeg|png|webp|gif|zip)$/i.test(lowerName)) {
        return '';
    }
    if (ct === 'video/mp4') return '.mp4';
    if (ct === 'video/webm') return '.webm';
    if (ct === 'video/quicktime') return '.mov';
    if (ct === 'video/x-matroska') return '.mkv';
    if (ct === 'audio/mpeg' || ct === 'audio/mp3') return '.mp3';
    if (ct === 'audio/mp4' || ct === 'audio/m4a' || ct === 'audio/x-m4a') return '.m4a';
    if (ct === 'audio/aac') return '.aac';
    if (ct === 'audio/wav' || ct === 'audio/x-wav') return '.wav';
    if (ct === 'audio/ogg') return '.ogg';
    if (ct === 'audio/flac') return '.flac';
    if (ct.startsWith('audio/')) return '.m4a';
    if (ct === 'image/jpeg') return '.jpg';
    if (ct === 'image/png') return '.png';
    if (ct === 'image/webp') return '.webp';
    if (ct === 'image/gif') return '.gif';
    if (ct.startsWith('video/')) return '.mp4';
    return '.mp4';
}

// ── Anti-Hotlinking Streaming Download Pipeline ──────────────────────────────
app.get('/api/download', authenticate, async (req, res) => {
    let targetUrl = req.query.url || req.query.videoUrl;
    const filename = req.query.filename || req.query.title || `Media_${Date.now()}`;
    const customReferer = req.query.referer;

    if (!targetUrl) {
        return res.status(400).send('缺少必需的媒体直链地址 (url)');
    }

    if (targetUrl.startsWith('/api/download') || targetUrl.startsWith('/api/play')) {
        try {
            const parsedUrl = new URL(targetUrl, 'http://127.0.0.1');
            targetUrl = parsedUrl.searchParams.get('url') || targetUrl;
        } catch {}
    }

    try {
        parseExternalUrl(targetUrl);
        const upstreamHeaders = resolveAntiHotlinkingHeaders(targetUrl, customReferer);
        if (req.headers.range) {
            upstreamHeaders['Range'] = req.headers.range;
        }

        const response = await axios({
            ...safeNetwork.mediaOptions(targetUrl),
            method: 'GET',
            url: targetUrl,
            responseType: 'stream',
            headers: upstreamHeaders,
            timeout: 60000,
            validateStatus: status => status === 200 || status === 206
        });

        res.status(response.status);
        const contentType = response.headers['content-type'] || 'video/mp4';
        if (contentType.includes('text/') || contentType.includes('json')) {
            response.data.destroy();
            throw new Error('上游返回网页而非媒体，未生成下载文件');
        }
        if (String(filename).toLowerCase().endsWith('.mp3') && !/audio\/(?:mpeg|mp3)/i.test(contentType)) {
            response.data.destroy(); throw new Error('音频不是MP3编码，请使用真实MP3转码任务，不能仅改扩展名');
        }
        res.setHeader('Content-Type', contentType);

        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        res.setHeader('Accept-Ranges', 'bytes');
        if (response.headers['content-range']) {
            res.setHeader('Content-Range', response.headers['content-range']);
        }

        const safeFilename = String(filename).replace(/[\\/:*?"<>|\r\n]/g, '_').trim().slice(0, 160);
        const encodedFilename = encodeURIComponent(safeFilename);
        const ext = resolveMediaExtension(contentType, safeFilename);
        res.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}${ext}"; filename*=UTF-8''${encodedFilename}${ext}`);
        res.setHeader('Cache-Control', 'private, no-store');

        let bytesReceived = 0;
        let streamFailed = false;
        const expectedBytes = response.headers['content-length'] ? parseInt(response.headers['content-length'], 10) : null;

        response.data.on('data', chunk => {
            bytesReceived += chunk.length;
        });

        res.on('finish', () => {
            const isTruncated = expectedBytes && bytesReceived < expectedBytes;
            if (res.statusCode < 400 && !streamFailed && !isTruncated) {
                accounts.store.log(req.user.username, { kind: 'direct-download', status: 'sent', url: '', title: safeFilename });
            } else if (streamFailed || isTruncated) {
                accounts.store.log(req.user.username, { kind: 'direct-download', status: 'interrupted', url: '', title: safeFilename, message: '上游传输中断或未完成' });
            }
        });

        res.on('close', () => {
            if (response.data && !response.data.destroyed) {
                response.data.destroy();
            }
        });
        response.data.on('error', (streamErr) => {
            streamFailed = true;
            console.warn('[Download Stream Pipe] Stream warning:', streamErr.message);
            if (!res.writableEnded) {
                res.destroy(streamErr);
            }
        });

        response.data.pipe(res);
    } catch (error) {
        console.error('[Download Stream] Error:', error.message);
        if (!res.headersSent) {
            res.status(502).send('代理流媒体拉取失败: ' + error.message);
        }
    }
});

// ── Anti-Hotlinking Video Playback Proxy (Range Supported) ───────────────────
app.get('/api/play', async (req, res) => {
    const targetUrl = req.query.url;
    const customReferer = req.query.referer;

    if (!targetUrl) {
        return res.status(400).send('缺少播放地址 (url)');
    }

    try {
        parseExternalUrl(targetUrl);
        const upstreamHeaders = resolveAntiHotlinkingHeaders(targetUrl, customReferer);
        if (req.headers.range) {
            upstreamHeaders['Range'] = req.headers.range;
        }

        const response = await axios({
            ...safeNetwork.mediaOptions(targetUrl),
            method: 'GET',
            url: targetUrl,
            responseType: 'stream',
            headers: upstreamHeaders,
            timeout: 20000,
            validateStatus: status => status === 200 || status === 206
        });

        res.status(response.status);
        if ((response.headers['content-type'] || '').includes('text/')) {
            response.data.destroy();
            throw new Error('上游没有返回可播放媒体');
        }
        res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        res.setHeader('Accept-Ranges', 'bytes');
        if (response.headers['content-range']) {
            res.setHeader('Content-Range', response.headers['content-range']);
        }
        res.setHeader('Cache-Control', 'public, max-age=3600');

        res.on('close', () => {
            if (response.data && !response.data.destroyed) {
                response.data.destroy();
            }
        });
        response.data.on('error', (streamErr) => {
            console.warn('[Play Stream Pipe] Stream warning:', streamErr.message);
        });

        response.data.pipe(res);
    } catch (error) {
        console.warn('[Play Stream] Error:', error.message);
        if (!res.headersSent) {
            res.status(502).send('视频流代理播放失败: ' + error.message);
        }
    }
});


const videoApiCache = new Map();
function cacheVideoApi(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    const url = new URL(req.originalUrl, 'http://localhost');
    url.searchParams.delete('_t');
    const forceRefresh = url.searchParams.get('refresh') === '1';
    url.searchParams.delete('refresh');
    const cacheKey = `${req.path}?${url.searchParams.toString()}`;
    const cached = videoApiCache.get(cacheKey);

    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
        res.setHeader('X-HotPot-Cache', 'HIT');
        return res.json(cached.payload);
    }

    const sendJson = res.json.bind(res);
    res.json = payload => {
        if (res.statusCode < 400 && payload?.success && Array.isArray(payload.list)) {
            const ttl = payload.partial || payload.stale ? 60000 : req.path === '/api/trends' ? 120000 : 60000;
            videoApiCache.set(cacheKey, { payload, expiresAt: Date.now() + ttl });
            if (videoApiCache.size > 200) {
                const oldestKey = videoApiCache.keys().next().value;
                videoApiCache.delete(oldestKey);
            }
            res.setHeader('X-HotPot-Cache', 'MISS');
        }
        return sendJson(payload);
    };
    next();
}
app.use(['/api/trends', '/api/search'], cacheVideoApi);

// Global Proxy Configuration
let activeProxy = null; // e.g., 'http://127.0.0.1:7897'
let proxyAgent = null;
const VALID_PLATFORMS = new Set(['bilibili', 'douyin', 'youtube', 'tiktok', 'twitter', 'xiaohongshu', 'kuaishou']);
const VALID_CATEGORIES = new Set(['all', 'comedy', 'ent', 'fashion', 'pets', 'wildlife', 'tech', 'marketing', 'kuso', 'animal']);
const VALID_TIME_RANGES = new Set(['all', '3days', '7days', '1month', '6months']);

function parseExternalUrl(value) { return safeNetwork.parsePublicUrl(value); }

function isSupportedVideoPage(parsedUrl) {
    const hostname = parsedUrl.hostname.toLowerCase();
    return [
        'bilibili.com', 'b23.tv', 'youtube.com', 'youtu.be',
        'tiktok.com', 'urlebird.com', 'douyin.com', 'iesdouyin.com',
        'x.com', 'twitter.com', 'xiaohongshu.com', 'xhslink.com',
        'kuaishou.com', 'v.kuaishou.com'
    ].some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
}

// Auto-detect system/local proxies
async function detectProxy() {
    if (process.env.MEDIA_PROXY) {
        activeProxy=process.env.MEDIA_PROXY; proxyAgent=new HttpsProxyAgent(activeProxy);
        console.log('[Proxy Setup] Using explicitly configured proxy (credentials not logged).'); return;
    }
    const potentialProxies = [
        'http://127.0.0.1:7897', // Clash Verge
        'http://127.0.0.1:7890', // Clash
        'http://127.0.0.1:10809',// v2ray
        'http://127.0.0.1:10808' // xray
    ];

    console.log('[Proxy Setup] Auto-detecting active local proxies...');
    for (const proxyUrl of potentialProxies) {
        try {
            const agent = new HttpsProxyAgent(proxyUrl);
            const res = await axios.get('https://api.bilibili.com/x/web-interface/nav', {
                httpsAgent: agent,
                timeout: 4000, proxy:false,
                validateStatus: status=>status>=200&&status<400
            });
            if (res.data?.data?.wbi_img) {
                activeProxy = proxyUrl;
                proxyAgent = agent;
                if (!process.env.MEDIA_PROXY) process.env.MEDIA_PROXY = activeProxy;
                console.log(`[Proxy Setup] 🎉 Auto-detected active proxy: ${proxyUrl}`);
                return;
            }
        } catch (e) {
            // Check next port
        }
    }
    console.log('[Proxy Setup] No active proxy detected. Overseas features will load with direct network.');
}

// Helper to format play count into Chinese standard format (万/亿)
function formatCount(num) {
    if (num === null || num === undefined || num === '') return '0';
    const heat = parseHeat(num);
    if (heat <= 0) return '0';
    if (heat >= 1e8) {
        const yi = heat / 1e8;
        return (yi >= 100 ? yi.toFixed(0) : yi.toFixed(1)).replace(/\.0$/, '') + '亿';
    }
    if (heat >= 1e4) {
        const wan = heat / 1e4;
        return (wan >= 1000 ? wan.toFixed(0) : wan.toFixed(1)).replace(/\.0$/, '') + '万';
    }
    return Math.floor(heat).toLocaleString('zh-CN');
}

// Helper to format duration
function formatDuration(sec) {
    if (!sec) return 'Shorts';
    const s = parseInt(sec);
    if (isNaN(s)) return sec.toString();
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rs = s % 60;
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${rs.toString().padStart(2, '0')}`;
    }
    return `${m}:${rs.toString().padStart(2, '0')}`;
}

// Helper to parse YouTube publishedTime text into relative age in seconds
function parseRelativeTime(text) {
    return require('./lib/youtube-search').relativeAge(text)?.seconds || 0;
}

// Helper to filter list by upload date/timeRange
function filterByTimeRange(list, timeRange) {
    return prepareVideoList(list, { timeRange, requireKnownDate: true });
}

function sendVideoList(res, list, timeRange, extra = {}) {
    const prepared = attachVideoLocations(prepareVideoList(list, {
        timeRange,
        requireKnownDate: timeRange !== 'all',
        limit: 2000
    }));
    const locatedCount = prepared.filter(item => item.geo).length;
    return res.json({
        success: true,
        list: prepared,
        total: prepared.length,
        timeRange: timeRange || 'all',
        sortedBy: 'heat_desc',
        geoCoverage: {
            located: locatedCount,
            total: prepared.length,
            ratio: prepared.length ? locatedCount / prepared.length : 0,
            method: '公开属地优先，内容城市关键词补充'
        },
        message: prepared.length === 0 && timeRange && timeRange !== 'all'
            ? '当前已获取样本中没有符合发布时效的作品，这不代表平台该分区没有视频。可刷新、扩大时间范围或检查数据源状态。'
            : undefined,
        ...extra
    });
}

function extractYouTubeVideos(obj) {
    let videos = [];
    function traverse(node) {
        if (!node || typeof node !== 'object') return;
        if (node.videoRenderer) {
            const v = node.videoRenderer;
            try {
                const videoId = v.videoId;
                const title = v.title?.runs?.map(run => run.text).join('') || v.title?.simpleText || '';
                const cover = v.thumbnail?.thumbnails?.at(-1)?.url || '';
                const duration = v.lengthText?.simpleText || 'Shorts';
                const rawPlay = parseHeat(v.viewCountText?.simpleText);
        const playCount = v.viewCountText?.simpleText ? formatCount(rawPlay) : '未公开';
                const author = v.ownerText?.runs?.[0]?.text || '';
                const age = require('./lib/youtube-search').relativeAge(v.publishedTimeText?.simpleText);
                const pubdate = age ? Math.floor(Date.now() / 1000) - age.seconds : 0;
                videos.push({
                    id: videoId,
                    title,
                    description: v.descriptionSnippet?.runs?.[0]?.text || '',
                    cover,
                    duration,
                    playCount,
                    playRaw: v.viewCountText?.simpleText ? rawPlay : null,
                    metric: 'views',
                    metricLabel: '播放',
                    source: 'youtube:public-search',
                    commentCount: '0',
                    author,
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    platform: 'YouTube',
                    datePrecision: 'relative', publishedAgeUpperBound: age?.upperSeconds ?? null,
                    pubdate
                });
            } catch (e) {}
        }
        for (const key in node) {
            traverse(node[key]);
        }
    }
    traverse(obj);
    return videos;
}

// Route to get active settings
app.get('/api/settings', (req, res) => {
    const visibleProxy=activeProxy?new URL(activeProxy):null;
    if(visibleProxy){visibleProxy.username='';visibleProxy.password='';}
    res.json({
        success: true,
        proxy: visibleProxy?.toString().replace(/\/$/,'') || '',
        status: activeProxy ? 'Connected' : 'Disconnected'
    });
});

// Route to configure proxy manually
app.post('/api/settings', authenticate, accounts.admin, (req, res) => {
    const { proxy } = req.body;
    if (proxy) {
        let parsed;
        try {
            parsed = new URL(proxy.trim());
            if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
        } catch {
            return res.status(400).json({ error: 'INVALID_PROXY', message: '代理地址必须是有效的 HTTP/HTTPS URL' });
        }
        activeProxy = parsed.toString().replace(/\/$/, '');
        try {
            proxyAgent = new HttpsProxyAgent(activeProxy);
        } catch {
            activeProxy = null;
            proxyAgent = null;
            return res.status(400).json({ error: 'INVALID_PROXY', message: '无法应用该代理地址' });
        }
        console.log('[Proxy Setup] Proxy updated by authenticated administrator (credentials not logged).');
    } else {
        activeProxy = null;
        proxyAgent = null;
        console.log(`[Proxy Setup] Proxy disabled.`);
    }
    process.env.MEDIA_PROXY = activeProxy || '';
    res.json({ success: true, proxy: activeProxy || '' });
});

// All rankings below are sourced from live platform responses. No fixture pools.
async function fetchYouTubeLive(options) {
    if (options.page > 1) throw new Error('YouTube 公开页面不支持可靠的继续翻页，请配置 YOUTUBE_API_KEY 使用官方翻页。');
    const terms = { comedy: ['stand up comedy', 'funny videos', 'comedy'], ent: ['entertainment', 'celebrity', 'movies'],
        tech: ['science and technology', 'gadgets', 'computer hardware', 'artificial intelligence', 'smartphone review'],
        fashion: ['fashion', 'makeup', 'outfit'], marketing: ['business marketing', 'branding', 'content marketing'],
        pets: ['pet cats', 'pet dogs', 'pets'], animal: ['animals', 'wildlife', 'pets'], wildlife: ['wildlife documentary', 'wild animals'], kuso: ['meme', 'remix parody'] };
    const categoryTerms = terms[options.category] || ['music', 'kids', 'education', 'comedy', 'science and technology', 'sports'];
    const keywords = options.query ? (options.category === 'all' ? [options.query] : categoryTerms.slice(0, 2).map(term => options.query + ' ' + term)) : categoryTerms;
    const searches = keywords.flatMap(keyword => (['3days', '7days'].includes(options.timeRange) ? [options.timeRange, 'today'] : [options.timeRange]).map(timeRange => ({ keyword, timeRange })));
    const results = await liveSources.boundedMap(searches, 3, async ({ keyword, timeRange }) => {
        const response = await axios.get('https://www.youtube.com/results', {
            params: { search_query: keyword, sp: require('./lib/youtube-search').searchFilter(timeRange) },
            headers: { 'User-Agent': liveSources.UA || 'Mozilla/5.0', 'Accept-Language': 'en-US,en;q=0.9' },
            timeout: 12000, ...(proxyAgent ? { httpsAgent: proxyAgent } : {})
        });
        const match = String(response.data).match(/(?:var )?ytInitialData\s*=\s*({.*?});/s);
        if (!match) throw new Error('YouTube 未返回公开搜索数据');
        return extractYouTubeVideos(JSON.parse(match[1]));
    });
    if (!results.some(r => r.value?.length)) throw new Error('YouTube 公开搜索暂不可用，请检查代理/地区访问或配置 YOUTUBE_API_KEY。');
    const maxAge = require('./lib/video-pipeline').TIME_RANGE_SECONDS[options.timeRange];
    const candidates = results.flatMap(r => r.value || []).filter(video => !maxAge || video.publishedAgeUpperBound !== null && video.publishedAgeUpperBound <= maxAge);
    const list = prepareVideoList(candidates, { timeRange: options.timeRange, limit: 2000 });
    return { list, hasMore: false, source: 'youtube:public-search', partial: results.some(r => r.error),
        scope: { kind: 'search-sample', label: '关键词主题样本 · 近似日期', exhaustive: false, metric: 'views', categoryMethod: 'semantic-search' },
        coverage: { candidates: candidates.length, unique: list.length },
        message: 'YouTube 多关键词主题搜索（非官方分区），按页面播放量排序；近似日期采用保守边界筛选，不是全站榜。精确日期、官方分区与继续翻页需配置 YOUTUBE_API_KEY。' };
}

app.get('/api/platforms', (req, res) => { res.setHeader('Cache-Control','no-store'); res.json({ success:true, list:require('./lib/platform-rankings').capabilities().map(p=>({...p,verification:liveSources.getSourceStatus(p.platform)})) }); });
app.get('/api/system/status', (req, res) => {
    res.setHeader('Cache-Control','no-store');
    return res.json({ success:true, media:mediaJobs.capabilities(), accounts:{ mode:'real-session', publicRoleSwitch:false, dailyLimit:accounts.FREE_LIMIT, timeZone:'Asia/Shanghai', history:'server-owned', signup:true },
        platforms:require('./lib/platform-rankings').capabilities().map(p=>({...p,verification:liveSources.getSourceStatus(p.platform)})),
        note:'配置存在不等于实际验证成功，not-verified表示尚未实测；不宣称全站历史穷举或所有平台已接通' });
});

function liveOptions(req) {
    const { platform = 'bilibili', category = 'all', timeRange = 'all', query = '' } = req.query;
    if (!VALID_PLATFORMS.has(platform) || !VALID_CATEGORIES.has(category) || !VALID_TIME_RANGES.has(timeRange)) {
        throw new Error('筛选参数无效');
    }
    if (typeof query !== 'string' || query.length > 100) throw new Error('关键词应为 100 字以内的文本');
    const cursor = req.query.cursor || '';
    if (typeof cursor !== 'string' || cursor.length > 2000 || /[\r\n]/.test(cursor)) throw new Error('翻页参数无效');
    return { platform, category, timeRange, query: query.trim(), cursor, page: Math.min(10, Math.max(1, parseInt(req.query.page) || 1)), refresh: req.query.refresh === '1' };
}

async function handleLiveVideos(req, res) {
    let options;
    try { options = liveOptions(req); }
    catch (error) { return res.status(400).json({ success: false, message: error.message }); }
    if (req.path === '/api/search' && !options.query) return res.status(400).json({ success: false, message: '请输入搜索关键词' });
    try {
        const result = await liveSources.getVideos(options, fetchYouTubeLive);
        return sendVideoList(res, result.list, options.timeRange, {
            source: result.source, sourceMessage: result.message, partial: result.partial || false,
            hasMore: result.hasMore, nextCursor: result.nextCursor || '', scope: result.scope, coverage: result.coverage, stale: result.stale || false,
            fetchedAt: result.list[0]?.fetchedAt || Date.now()
        });
    } catch (error) {
        return res.status(502).json({ success: false, error: 'LIVE_SOURCE_UNAVAILABLE', list: [], message: error.message });
    }
}

app.get('/api/trends', handleLiveVideos);
app.get('/api/search', handleLiveVideos);
app.get('/api/topics', async (req, res) => {
    let options;
    try { options = liveOptions(req); }
    catch (error) { return res.status(400).json({ success: false, message: error.message }); }
    try {
        const result = await liveSources.getTopics(options);
        const terms = { comedy: ['搞笑', '喜剧'], ent: ['明星', '电影', '综艺', '音乐', '演唱会'], fashion: ['穿搭', '美妆', '时尚'], pets: ['猫', '狗', '宠物'], wildlife: ['野生', '动物', '自然'], tech: ['科技', 'AI', '芯片', '手机', '数码'], marketing: ['商业', '营销', '品牌', '经济'], kuso: ['鬼畜', '神曲', '恶搞'], animal: ['动物', '猫', '狗', '宠物'] };
        const list = result.list.filter(topic => (options.category === 'all' || (terms[options.category] || []).some(t => topic.title.toLowerCase().includes(t.toLowerCase())))
            && (!options.query || topic.title.toLowerCase().includes(options.query.toLowerCase())));
        return res.json({ success: true, list, total: list.length, source: result.source, sourceMessage: result.message,
            timeRangeApplied: false, fetchedAt: list[0]?.fetchedAt || Date.now() });
    } catch (error) { return res.status(error.status || 502).json({ success: false, list: [], message: error.message }); }
});
app.get('/api/search-topic', async (req, res) => {
    let options;
    try { options = liveOptions(req); if (!options.query) throw new Error('缺少话题关键词'); }
    catch (error) { return res.status(400).json({ success: false, message: error.message }); }
    try {
        const result = await liveSources.getVideos(options, fetchYouTubeLive);
        return sendVideoList(res, result.list, options.timeRange, { source: result.source, sourceMessage: result.message, scope: result.scope, coverage: result.coverage, hasMore: false });
    } catch (error) { return res.status(502).json({ success: false, list: [], message: error.message }); }
});
app.get('/api/geo-hotspots', async (req, res) => {
    let options;
    try { options = liveOptions(req); }
    catch (error) { return res.status(400).json({ success: false, message: error.message }); }
    try {
        const result = await liveSources.getVideos(options, fetchYouTubeLive);
        const list = liveSources.aggregateGeo(result.list);
        return res.json({ success: true, list, hotspots: list, cityCount: list.length,
            totalSignals: list.reduce((n, city) => n + city.count, 0), sampleSize: result.list.length,
            method: '当前视频样本中的城市关联（内容识别，不代表作者 IP 属地）', generatedAt: Date.now() });
    } catch (error) { return res.status(502).json({ success: false, list: [], message: error.message }); }
});

// Stream proxy to bypass Referer / CORS restrictions (e.g. Bilibili/Douyin CDNs)
app.get('/api/proxy-video', (req,res,next)=>req.query.download==='1'?authenticate(req,res,next):next(), async (req, res) => {
    const { referer, download } = req.query;
    let { url } = req.query;
    if (!url) return res.status(400).send('No URL provided');
    try {
        url = parseExternalUrl(url).toString();
        if (referer) parseExternalUrl(referer);
    } catch (error) {
        return res.status(400).send(error.message);
    }

    console.log(`[Stream Proxy] Proxying video: ${url.substring(0, 60)}...`);
    try {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        const urlLower = url.toLowerCase();
        if (referer) {
            headers['Referer'] = referer;
        } else if (urlLower.includes('bilibili.com') || urlLower.includes('bilivideo.com')) {
            headers['Referer'] = 'https://www.bilibili.com';
        } else if (urlLower.includes('xiaohongshu.com') || urlLower.includes('xhscdn.com')) {
            headers['Referer'] = 'https://www.xiaohongshu.com';
        } else if (urlLower.includes('kuaishou')) {
            headers['Referer'] = 'https://www.kuaishou.com';
        } else if (urlLower.includes('douyin') || urlLower.includes('snssdk.com')) {
            headers['Referer'] = 'https://www.douyin.com';
        }
        if (req.headers.range) headers.Range = req.headers.range;

        const response = await axios.get(url, {
            ...safeNetwork.mediaOptions(url),
            headers,
            responseType: 'stream',
            timeout: 15000,
            validateStatus: status => status === 200 || status === 206
        });
        res.status(response.status);
        if (/text\/|json/.test(response.headers['content-type'] || '')) { response.data.destroy(); throw new Error('上游返回网页而非可播放媒体'); }
        const contentType = response.headers['content-type'] || 'video/mp4';
        res.setHeader('Content-Type', contentType);
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        res.setHeader('Accept-Ranges', 'bytes');
        if (response.headers['content-range']) {
            res.setHeader('Content-Range', response.headers['content-range']);
        }
        if (download === '1') {
            const ext = resolveMediaExtension(contentType, 'hotpot-media');
            res.setHeader('Content-Disposition', `attachment; filename="hotpot-media${ext}"`);
        }
        res.on('close', () => {
            if (response.data && !response.data.destroyed) {
                response.data.destroy();
            }
        });
        response.data.on('error', (streamErr) => {
            console.warn('[Stream Proxy Pipe] Stream warning:', streamErr.message);
            if (!res.writableEnded) res.destroy(streamErr);
        });
        response.data.pipe(res);
    } catch (err) {
        console.error('[Stream Proxy] Error proxying video stream:', err.message);
        if (!res.headersSent) res.status(502).send('真实媒体流读取失败'); else res.destroy();
    }
});


// Image proxy — bypass hotlink protection for Bilibili, Douyin, and other CDNs
app.get('/api/proxy-image', (req, res, next) => req.query.download === '1' ? authenticate(req, res, next) : next(), async (req, res) => {
    let { url } = req.query;
    if (!url) return res.status(400).send('No URL provided');
    try {
        url = parseExternalUrl(url).toString();
    } catch (error) {
        return res.status(400).send(error.message);
    }

    try {
        let referer = 'https://www.bilibili.com';
        const urlLower = url.toLowerCase();
        if (urlLower.includes('douyin') || urlLower.includes('bytedance') || urlLower.includes('snssdk') || urlLower.includes('byteimg')) {
            referer = 'https://www.douyin.com/';
        } else if (urlLower.includes('xiaohongshu') || urlLower.includes('xhscdn')) {
            referer = 'https://www.xiaohongshu.com/';
        } else if (urlLower.includes('kuaishou') || urlLower.includes('yximgs') || urlLower.includes('kwaicdn')) {
            referer = 'https://www.kuaishou.com/';
        } else if (urlLower.includes('youtube') || urlLower.includes('ytimg')) {
            referer = 'https://www.youtube.com/';
        }

        const response = await axios.get(url, {
            ...safeNetwork.mediaOptions(url),
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': referer,
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            },
            responseType: 'arraybuffer', maxContentLength: 25 * 1024 * 1024,
            timeout: 8000
        });
        const image = Buffer.from(response.data), format = require('./lib/image-format').imageFormat(image);
        if (!format) throw new Error('上游未返回可验证的原始图片文件');
        res.setHeader('Content-Type', format.mime);
        res.setHeader('Cache-Control', 'public, max-age=300');
        if (req.query.download === '1') {
            res.setHeader('Cache-Control', 'private, no-store');
            res.on('finish', () => accounts.store.log(req.user.username, { kind:'image', status:'sent', title:'实际原图 .' + format.ext, url:'' }));
        }
        res.send(image);
    } catch (err) {
        console.warn('[Image Proxy] Cover unavailable:', url.slice(0, 80));
        res.setHeader('Cache-Control', 'no-store');
        if (req.query.download === '1') return res.status(502).json({ success:false, message:'原图获取失败，未用占位封面替代下载' });
        res.setHeader('X-HotPot-Placeholder', '1');
        res.sendFile(path.join(__dirname, 'public', 'cover-placeholder.svg'));
    }
});

// Authentic Real-Time Danmaku API (Official Bilibili XML / CID parser + multi-platform bullet stream)
app.get('/api/danmaku', async (req, res) => {
    const { bvid, id, cid } = req.query;
    let targetCid = cid;
    let targetBvid = bvid || id;

    try {
        if (!targetCid && targetBvid && (targetBvid.startsWith('BV') || targetBvid.startsWith('av') || targetBvid.includes('BV'))) {
            const cleanBvid = targetBvid.match(/(BV[a-zA-Z0-9]+)/i)?.[1] || targetBvid;
            const viewRes = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${cleanBvid}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://www.bilibili.com' },
                timeout: 5000
            });
            if (viewRes.data?.code === 0 && viewRes.data?.data?.cid) {
                targetCid = viewRes.data.data.cid;
            }
        }

        if (targetCid) {
            const dmRes = await axios.get(`https://comment.bilibili.com/${targetCid}.xml`, {
                responseType: 'text',
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                timeout: 6000
            });

            const regex = /<d p="([^"]+)">([^<]+)<\/d>/g;
            let match;
            const danmakus = [];
            while ((match = regex.exec(dmRes.data)) !== null && danmakus.length < 800) {
                const [time, type, size, color] = match[1].split(',');
                const text = match[2].trim();
                if (text && !text.includes('xml version')) {
                    danmakus.push({
                        time: parseFloat(time) || 0,
                        text,
                        color: '#' + (parseInt(color) || 16777215).toString(16).padStart(6, '0')
                    });
                }
            }
            if (danmakus.length > 0) {
                danmakus.sort((a, b) => a.time - b.time);
                return res.json({ success: true, count: danmakus.length, list: danmakus, source: 'bilibili_live' });
            }
        }
    } catch (e) {
        console.warn('[Danmaku API] Bilibili fetch error:', e.message);
    }

    // 2. Real Douyin Comments Parser
    const awemeId = (targetBvid && /^\d+$/.test(targetBvid)) ? targetBvid : (id && /^\d+$/.test(id) ? id : null);
    if (awemeId) {
        try {
            const dyRes = await axios.get(`https://www.iesdouyin.com/web/api/v2/comment/list/?aweme_id=${awemeId}&count=40`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15',
                    'Referer': 'https://www.douyin.com/'
                },
                timeout: 5000
            });
            const rawComments = dyRes.data?.comments || [];
            if (rawComments.length > 0) {
                const dyDanmakus = rawComments.map((c, idx) => ({
                    time: idx * 1.8 + (idx % 3) * 0.5,
                    text: c.text,
                    color: c.digg_count > 100 ? '#f59e0b' : '#ffffff'
                }));
                return res.json({ success: true, count: dyDanmakus.length, list: dyDanmakus, source: 'douyin_real_comments' });
            }
        } catch (dyErr) {
            console.warn('[Danmaku API] Douyin comments fetch warning:', dyErr.message);
        }
    }

    // Authentic clean response: if no platform comments found, return empty array (no fabricated fake comments)
    return res.json({ success: true, count: 0, list: [], source: 'empty' });
});

// Title-only requests cannot produce a transcript or video-content analysis.
app.post('/api/analyze', authenticate, handleMediaJob);
app.post('/api/transcript', authenticate, (req, res) => { req.body ||= {}; req.body.kind = 'transcript'; return handleMediaJob(req, res); });



if (require.main === module) {
    let server;
    detectProxy().then(()=>{ server = app.listen(PORT, process.env.HOST || '127.0.0.1', () => {
        console.log(`[万热观象 | Heat Hub] Server is running at http://localhost:${PORT}`);
    }); });
    async function stop() { mediaJobs.shutdown(); await liveSources.closeBrowser(); if(server)server.close(() => process.exit(0)); else process.exit(0); }
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
}

app.resolveMediaExtension = resolveMediaExtension;
module.exports = app;
