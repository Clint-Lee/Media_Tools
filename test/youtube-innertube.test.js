'use strict';
// YouTube innertube 公开检索 + TikTok 详情页播放量：隔离测试，不联网。
const assert = require('node:assert/strict');
const innertube = require('../lib/youtube-innertube');
const tiktokViews = require('../lib/tiktok-views');
const { prepareVideoList } = require('../lib/video-pipeline');
const ranking = require('../public/ranking');
const { searchFilter } = require('../lib/youtube-search');

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
    assert.equal(innertube.parseViewText('No views').value, 0, '平台明确无播放属于真实零值');
    assert.deepEqual(innertube.parseViewText('1.2M+ views'), { value: null, precision: 'lower-bound', text: '1.2M+ views', lowerBound: 1200000 });
    for (const invalid of ['-12 views', 'about 120 views', '123 views yesterday', '1,23 views', '123 likes']) {
        assert.equal(innertube.parseViewText(invalid).value, null, invalid + '不能部分提取数字');
    }
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
    assert.equal(video.datePrecision, 'relative', '相对时间使用UI可识别的精度枚举');
    assert.equal(video.publishedAgeUpperBound, 5 * 365 * 86400);
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

function fakeSearch(renderers) {
    const calls = [];
    const client = innertube.createClient({
        now: () => 1790000000000,
        withPage: async (platform, worker, options) => {
            assert.equal(platform, 'youtube');
            assert.equal(options.anonymous, true);
            return worker({
                goto: async url => assert.equal(url, 'https://www.youtube.com/'),
                evaluate: async (fn, arg) => {
                    calls.push(arg);
                    return { status: 200, data: { contents: renderers.map(videoRenderer => ({ videoRenderer })) } };
                }
            });
        }
    });
    return { client, calls };
}
function fixture(id, title, views = '123 views', published = '1 day ago') {
    return { videoId: id, title: { simpleText: title }, viewCountText: { simpleText: views }, publishedTimeText: { simpleText: published } };
}

async function testSearchContracts() {
    const fake = fakeSearch([
        fixture('G5xSLbYMr-I', 'cute pets cat', '1.2M views'),
        fixture('G5xSLbYMr-J', 'cute pets puppy', '1.2M+ views'),
        fixture('G5xSLbYMr-K', 'Unrelated Music Video', '9999999 views')
    ]);
    const result = await fake.client.search({ category: 'pets', timeRange: '3days', page: 1 });
    assert.equal(fake.calls[0].query, 'pets', '分类必须进入平台请求');
    assert.equal(fake.calls[0].params, searchFilter('3days'));
    assert.equal(result.hasMore, false);
    assert.equal(result.nextCursor, '');
    assert.equal(result.scope.exhaustive, false);
    assert.deepEqual(result.list.map(video => video.id), ['G5xSLbYMr-I', 'G5xSLbYMr-J']);
    const [rounded, bounded] = prepareVideoList(result.list, { now: 1790000000 });
    assert.equal(rounded.playRaw, 1200000);
    assert.equal(rounded.viewPrecision, 'source-rounded');
    assert.equal(rounded.viewCountText, '1.2M views');
    assert.equal(bounded.playRaw, null);
    assert.equal(bounded.viewPrecision, 'lower-bound');
    assert.equal(bounded.viewLowerBound, 1200000);
    assert.equal(bounded.viewCountText, '1.2M+ views');
    assert.equal(ranking.summary(result.list).ranked, 1, '下界不参与播放名次');
    assert.equal(result.coverage.unique, 2);

    const unmatched = fakeSearch([fixture('G5xSLbYMr-I', 'Unrelated Music Video')]);
    assert.deepEqual((await unmatched.client.search({ category: 'pets' })).list, [], '零命中不能回填无关作品');
    assert.deepEqual((await unmatched.client.search({ category: 'all', query: 'not-in-result' })).list, [], '关键词也不能被零命中回退取消');
    await unmatched.client.search({ category: 'tech', query: 'robot' });
    assert.equal(unmatched.calls.at(-1).query, 'robot science and technology');
    const before = unmatched.calls.length;
    await assert.rejects(() => unmatched.client.search({ page: 2 }), /尚未接通可靠的继续翻页/);
    await assert.rejects(() => unmatched.client.search({ page: 1, cursor: 'not-supported' }), /尚未接通可靠的继续翻页/);
    assert.equal(unmatched.calls.length, before, '不支持翻页时不得重复抓首批');
    const expectedTerms = { comedy: 'comedy', ent: 'entertainment', fashion: 'fashion', pets: 'pets', wildlife: 'wildlife', animal: 'animals', tech: 'science and technology', marketing: 'business marketing', kuso: 'meme remix' };
    for (const [category, term] of Object.entries(expectedTerms)) {
        await unmatched.client.search({ category });
        assert.equal(unmatched.calls.at(-1).query, term, category + '需保留分类意图');
    }
    console.log('✓ createClient.search: 生产调用形态、分类零命中、成品精度和明确禁止伪分页');
}

async function testTimeBoundaries() {
    const expectedUploads = { today: 2, '3days': 3, '7days': 3, '1month': 4, '6months': 5 };
    for (const [range, upload] of Object.entries(expectedUploads)) {
        assert.deepEqual([...Buffer.from(innertube.UPLOAD_FILTERS[range], 'base64')], [8, 3, 18, 4, 8, upload, 16, 1], range + '需同时保留播放排序、上传窗口、视频类型');
    }
    const cases = [
        ['3days', '2 days ago', '3 days ago'],
        ['7days', '6 days ago', '1 week ago'],
        ['1month', '3 weeks ago', '4 weeks ago'],
        ['6months', '5 months ago', '6 months ago']
    ];
    for (const [timeRange, safe, ambiguous] of cases) {
        const fake = fakeSearch([
            fixture('G5xSLbYMr-I', 'safe sample', '123 views', safe),
            fixture('G5xSLbYMr-J', 'ambiguous sample', '123 views', ambiguous),
            fixture('G5xSLbYMr-K', 'unknown date', '123 views', '')
        ]);
        const result = await fake.client.search({ timeRange });
        assert.deepEqual(result.list.map(video => video.id), ['G5xSLbYMr-I'], timeRange + '排除未知和可能跨界日期');
        assert.equal(fake.calls[0].params, searchFilter(timeRange));
        assert.equal(result.list[0].datePrecision, 'relative');
    }
    console.log('✓ 时间筛选: 请求protobuf与3/7/30/180天保守边界');
}

(async () => {
    await testSearchInPage();
    await testSearchEmpty();
    await testSearchContracts();
    await testTimeBoundaries();

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

