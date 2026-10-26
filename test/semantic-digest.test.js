'use strict';
// 本地 TextRank 语义摘要：无原生依赖，用于神经模型不可用时的真实语义兜底。
const assert = require('node:assert/strict');
const digest = require('../lib/semantic-digest');

const lines = (...texts) => texts.map((text, index) => ({ startSec: index * 3, endSec: index * 3 + 3, text }));

// ── 1) 分词：中文 2-gram、英文按词、停用词过滤
{
    const tokens = digest.tokenize('今天我们来聊聊手机芯片的性能');
    assert.ok(tokens.includes('芯片'), '中文必须切出「芯片」');
    assert.ok(tokens.includes('手机'));
    assert.ok(!tokens.includes('我们'), '停用词必须被过滤');
    const en = digest.tokenize('the iPhone chip performance');
    assert.ok(en.includes('iphone'));
    assert.ok(!en.includes('the'));
    assert.deepEqual(digest.tokenize(''), []);
    assert.deepEqual(digest.tokenize(null), []);
    console.log('✓ tokenize: 中文2-gram/英文词/停用词/空值');
}

// ── 2) 无字幕必须报错，不能凭空生成
{
    assert.throws(() => digest.analyze({ transcript: [] }), /没有可分析的字幕/);
    assert.throws(() => digest.analyze({}), /没有可分析的字幕/);
    assert.throws(() => digest.analyze({ transcript: lines('短') }), /过短/);
    console.log('✓ analyze: 空字幕与超短字幕明确报错');
}

// ── 3) 摘要质量：跨段落覆盖，不是取最长句
{
    const transcript = { title: '手机芯片评测', transcript: lines(
        '今天我们来聊聊手机芯片的性能问题',
        '首先看这颗处理器的参数配置和制程工艺',
        '它的跑分结果比上一代提升了大约百分之三十',
        '但是在高负载场景下温度控制成了关键',
        '我们实测了三款主流游戏的表现',
        '所以如果你在意续航建议选择低功耗模式',
        '最后总结一下这颗芯片值不值得买',
        '谢谢大家观看我们下期再见'
    ) };
    const result = digest.analyze(transcript);
    assert.equal(result.method, 'textrank', 'method 必须与 local-llm/extractive 区分');
    assert.ok(result.summary.length > 0);
    assert.ok(result.keyPoints.length >= 3, '至少选出 3 个代表段落');
    assert.ok(result.keyPoints.length <= 6, '最多 6 个，避免堆砌');
    // 关键点必须能回溯到真实字幕时间戳
    for (const point of result.keyPoints) {
        assert.ok(Number.isFinite(point.startSec), '关键点必须带时间戳');
        assert.ok(point.quote.length > 0, '关键点必须带原句');
    }
    // 不能含"谢谢观看"这类结尾客套作为唯一代表
    assert.ok(!/^\s*谢谢大家观看/.test(result.summary), '摘要不应只取结尾客套句');
    assert.equal(result.category, '科技数码', '分类应根据文本内容判定');
    console.log('✓ analyze: 跨段落摘要、时间戳可回溯、分类正确');
}

// ── 4) 去冗余：高度重复的句子不应占满关键点
{
    const repeated = digest.analyze({ transcript: lines(
        '这个手机芯片性能非常强悍',
        '这个手机芯片性能非常强悍',
        '这个手机芯片性能非常强悍',
        '价格方面也还算合理可以接受',
        '续航表现中规中矩没有惊喜',
        '拍照效果在同价位里属于上游'
    ) });
    const uniqueTexts = new Set(repeated.keyPoints.map(point => point.text));
    assert.ok(uniqueTexts.size >= 2, '重复句必须去冗余，保留不同段落');
    console.log('✓ analyze: MMR 去冗余生效');
}

// ── 5) 分类识别
{
    assert.equal(digest.guessCategory('今天做一道红烧肉，先把五花肉煎香'), '美食');
    assert.equal(digest.guessCategory('这次自驾去了海边，风景真的很美'), '旅行户外');
    assert.equal(digest.guessCategory('这个游戏新版本的boss太难打了'), '游戏');
    assert.equal(digest.guessCategory('完全无法归类的随机文本内容'), '综合内容');
    console.log('✓ guessCategory: 主题分类');
}

// ── 6) 关键词：只保留出现 2 次以上的词
{
    const result = digest.analyze({ transcript: lines(
        '芯片性能是重点',
        '芯片的散热也很关键',
        '散热设计影响芯片表现',
        '其他内容随便说说'
    ) });
    assert.ok(result.keywords.includes('芯片'), '高频词应入选关键词');
    assert.ok(result.keywords.length <= 8, '关键词数量受限');
    console.log('✓ 关键词抽取');
}

// ── 7) recommendations 必须如实说明方法与限制
{
    const result = digest.analyze({ transcript: lines('第一句话说明视频的开场内容', '第二句话展开具体细节说明', '第三句话给出结论建议') });
    assert.match(result.recommendations, /TextRank/);
    assert.match(result.recommendations, /不推断画面|不联网/);
    console.log('✓ recommendations: 如实标注算法与限制');
}

console.log('\nSemantic digest (TextRank) tests passed');
