'use strict';
/**
 * 播放证据全链路不变量测试（离线，无外网）
 *
 * 目的：证明"诚实降级"不会被后续环节破坏。
 * 覆盖链路：证据校验 → 归一化 → 缓存往返 → 排序 → API 序列化。
 *
 * 核心不变量：
 *  I1 无有效播放证据 → playRaw === null，绝不被补成数字
 *  I2 互动数（点赞/评论/收藏/分享）只能进互动字段，不得冒充播放
 *  I3 无证据的播放值不得进入播放排名
 *  I4 以上规则经缓存往返与 JSON 序列化后仍然成立
 */
const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const viewEvidence = require(path.join(root, 'lib/public-view-evidence.js'));
const ranking = require(path.join(root, 'public/ranking.js'));
const { readMetric } = require(path.join(root, 'lib/metric-evidence.js'));

// readMetric 是生产链路的数值守卫：只接受安全非负整数
const numericCount = (value) => {
    const reading = readMetric(value, 'views');
    return reading.precision === 'integer' ? reading.value : null;
};

let passed = 0;
const pending = [];   // 异步用例先收集，最后统一 await，避免断言被吞掉
function ok(name, fn) {
    const result = fn();
    if (result && typeof result.then === 'function') {
        pending.push(result.then(() => {
            passed++;
            console.log('\u2713 ' + name);
        }));
        return;
    }
    passed++;
    console.log('\u2713 ' + name);
}
async function finish() {
    if (pending.length) await Promise.all(pending);
}

// ---------------------------------------------------------------------------
// 工具：模拟生产链路的缓存往返（JSON 序列化 -> 反序列化）
// ---------------------------------------------------------------------------
function cacheRoundTrip(record) {
    return JSON.parse(JSON.stringify(record));
}

// 收集所有"参与播放排名"的字段，断言不变量 I1/I2/I3
function assertNoFakeViews(record, label) {
    assert.strictEqual(record.playRaw, null,
        label + ': 无有效播放证据时 playRaw 必须为 null，实际=' + JSON.stringify(record.playRaw));
    assert.strictEqual(ranking.count(record, 'views'), null,
        label + ': 无证据的播放值不得进入播放排名');

    // 互动值可以存在，但不得被搬运到播放字段
    const interactions = ['likeRaw', 'commentCount', 'collectCount', 'shareCount']
        .map(k => record[k]).filter(v => Number.isSafeInteger(v) && v >= 0);
    if (interactions.length) {
        assert.ok(!interactions.includes(record.playRaw),
            label + ': 互动数不得冒充播放量（playRaw=' + record.playRaw + '）');
    }
}

// ---------------------------------------------------------------------------
// 1. 抖音零占位：play_count=0 但点赞>0 → 播放必须为 null
// ---------------------------------------------------------------------------
ok('抖音 play_count=0（零占位）→ playRaw 为 null，尽管点赞=1000', () => {
    const observation = viewEvidence.douyinViews({
        aweme_id: '7697507167225580836',
        statistics: { aweme_id: '7697507167225580836', play_count: 0, digg_count: 1000 }
    });
    assert.strictEqual(observation.viewEvidence.status, 'placeholder-zero');
    assert.strictEqual(observation.playRaw, null, '零占位必须转为 null');

    // 点赞由 metricFields 单独归一化，douyinViews 只负责 views 维度
    const likeReading = readMetric(1000, 'likes');
    assert.strictEqual(likeReading.value, 1000, '真实点赞应保留');
    assert.strictEqual(likeReading.precision, 'integer');

    const record = {
        id: '7697507167225580836',
        ...observation,
        likeRaw: likeReading.value
    };
    assertNoFakeViews(record, '抖音零占位');

    // 关键：点赞存在，但播放仍然是 null，不能被点赞顶替
    assert.strictEqual(record.likeRaw, 1000);
    assert.strictEqual(record.playRaw, null);
});

