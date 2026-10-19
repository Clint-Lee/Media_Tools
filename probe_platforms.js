/**
 * 视频解析金丝雀探针
 *
 * 用途：定期运行，断言各平台关键字段仍存在。
 * 接口一旦变更，当天就能发现，而不是等用户报障。
 *
 * 用法：
 *   node probe_platforms.js
 *   node probe_platforms.js --base http://127.0.0.1:3000 --token YOUR_TOKEN
 *
 * 退出码：全部通过 = 0，任一失败 = 1（可挂到 cron / 任务计划程序里做告警）
 */

const axios = require('axios');

const DEFAULT_BASE = process.env.PROBE_BASE || 'http://127.0.0.1:3000';
const DEFAULT_TOKEN = process.env.PROBE_TOKEN || '';

// 每个平台：输入 + 必须存在的字段（点号路径）
const PROBES = [
    {
        platform: 'Bilibili',
        input: 'https://www.bilibili.com/video/BV1GJ411x7h7/',
        must: ['videoUrl', 'title', 'stats.play', 'stats.like'],
        note: 'B站 stat 必须含真实播放量'
    },
    {
        platform: '抖音-热榜',
        // hot_list.view_count 统计口径未核验，不作为 stats.play 断言，
        // 只断言它确实被单独采集到了 hotListViews 字段
        input: 'https://www.douyin.com/video/7697283722604776745',
        must: ['videoUrl', 'title', 'hotListViews.value', 'stats.like', 'stats.comment', 'stats.collect', 'stats.share'],
        forbidPlay: true,
        note: '热榜视频应采集到 hotListViews（口径未核验，不得填入 stats.play）'
    },
    {
        platform: '抖音-普通',
        input: 'https://www.douyin.com/video/7694896336528755977',
        must: ['videoUrl', 'title', 'stats.like', 'stats.comment', 'stats.collect', 'stats.share'],
        forbidPlay: true,
        note: '普通视频 play_count 恒为 0，stats.play 应为 null（真实而非假数据）'
    },
    {
        platform: '抖音-分享文本',
        input: '复制打开抖音 https://www.douyin.com/video/7697283722604776745 🎉',
        must: ['videoUrl', 'stats.like'],
        note: '验证能从含中文 emoji 的分享文案里提取链接'
    },
    {
        platform: '快手',
        input: 'https://www.kuaishou.com/short-video/3xxtjs8dd6cjt5e',
        must: ['videoUrl', 'title', 'stats.play', 'stats.like', 'stats.comment'],
        note: '快手有真实播放量 + commentListQuery.commentCountV2 真实评论数'
    },
];

function getPath(obj, path) {
    return path.split('.').reduce((acc, k) => (acc === null || acc === undefined ? undefined : acc[k]), obj);
}

function fmt(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'string') return v.length > 50 ? v.slice(0, 50) + '…' : v;
    return String(v);
}

async function probe(base, token, cfg) {
    const t0 = Date.now();
    const row = { platform: cfg.platform, ok: false, missing: [], error: null, elapsedMs: 0, detail: {} };
    try {
        const res = await axios.post(`${base}/api/parse`, { url: cfg.input }, {
            headers: token ? { Authorization: 'Bearer ' + token } : {},
            timeout: 180000,
            validateStatus: null
        });
        row.elapsedMs = Date.now() - t0;

        if (res.status !== 200 || !res.data || !res.data.success) {
            row.error = `HTTP ${res.status}: ` + JSON.stringify(res.data || {}).slice(0, 200);
            return row;
        }

        for (const f of cfg.must) {
            const v = getPath(res.data, f);
            if (v === undefined || v === null || v === '') row.missing.push(f);
        }
        // forbidPlay：断言"平台不提供的字段必须是 null"，防止哪天有人填假数据
        if (cfg.forbidPlay && res.data.stats && res.data.stats.play != null) {
            row.missing.push('(!) stats.play 应为 null 但得到了 ' + res.data.stats.play);
        }
        row.ok = row.missing.length === 0;
        row.detail = {
            platform: res.data.platform,
            title: fmt(res.data.title),
            stats: res.data.stats
        };
    } catch (e) {
        row.elapsedMs = Date.now() - t0;
        row.error = e.message;
    }
    return row;
}

(async () => {
    const args = process.argv.slice(2);
    const baseArg = args.indexOf('--base');
    const tokenArg = args.indexOf('--token');
    const base = baseArg >= 0 ? args[baseArg + 1] : DEFAULT_BASE;
    const token = tokenArg >= 0 ? args[tokenArg + 1] : DEFAULT_TOKEN;

    console.log(`探针目标: ${base}`);
    console.log(`探针时间: ${new Date().toISOString()}\n`);

    const report = [];
    for (const cfg of PROBES) {
        const row = await probe(base, token, cfg);
        report.push({ ...row, note: cfg.note });
        const icon = row.ok ? '✅' : '❌';
        console.log(`${icon} [${row.platform}] ${row.elapsedMs}ms`);
        if (row.ok) {
            console.log(`   平台: ${row.detail.platform} | 标题: ${row.detail.title}`);
            console.log(`   统计: ${JSON.stringify(row.detail.stats)}`);
        } else {
            if (row.error) console.log(`   错误: ${row.error}`);
            if (row.missing.length) console.log(`   缺失字段: ${row.missing.join(', ')}`);
        }
        console.log(`   说明: ${cfg.note}\n`);
    }

    const failed = report.filter(r => !r.ok);
    console.log('='.repeat(60));
    if (failed.length === 0) {
        console.log(`✅ 全部 ${report.length} 项探针通过`);
        process.exit(0);
    } else {
        console.log(`❌ ${failed.length}/${report.length} 项探针失败：`);
        failed.forEach(f => console.log(`   - ${f.platform}: ${f.error || '缺字段 ' + f.missing.join(',')}`));
        process.exit(1);
    }
})();
