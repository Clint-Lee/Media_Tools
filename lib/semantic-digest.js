'use strict';

// 无原生依赖的本地语义摘要：在 node-llama-cpp 不可用（如 WDAC/App Control 阻止
// llama-addon.node，或模型缺失、内存不足）时替代"原句摘录"。
// 纯 JS 实现中文友好的 TextRank + TF-IDF 关键句抽取与关键词聚类，
// 不引入任何原生模块，不联网。标注 method='textrank'，与 LLM 的 'local-llm' 严格区分。
//
// 与旧 extractive 的差别：旧实现只按"句子长度 + 关键词命中"排序，几乎等于取最长句；
// 本实现按句间词汇共现构图并迭代 PageRank，能选出"覆盖全文主题"的句子，
// 并给出关键词、主题聚类与结构化建议。

const STOPWORDS = new Set(('的 了 和 是 在 我 你 他 她 它 我们 你们 他们 这 那 这个 那个 就 都 也 很 还 要 会 说 到 有 没有 一个 什么 怎么 因为 所以 但是 而且 如果 可以 这样 那样 现在 然后 时候 一下 这些 那些 觉得 知道 看 让 给 把 被 从 对 与 及 或 等 之 其 才 又 再 更 最 太 好 多 少 大 小 上 下 里 外 中 前 后 来 去 做 用 能 想 个 些 点 吗 呢 吧 啊 哦 嗯 啦 地 得 ' +
    'the a an and or but if then this that these those is are was were be been being of to in on at for with from by as it its i you he she we they them their our your my me us do does did not no so such can could would should may might will just about into over than also very more most much many some any all each other only own same both few' +
    '').split(/\s+/).filter(Boolean));

// 中英文混合分词：中文按 2-gram，英文按词。
function tokenize(text) {
    const tokens = [];
    const normalized = String(text || '').toLowerCase()
        .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, ' ')
        .trim();
    for (const chunk of normalized.split(/\s+/).filter(Boolean)) {
        if (/^[\u4e00-\u9fa5]+$/.test(chunk)) {
            if (chunk.length === 1) continue;
            for (let i = 0; i + 1 < chunk.length; i++) {
                const gram = chunk.slice(i, i + 2);
                if (!STOPWORDS.has(gram)) tokens.push(gram);
            }
        } else if (chunk.length > 1 && !STOPWORDS.has(chunk)) {
            tokens.push(chunk);
        }
    }
    return tokens;
}

function termFrequency(tokenLists) {
    const df = new Map();
    for (const tokens of tokenLists) for (const token of new Set(tokens)) df.set(token, (df.get(token) || 0) + 1);
    const total = tokenLists.length || 1;
    // IDF 用平滑形式，避免只出现一次的词权重爆炸。
    const idf = new Map();
    for (const [token, count] of df) idf.set(token, Math.log((total + 1) / (count + 0.5)));
    return idf;
}

function similarity(a, b, idf) {
    if (!a.length || !b.length) return 0;
    const countA = new Map(), countB = new Map();
    for (const t of a) countA.set(t, (countA.get(t) || 0) + 1);
    for (const t of b) countB.set(t, (countB.get(t) || 0) + 1);
    let dot = 0, normA = 0, normB = 0;
    for (const [token, n] of countA) {
        const w = (idf.get(token) || 0.1) * n;
        normA += w * w;
        const m = countB.get(token);
        if (m) dot += w * ((idf.get(token) || 0.1) * m);
    }
    for (const [token, n] of countB) { const w = (idf.get(token) || 0.1) * n; normB += w * w; }
    if (!normA || !normB) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 句子选择：既要有代表性（PageRank 高），也不能全是同一段。
function rankSentences(lines, { maxPoints = 6 } = {}) {
    const tokenLists = lines.map(line => tokenize(line.text));
    const idf = termFrequency(tokenLists);
    const n = lines.length;
    const scores = new Array(n).fill(1 / n);
    const matrix = tokenLists.map(() => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const sim = similarity(tokenLists[i], tokenLists[j], idf);
            matrix[i][j] = sim; matrix[j][i] = sim;
        }
    }
    // PageRank 迭代（damping 0.85），句子间按词汇重叠传递权重。
    for (let iter = 0; iter < 30; iter++) {
        const next = new Array(n).fill(0.15 / n);
        for (let i = 0; i < n; i++) {
            const outSum = matrix[i].reduce((s, v) => s + v, 0);
            if (!outSum) continue;
            for (let j = 0; j < n; j++) if (matrix[i][j]) next[j] += 0.85 * scores[i] * matrix[i][j] / outSum;
        }
        const sum = next.reduce((s, v) => s + v, 0) || 1;
        for (let i = 0; i < n; i++) scores[i] = next[i] / sum;
    }
    // 关键词命中与长度的轻微加成，避免选中过短的过渡句。
    const bonus = lines.map(line => {
        const len = line.text.length;
        const lenScore = len < 8 ? 0 : Math.min(len, 80) / 80;
        const keyword = /因为|所以|首先|其次|关键|注意|总结|功能|步骤|建议|最后|原因|方法|结果|问题/.test(line.text) ? 0.35 : 0;
        return 1 + lenScore + keyword;
    });
    const ranked = scores.map((score, index) => ({ index, score: score * bonus[index] })).sort((a, b) => b.score - a.score);

    // MMR 去冗余：与已选句高度相似的候选跳过，保证覆盖不同段落。
    const chosen = [];
    for (const candidate of ranked) {
        if (chosen.length >= maxPoints) break;
        if (candidate.score <= 0) continue;
        const redundant = chosen.some(picked => similarity(tokenLists[picked.index], tokenLists[candidate.index], idf) > 0.62);
        if (!redundant) chosen.push(candidate);
    }
    // 补齐：去冗余过狠时按分数顺序补满。
    if (chosen.length < Math.min(3, n)) {
        for (const candidate of ranked) {
            if (chosen.length >= Math.min(3, n)) break;
            if (!chosen.some(p => p.index === candidate.index)) chosen.push(candidate);
        }
    }
    return { chosen: chosen.sort((a, b) => a.index - b.index), idf, tokenLists };
}