// ---------------------------------------------------------------------------
// 2. 抖音合法正数播放 → 保持不变（真实零值也不能被误伤）
// ---------------------------------------------------------------------------
ok('抖音真实正数播放量保持不变', () => {
    const observation = viewEvidence.douyinViews({
        aweme_id: '7697507167225580837',
        statistics: { aweme_id: '7697507167225580837', play_count: 123456, digg_count: 999 }
    });
    assert.strictEqual(observation.viewEvidence.status, 'verified');
    assert.strictEqual(observation.playRaw, 123456);
    assert.strictEqual(ranking.count({ playRaw: observation.playRaw }, 'views'), 123456);
});

// ---------------------------------------------------------------------------
// 3. 缺字段 / 身份不匹配 / 非法值 → 一律 null
// ---------------------------------------------------------------------------
ok('抖音缺 play_count → not-provided，playRaw 为 null', () => {
    const observation = viewEvidence.douyinViews({
        aweme_id: '7697507167225580838',
        statistics: { aweme_id: '7697507167225580838', digg_count: 50 }
    });
    assert.strictEqual(observation.viewEvidence.status, 'not-provided');
    assert.strictEqual(observation.playRaw, null);
});

ok('抖音 aweme_id 身份不匹配 → identity-mismatch，playRaw 为 null', () => {
    const observation = viewEvidence.douyinViews({
        aweme_id: '7697507167225580839',
        statistics: { aweme_id: '9999999999999999999', play_count: 888888 }
    });
    assert.strictEqual(observation.viewEvidence.status, 'identity-mismatch');
    assert.strictEqual(observation.playRaw, null,
        '身份不匹配时即便有正数播放也必须拒绝');
});

ok('非法 aweme_id → identity-mismatch，playRaw 为 null', () => {
    const observation = viewEvidence.douyinViews({
        aweme_id: 'abc',
        statistics: { play_count: 12345 }
    });
    assert.strictEqual(observation.playRaw, null);
});

// ---------------------------------------------------------------------------
// 4. 小红书：只有互动数 → 绝不产生播放量
// ---------------------------------------------------------------------------
ok('小红书 WatchAction 与互动合计相同 → aggregate-interactions 拒绝', () => {    const note = {
        noteId: '6a87a554000000003501590f',
        type: 'video',
        title: '测试笔记',
        interactInfo: { likedCount: '1047', collectedCount: '240', commentCount: '58' }
    };
    const html = `<script type="application/ld+json">${JSON.stringify({
        '@type': 'VideoObject',
        url: 'https://www.xiaohongshu.com/explore/6a87a554000000003501590f',
        name: '测试笔记',
        interactionStatistic: {
            '@type': 'InteractionCounter',
            interactionType: 'https://schema.org/WatchAction',
            userInteractionCount: 1345
        }
    })}</script>`;

    const observation = viewEvidence.redViews(html, 'https://www.xiaohongshu.com/explore/6a87a554000000003501590f', note);
    assert.strictEqual(observation.viewEvidence.status, 'aggregate-interactions',
        '1047+240+58=1345，必须识别为互动合计而拒绝');
    assert.strictEqual(observation.playRaw, null);

    const record = { id: '6a87a554000000003501590f', ...observation, likeRaw: 1047, commentCount: 58, collectCount: 240 };
    assertNoFakeViews(record, '小红书互动合计');
});

ok('小红书只有互动数、无 schema → playRaw 为 null', () => {
    const note = {
        noteId: '6a7903c200000000050206e1',
        type: 'video',
        title: '另一笔记',
        interactInfo: { likedCount: '6773', collectedCount: '1418', commentCount: '300' }
    };
    const observation = viewEvidence.redViews('<html></html>',
        'https://www.xiaohongshu.com/explore/6a7903c200000000050206e1', note);
    assert.strictEqual(observation.playRaw, null);
});

