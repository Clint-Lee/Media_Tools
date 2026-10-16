'use strict';

const fs = require('fs'), path = require('path');
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:4000';
const platforms = ['bilibili', 'douyin', 'youtube', 'tiktok', 'twitter', 'xiaohongshu', 'kuaishou'];

(async () => {
    const report = { checkedAt: new Date().toISOString(), platforms: [] };
    let cursor = 0;
    await Promise.all(Array.from({ length: 2 }, async () => {
        while (cursor < platforms.length) {
            const platform = platforms[cursor++], started = Date.now();
            let row;
            try {
                const response = await fetch(base + '/api/trends?' + new URLSearchParams({ platform, category: 'all', timeRange: 'all', refresh: '1' }), { signal: AbortSignal.timeout(65000) });
                const data = await response.json(), list = data.list || [];
                const withViews = list.filter(v => Number.isFinite(v.playRaw) && v.playRaw >= 0).length;
                const metadata = list.filter(v => v.id && v.title && v.url && v.cover).length;
                const freshVideos = list.filter(v => !v.isCached && v.fetchedAt >= started - 1000).length;
                row = { platform, status: response.status, videos: list.length, withViews, withoutViews: list.length - withViews,
                    completeMetadata: metadata, freshVideos, source: data.source, stale: Boolean(data.stale), partial: Boolean(data.partial),
                    passed: response.ok && data.success === true && list.length > 0 && withViews === list.length && metadata === list.length && freshVideos > 0,
                    message: data.message || data.sourceMessage || '' };
            } catch (error) { row = { platform, passed: false, message: error.message }; }
            row.ms = Date.now() - started; report.platforms.push(row); console.log(JSON.stringify(row));
        }
    }));
    report.passed = report.platforms.length === platforms.length && report.platforms.every(row => row.passed);
    const target = path.join(__dirname, '..', '.cache', 'verification', 'platform-data.json');
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(report, null, 2));
    if (!report.passed) { console.error('未通过全平台真实视频/播放量验收：' + report.platforms.filter(row => !row.passed).map(row => row.platform).join(', ')); process.exitCode = 1; }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