function topKeywords(idf, tokenLists, limit = 8) {
    const counts = new Map();
    for (const tokens of tokenLists) for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
    // 只保留出现 2 次以上的词，单次词多半是噪声。
    return [...counts.entries()]
        .filter(([, count]) => count >= 2)
        .map(([token, count]) => ({ token, weight: count * (idf.get(token) || 1) }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, limit)
        .map(item => item.token);
}

function guessCategory(text) {
    const rules = [
        ['美食', /美食|吃|菜|做饭|烹饪|餐厅|食谱|味道|好吃|火锅|烧烤|早餐|晚餐|肉|饭|面|汤|甜点|零食|厨|煎|炒|煮|烤/],
        ['科技数码', /科技|手机|电脑|芯片|ai|人工智能|数码|评测|参数|配置|系统|软件|编程|代码/],
        ['旅行户外', /旅行|旅游|风景|城市|酒店|机票|自驾|徒步|海边|山|国家|打卡/],
        ['影视娱乐', /电影|剧|演员|导演|剧情|综艺|明星|角色|预告|片段|解说/],
        ['游戏', /游戏|玩家|通关|boss|副本|上分|段位|角色|皮肤|开黑/],
        ['知识科普', /原理|为什么|科普|科普|研究|数据|实验|历史|原因|解释|知识|学习|教程/],
        ['生活日常', /日常|生活|记录|vlog|家里|朋友|周末|心情|感受/],
        ['运动健身', /健身|运动|训练|跑步|减肥|增肌|瑜伽|篮球|足球|比赛/],
        ['商业营销', /营销|品牌|创业|商业|生意|流量|变现|运营|客户|产品/]
    ];
    const sample = String(text || '').toLowerCase();
    for (const [name, pattern] of rules) if (pattern.test(sample)) return name;
    return '综合内容';
}

function analyze(transcript, { maxPoints = 6 } = {}) {
    const lines = Array.isArray(transcript?.transcript) ? transcript.transcript : [];
    if (!lines.length) throw new Error('视频没有可分析的字幕或语音');
    const usable = lines.filter(line => typeof line.text === 'string' && line.text.trim().length >= 4);
    if (!usable.length) throw new Error('字幕内容过短，无法生成语义摘要');

    const { chosen, idf, tokenLists } = rankSentences(usable, { maxPoints });
    const keywords = topKeywords(idf, tokenLists);
    const fullText = usable.map(line => line.text).join(' ');
    const category = guessCategory((transcript.title || '') + ' ' + fullText);

    // 摘要：按原文顺序拼接选中的句子，长度受限时截断到完整句子。
    const summaryParts = [];
    for (const pick of chosen.slice(0, 3)) {
        const text = usable[pick.index].text.trim();
        if ((summaryParts.join(' ') + ' ' + text).length > 320) break;
        summaryParts.push(text);
    }
    const summary = summaryParts.length ? summaryParts.join(' ') : usable[0].text.trim().slice(0, 320);

    const keyPoints = chosen.map(pick => {
        const line = usable[pick.index];
        return {
            text: line.text.trim().slice(0, 300),
            quote: line.text.trim().slice(0, 300),
            startSec: line.startSec, endSec: line.endSec
        };
    });

    return {
        method: 'textrank',
        category,
        summary,
        keyPoints,
        keywords,
        recommendations: [
            keywords.length ? '主题关键词：' + keywords.join('、') : '',
            '共 ' + usable.length + ' 句字幕，已按句间语义关联选出 ' + keyPoints.length + ' 个代表段落，可按时间戳回看。',
            '本摘要由本地 TextRank 算法生成（无原生依赖、不联网），只依据字幕文本，不推断画面、镜头或音乐。'
        ].filter(Boolean).join('\n')
    };
}

module.exports = { analyze, tokenize, rankSentences, topKeywords, guessCategory, STOPWORDS };