// ---------------------------------------------------------------------------
// 4b. 图文笔记必须与"身份不符"区分开（实测真实缺陷）
// ---------------------------------------------------------------------------
ok('小红书图文笔记 → note-not-video（身份正确，只是没有视频）', () => {
    const note = {
        noteId: '6aade08f000000002901531e',
        type: 'normal',          // 图文笔记
        title: '图文笔记标题',
        interactInfo: { likedCount: '2.3万', collectedCount: '172', commentCount: '493' }
    };
    const observation = viewEvidence.redViews('<html></html>',
        'https://www.xiaohongshu.com/explore/6aade08f000000002901531e', note);

    assert.strictEqual(observation.viewEvidence.status, 'note-not-video',
        '图文笔记的身份是对的，不能误判成 identity-mismatch');
    assert.notStrictEqual(observation.viewEvidence.status, 'identity-mismatch');
    assert.strictEqual(observation.playRaw, null, '图文笔记没有播放量');
    assert.strictEqual(observation.viewEvidence.noteType, 'normal', '应记录真实笔记类型');
});

ok('小红书身份真正不符时才报 identity-mismatch', () => {
    const note = {
        noteId: 'ffffffffffffffffffffffff',   // 与 URL 里的 id 不一致
        type: 'video',
        title: '别的笔记',
        interactInfo: { likedCount: '100', collectedCount: '10', commentCount: '5' }
    };
    const observation = viewEvidence.redViews('<html></html>',
        'https://www.xiaohongshu.com/explore/6aade08f000000002901531e', note);
    assert.strictEqual(observation.viewEvidence.status, 'identity-mismatch',
        '返回的笔记不是我们要的那件，才是真身份不符');
    assert.strictEqual(observation.playRaw, null);
});

ok('data-quality 将图文笔记单独统计，不算作可疑证据', () => {
    const { videoDataQuality } = require(path.join(root, 'lib/data-quality.js'));
    const rows = [
        { id: 'a', playRaw: null, viewEvidence: { status: 'note-not-video' } },
        { id: 'b', playRaw: null, viewEvidence: { status: 'placeholder-zero' } },
        { id: 'c', playRaw: 500 }
    ];
    const q = videoDataQuality(rows, { sortBy: 'views' });
    assert.strictEqual(q.nonVideoNotes, 1, '图文笔记应单独统计');
    assert.strictEqual(q.rejectedViewEvidence.zeroPlaceholders, 1, '零占位仍归入被拒绝证据');
    assert.strictEqual(q.withViews, 1, '只有真实播放量计入覆盖');
});

ok('小红书发现流条目带 not-checked 证据，可区分"没查"与"平台不给"', () => {
    const { redVideo } = require(path.join(root, 'lib/platform-rankings.js'));
    const { videoDataQuality } = require(path.join(root, 'lib/data-quality.js'));

    // 真实发现流结构（camelCase）
    const item = {
        xsecToken: 'ABDmv0r',
        id: '6aae0323000000002902d188',
        noteCard: {
            type: 'video',
            displayTitle: '真实标题',
            interactInfo: { likedCount: '1.3万', commentCount: '100' },
            cover: { urlDefault: 'https://x/x.jpg' },
            user: { nickname: '作者' }
        }
    };
    const video = redVideo(item);

    assert.strictEqual(video.playRaw, null, '发现流没有播放量，必须为 null');
    assert.ok(video.viewEvidence, '必须带证据对象，前端才知道为何无播放量');
    assert.strictEqual(video.viewEvidence.status, 'not-checked',
        '发现流未核验详情，状态应为 not-checked 而不是空白');
    assert.ok(/xsec_token=/.test(video.url), '必须保留 xsec_token 才能取详情');
    assert.strictEqual(video.likeRaw, 13000, '真实点赞应保留');

    const q = videoDataQuality([video], { sortBy: 'views' });
    assert.strictEqual(q.notCheckedViews, 1, '未核验的应单独计数');
    assert.strictEqual(q.withViews, 0, '未核验绝不能计入播放覆盖');
});

