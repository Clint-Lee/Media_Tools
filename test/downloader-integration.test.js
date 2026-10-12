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

    console.log('[Test] Downloader Core Unit Tests Passed Successfully! ✅');
}

runDownloaderTests().catch(err => {
    console.error('[Test Failed]:', err);
    process.exit(1);
});
