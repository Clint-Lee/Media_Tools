const assert = require('assert');
const {
    extractUrlFromText,
    resolveAntiHotlinkingHeaders,
    recordParseSuccess,
    getTodayParseStats,
    unifiedParse
} = require('../lib/downloader-core');

async function runDownloaderTests() {
    console.log('[Test] Running Downloader Core Unit Tests...');

    // 1. extractUrlFromText
    const rawShareText = '7.54 08/29 p@c.OP oqu:/ 44964648785 复制此链接，打开抖音搜索，直接观看视频！ https://v.douyin.com/idk1234/ 精彩视频';
    const extracted = extractUrlFromText(rawShareText);
    assert.strictEqual(extracted, 'https://v.douyin.com/idk1234/', 'Should extract clean URL from complex share text');

    // 2. resolveAntiHotlinkingHeaders
    const bHeaders = resolveAntiHotlinkingHeaders('https://xy123.bilivideo.com/video.mp4', 'https://www.bilibili.com/video/BV1xx411c7mD');
    assert.ok(bHeaders['Referer'].includes('bilibili.com'), 'Bilibili streams must have Bilibili Referer');

    const dyHeaders = resolveAntiHotlinkingHeaders('https://aweme.snssdk.com/aweme/v1/play/?video_id=123');
    assert.strictEqual(dyHeaders['Referer'], undefined, 'Douyin snssdk streams must not have Referer');
    assert.ok(dyHeaders['User-Agent'].includes('iPhone') || dyHeaders['User-Agent'].includes('iPad'), 'Douyin streams must use mobile UA');

    // 3. Stats recording
    const prevStats = getTodayParseStats();
    recordParseSuccess('douyin');
    const newStats = getTodayParseStats();
    assert.strictEqual(newStats.totalCount, prevStats.totalCount + 1, 'Today total count should increment');
    assert.strictEqual(newStats.platforms.douyin, prevStats.platforms.douyin + 1, 'Douyin platform count should increment');

    // 4. verifyXiaohongshuMedia with real HTTP mock responses
    const http = require('http');
    const { verifyXiaohongshuMedia, parseXiaohongshu } = require('../lib/downloader-core');
    let mockMode = 'valid_video';
    const server = http.createServer((req, res) => {
        if (mockMode === 'valid_video') {
            res.writeHead(200, {
                'Content-Type': 'video/mp4',
                'Content-Length': '1024'
            });
            if (req.method !== 'HEAD') {
                res.write(Buffer.alloc(1024));
            }
            res.end();
        } else if (mockMode === 'html_error') {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8'
            });
            res.end('<html><body>Error: Shield Blocked</body></html>');
        } else if (mockMode === 'forbidden') {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden');
        }
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const mockUrl = `http://127.0.0.1:${port}/test.mp4`;

    try {
        // Test valid media
        mockMode = 'valid_video';
        const verifyRes = await verifyXiaohongshuMedia(mockUrl);
        assert.strictEqual(verifyRes.ok, true, 'Valid video stream must pass verification');
        assert.strictEqual(verifyRes.contentType, 'video/mp4');

        // Test rejection on HTML response (anti-bot page disguised as 200)
        mockMode = 'html_error';
        await assert.rejects(
            () => verifyXiaohongshuMedia(mockUrl),
            /网页或JSON而非实际视频流/,
            'HTML response must be rejected by verifyXiaohongshuMedia'
        );

        // Test rejection on HTTP 403
        mockMode = 'forbidden';
        await assert.rejects(
            () => verifyXiaohongshuMedia(mockUrl),
            /status code 403/,
            'HTTP 403 must fail verification'
        );

        // Test rejection on empty/invalid url
        await assert.rejects(
            () => verifyXiaohongshuMedia(''),
            /未提供有效的小红书视频流地址/
        );
    } finally {
        server.close();
    }

    // 5. parseXiaohongshu integration with mocked note
    const redPublic = require('../lib/red-public');
    const origGetWithBrowser = redPublic.getWithBrowser;
    try {
        // Mock getWithBrowser returning video note with EF4 stream
        redPublic.getWithBrowser = async () => ({
            note: {
                title: '测试小红书视频',
                desc: '视频描述文本',
                type: 'video',
                interactInfo: { likedCount: '1234', commentCount: 0, shareCount: 8, collectedCount: '20' },
                user: { nickname: '测试博主', avatar: 'https://ci.xiaohongshu.com/avatar.jpg' },
                imageList: [{ urlDefault: 'https://ci.xiaohongshu.com/cover.jpg' }],
                video: {
                    media: {
                        stream: {
                            EF4: [{ master_url: 'https://sns-video-hw.xhscdn.com/real.mp4' }]
                        }
                    }
                }
            }
        });

        // Test with SKIP_MEDIA_PROBE=1 for offline unit test
        process.env.SKIP_MEDIA_PROBE = '1';
        const parsed = await parseXiaohongshu('https://www.xiaohongshu.com/explore/64a123456789012345678901');
        assert.strictEqual(parsed.success, true);
        assert.strictEqual(parsed.data.platform, 'xiaohongshu');
        assert.strictEqual(parsed.data.noteType, 'video');
        assert.strictEqual(parsed.data.originDownloadVideoUrl, 'https://sns-video-hw.xhscdn.com/real.mp4');
        assert.ok(parsed.data.downloadVideoUrl.includes('/api/download?url='));
        assert.ok(parsed.data.playVideoUrl.includes('/api/play?url='));
        assert.strictEqual(parsed.data.likeRaw, 1234, '笔记实际点赞不能在统一解析层丢失');
        assert.strictEqual(parsed.data.commentCount, 0);
        assert.strictEqual(parsed.data.playRaw, null, '只有互动数不能冒充播放');

        // Test image note
        redPublic.getWithBrowser = async () => ({
            note: {
                title: '测试图文笔记',
                type: 'normal',
                user: { nickname: '图文博主' },
                imageList: [{ urlDefault: 'https://ci.xiaohongshu.com/img1.jpg' }]
            }
        });
        const parsedImg = await parseXiaohongshu('https://www.xiaohongshu.com/explore/64a123456789012345678902');
        assert.strictEqual(parsedImg.data.noteType, 'image');
        assert.strictEqual(parsedImg.data.images.length, 1);

        // Test error when video URL is missing
        redPublic.getWithBrowser = async () => ({
            note: {
                title: '无视频流笔记',
                type: 'video',
                video: { media: { stream: { EF4: [] } } }
            }
        });
        await assert.rejects(
            () => parseXiaohongshu('https://www.xiaohongshu.com/explore/64a123456789012345678903'),
            /没有返回对应的视频地址/
        );
    } finally {
        redPublic.getWithBrowser = origGetWithBrowser;
        delete process.env.SKIP_MEDIA_PROBE;
    }

    console.log('[Test] Downloader Core Unit Tests Passed Successfully! ✅');
}

runDownloaderTests().catch(err => {
    console.error('[Test Failed]:', err);
    process.exit(1);
});