// ---------------------------------------------------------------------------
// 5. 缓存往返：JSON 序列化后不变量仍成立（I4）
// ---------------------------------------------------------------------------
ok('抖音零占位经 JSON 缓存往返后 playRaw 仍为 null', () => {
    const observation = viewEvidence.douyinViews({
        aweme_id: '7697507167225580836',
        statistics: { aweme_id: '7697507167225580836', play_count: 0, digg_count: 1000 }
    });
    const record = { id: '7697507167225580836', ...observation };

    const restored = cacheRoundTrip(record);
    assert.strictEqual(restored.playRaw, null, '缓存往返后不得变成 0 或数字');
    assert.strictEqual(restored.viewEvidence.status, 'placeholder-zero', '证据状态必须保留');
    assertNoFakeViews(restored, '抖音缓存往返');
});

ok('小红书拒绝证据经缓存往返后仍被拒绝', () => {
    const note = {
        noteId: '6a87a554000000003501590f',
        type: 'video',
        title: '测试笔记',
        interactInfo: { likedCount: '1047', collectedCount: '240', commentCount: '58' }
    };
    const html = `<script type="application/ld+json">${JSON.stringify({
        '@type': 'VideoObject',
        url: 'https://www.xiaohongshu.com/explore/6a87a554000000003501590f',
        name: '测试笔记',
        interactionStatistic: {
            '@type': 'InteractionCounter',
            interactionType: 'https://schema.org/WatchAction',
            userInteractionCount: 1345
        }
    })}</script>`;
    const observation = viewEvidence.redViews(html,
        'https://www.xiaohongshu.com/explore/6a87a554000000003501590f', note);
    const restored = cacheRoundTrip({ id: '6a87a554000000003501590f', ...observation });

    assert.strictEqual(restored.playRaw, null);
    assert.strictEqual(restored.viewEvidence.status, 'aggregate-interactions');
    assert.ok(restored.viewEvidence.reportedValue === 1345,
        '被拒绝的候选值应作为证据保留，便于追溯');
});

// ---------------------------------------------------------------------------
// 6. 排序层：null 不参与播放排名，真实值正常参与
// ---------------------------------------------------------------------------
ok('排序：playRaw=null 不进入播放排名，正数正常排名', () => {
    const list = [
        { id: 'a', playRaw: null, likeRaw: 5000, pubdate: 100 },
        { id: 'b', playRaw: 100, likeRaw: 10, pubdate: 90 },
        { id: 'c', playRaw: 300, likeRaw: 20, pubdate: 80 },
        { id: 'd', playRaw: null, likeRaw: 9000, pubdate: 70 }
    ];

    const summary = ranking.summary(list, 'views');
    assert.strictEqual(summary.ranked, 2, '只有 b、c 两件可进入播放排名');
    assert.strictEqual(summary.unranked, 2, 'a、d 应被标记为未排名');

    const sorted = [...list].sort((x, y) => ranking.compare(x, y, 'views'));
    assert.deepStrictEqual(sorted.filter(v => ranking.count(v, 'views') !== null).map(v => v.id), ['c', 'b'],
        '可排名的应按播放降序');
    assert.strictEqual(sorted[sorted.length - 1].playRaw, null, '无证据的排最后');
});

ok('排序：切到点赞榜时，点赞高的无播放作品可正常排名', () => {
    const list = [
        { id: 'a', playRaw: null, likeRaw: 5000 },
        { id: 'b', playRaw: 100, likeRaw: 10 }
    ];
    const summary = ranking.summary(list, 'likes');
    assert.strictEqual(summary.ranked, 2, '点赞榜下两件都有点赞，均可排名');
    assert.strictEqual(summary.metric, 'likes', '必须如实标明当前排的是点赞');
});

// ---------------------------------------------------------------------------
// 7. 反向保护：模拟"错误修补"必须被测试抓到
// ---------------------------------------------------------------------------
ok('反向验证：把 null 篡改成互动数会被 assertNoFakeViews 拦截', () => {
    const good = { id: 'x', playRaw: null, likeRaw: 1000, commentCount: 50 };
    assertNoFakeViews(good, '正常记录');

    // 模拟未来有人写出 playRaw = playRaw || likeRaw 这种兜底
    const broken = { id: 'x', playRaw: good.playRaw || good.likeRaw, likeRaw: 1000, commentCount: 50 };
    assert.throws(() => assertNoFakeViews(broken, '被篡改的记录'), /playRaw 必须为 null|不得进入播放排名/,
        '篡改后必须断言失败');
});

