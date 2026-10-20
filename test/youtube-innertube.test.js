'use strict';
// YouTube innertube 公开检索 + TikTok 详情页播放量：隔离测试，不联网。
const assert = require('node:assert/strict');
const innertube = require('../lib/youtube-innertube');
const tiktokViews = require('../lib/tiktok-views');

// ── 1) parseViewText：平台展示的观看计数文本
{
    const exact = innertube.parseViewText('58,212,419次观看');
    assert.equal(exact.value, 58212419);
    assert.equal(exact.precision, 'integer');
    const rounded = innertube.parseViewText('1.2M views');
    assert.equal(rounded.value, 1200000);
    assert.equal(rounded.precision, 'source-rounded');
    const wan = innertube.parseViewText('3.4万次观看');
    assert.equal(wan.value, 34000);
    assert.equal(innertube.parseViewText('').value, null);
    assert.equal(innertube.parseViewText('No views').value, null);
    // 逗号与全角逗号都要处理
    assert.equal(innertube.parseViewText('1,234,567 views').value, 1234567);
    assert.equal(innertube.parseViewText('1，234，567 views').value, 1234567);
    console.log('✓ parseViewText: 精确计数、缩写计数、空值与无效文本');
}

// ── 2) innertubeVideo：字段提取与身份核验
{
    const renderer = {
        videoId: 'G5xSLbYMr-I',
        title: { runs: [{ text: 'Sunroof (Official' }, { text: ' Music Video)' }] },
        viewCountText: { simpleText: '209,277,527 views' },
        publishedTimeText: { simpleText: '4 years ago' },
        lengthText: { simpleText: '2:55' },
        ownerText: { runs: [{ text: 'Nicky Youre' }] },
        thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/G5xSLbYMr-I/hq.jpg' }] }
    };
    const video = innertube.innertubeVideo(renderer, 1790000000000);
    assert.equal(video.id, 'G5xSLbYMr-I');
    assert.equal(video.title, 'Sunroof (Official Music Video)');
    assert.equal(video.playRaw, 209277527);
    assert.equal(video.author, 'Nicky Youre');
    assert.equal(video.duration, '2:55');
    assert.equal(video.viewEvidence.status, 'verified');
    assert.equal(video.viewSource, 'youtube:innertube-search');
    assert.equal(video.publishedDisplay, '4 years ago');
    assert.ok(video.pubdate > 0, '相对时间只用于时效筛选');
    assert.equal(video.datePrecision, 'approximate', '相对时间不得标成精确发布日期');
    // 缺失观看计数时保持未知
    const noViews = innertube.innertubeVideo({ videoId: 'G5xSLbYMr-I', title: { simpleText: 'x' } }, 1790000000000);
    assert.equal(noViews.playRaw, null);
    assert.equal(noViews.viewEvidence.status, 'not-provided');
    // ID 不合法必须丢弃
    assert.equal(innertube.innertubeVideo({ videoId: 'short' }, 0), null);
    assert.equal(innertube.innertubeVideo({}, 0), null);
    // 秒数字符串与 ISO8601 时长
    assert.equal(innertube.innertubeVideo({ videoId: 'G5xSLbYMr-I', lengthText: { simpleText: '175' } }, 0).duration, '2:55');
    assert.equal(innertube.innertubeVideo({ videoId: 'G5xSLbYMr-I', lengthText: { simpleText: 'PT2M55S' } }, 0).duration, '2:55');
    console.log('✓ innertubeVideo: 字段提取、未知计数、身份核验、时长格式');
}

// ── 3) searchInPage：请求体格式（用假 page 验证参数传递）
async function testSearchInPage() {
    let captured = null;
    const page = {
        evaluate: async (fn, arg) => { captured = arg; return { status: 200, data: { contents: [] } }; }
    };
    const result = await innertube.searchInPage(page, { query: 'music', params: 'CAMSAhAB' });
    assert.equal(result.status, 200);
    assert.deepEqual(captured, { query: 'music', params: 'CAMSAhAB', continuation: null });
    assert.equal(innertube.POPULAR_FILTER, 'CAMSAhAB', '按播放量排序的过滤器必须保持');
    console.log('✓ searchInPage: 参数传递与播放量排序过滤器');
}

// ── 4) createClient.search：空结果明确报错
async function testSearchEmpty() {
    const client = innertube.createClient({
        withPage: async (platform, worker) => worker({
            goto: async () => {},
            evaluate: async () => ({ status: 200, data: { contents: [] } })
        })
    });
    await assert.rejects(() => client.search({ query: 'music', category: 'all', timeRange: 'all', page: 1 }), /未返回可核验作品/);
    console.log('✓ createClient.search: 空结果明确报错，不返回假装成功的空列表');
}

(async () => {
    await testSearchInPage();
    await testSearchEmpty();

    // ── 5) TikTok apply：详情页计数覆盖近似值
    {
        const client = tiktokViews.createClient({ withPage: async () => ({}), now: () => 3000 });
        const list = [
            { id: '7664782256527002901', platform: 'tiktok', playRaw: 127700000, fetchedAt: 1000 },
            { id: '7665376071667240212', platform: 'tiktok', playRaw: 46600000, fetchedAt: 1000 }
        ];
        const applied = client.apply(list);
        assert.equal(applied[0].playRaw, 127700000, '无缓存行时保持原值');
        assert.equal(applied[1].playRaw, 46600000);
        console.log('✓ TikTok apply: 无缓存行时保持原值');
    }

    // ── 6) capabilities：YouTube 免 key 数据源如实标注
    {
        const caps = require('../lib/platform-rankings').capabilities();
        const youtube = caps.find(c => c.platform === 'youtube');
        assert.ok(youtube.sources.includes('youtube:innertube-search'), '必须列出 innertube 来源');
        assert.ok(youtube.sources.includes('youtube:public-watch'), '必须保留 watch 页详情来源');
        assert.match(youtube.label, /innertube/);
        console.log('✓ capabilities: YouTube innertube 来源如实标注');
    }

    console.log('\nYouTube innertube + TikTok view tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