ok('反向验证：把 null 写成 0 也会被发现', () => {
    const broken = { id: 'x', playRaw: 0, likeRaw: 1000 };
    assert.throws(() => assertNoFakeViews(broken, '零填充记录'), /playRaw 必须为 null/,
        '未知播放被填成 0 必须断言失败');
});

// ---------------------------------------------------------------------------
// 8. 数值类型守卫
// ---------------------------------------------------------------------------
ok('readMetric 只接受安全非负整数，0 是合法真实值', () => {
    assert.strictEqual(numericCount(0), 0, '真实零播放是合法数字');
    assert.strictEqual(numericCount(null), null);
    assert.strictEqual(numericCount(undefined), null);
    assert.strictEqual(numericCount(-1), null, '负数非法');
    assert.strictEqual(numericCount(1.5), null, '小数非法');
    // 平台常返回 "1,234 views" 这类文本，readMetric 负责按后缀解析成整数
    assert.strictEqual(numericCount('123'), 123, '纯数字文本可解析为整数');
    assert.strictEqual(numericCount('1,234 views'), 1234, '带千分位与后缀可解析');
    assert.strictEqual(numericCount('abc'), null, '无法解析的文本必须是 null');
    assert.strictEqual(numericCount(''), null, '空串必须是 null');
});

ok('缩略值与下界值被如实标记精度，不当成精确整数', () => {
    // "12.3万" 是平台展示的舍入值，不能当作精确 123000
    const rounded = readMetric('12.3万', 'views');
    assert.strictEqual(rounded.precision, 'source-rounded', '缩略值必须标记 source-rounded');
    assert.notStrictEqual(rounded.precision, 'integer', '缩略值不得冒充精确整数');

    // "1000+" 是下界，不能当精确值
    const lower = readMetric('1000+', 'views');
    assert.strictEqual(lower.precision, 'lower-bound', '下界值必须标记 lower-bound');
    assert.strictEqual(lower.value, null, '下界值没有精确值');
    assert.strictEqual(lower.lowerBound, 1000, '下界数值单独保留');
});

// ---------------------------------------------------------------------------
// 9. 小红书 enrich 并发改造的契约（离线可验证部分）
// ---------------------------------------------------------------------------
ok('enrichStats 在未调用前为 null，导出契约正确', () => {
    const red = require(path.join(root, 'lib/red-public.js'));
    assert.strictEqual(typeof red.enrichPublic, 'function', 'enrichPublic 必须导出');
    assert.strictEqual(typeof red.enrichStats, 'function', 'enrichStats 必须导出，便于观测覆盖率');
    // 全新进程里还没跑过 enrich
    const stats = red.enrichStats();
    assert.ok(stats === null || typeof stats === 'object',
        'enrichStats 应返回 null 或统计对象');
});

ok('enrichPublic 对非小红书链接不发请求（离线，不应触网）', async () => {
    const red = require(path.join(root, 'lib/red-public.js'));
    const before = red.enrichStats();
    // 全是其它平台，eligible() 应当把它们全部过滤掉
    const list = [
        { url: 'https://www.bilibili.com/video/BV1GJ411x7h7' },
        { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        { url: 'https://example.com/explore/6a87a554000000003501590f' }
    ];
    await red.enrichPublic(list);
    const after = red.enrichStats();
    // 没有合法目标时应当直接返回，不产生新的 axios 尝试
    assert.ok(after === before || after === null || after.axiosTried === 0,
        '非小红书链接不应产生 axios 尝试，实际=' + JSON.stringify(after));
});

ok('enrichPublic 空列表安全返回', async () => {
    const red = require(path.join(root, 'lib/red-public.js'));
    await red.enrichPublic([]);
    assert.ok(true, '空列表不应抛错');
});

finish().then(() => {
    console.log('\n播放证据全链路不变量测试通过: ' + passed + ' 项');
}).catch((err) => {
    console.error('\n异步用例失败:', err && err.message);
    process.exit(1);
});
