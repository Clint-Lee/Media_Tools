'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { prepareVideoList, normalizePlatform } = require('./video-pipeline');
const { matchesCategory, matchesQuery } = require('./video-categories');

const PLATFORMS = new Set(['bilibili', 'douyin', 'youtube', 'tiktok', 'xiaohongshu', 'kuaishou', 'twitter']);
const CATEGORIES = new Set(['all', 'comedy', 'ent', 'fashion', 'pets', 'wildlife', 'animal', 'tech', 'marketing', 'kuso']);
const PAGE_SIZE = 30;
// Only public video metadata belongs here; never persist request queries, headers or media URLs.
const FIELDS = ['id', 'title', 'description', 'author', 'cover', 'url', 'duration', 'pubdate',
    'playRaw', 'likeRaw', 'commentCount', 'collectCount', 'shareCount', 'categoryId', 'partsCount', 'datePrecision', 'source', 'fetchedAt',
    'viewSource', 'viewsFetchedAt', 'viewCountText', 'viewPrecision', 'viewLowerBound', 'viewEvidence',
    'likeSource', 'likesFetchedAt', 'likeCountText', 'likePrecision', 'likeLowerBound',
    'commentCountText', 'commentPrecision', 'commentLowerBound', 'collectCountText', 'collectPrecision', 'collectLowerBound', 'shareCountText', 'sharePrecision', 'shareLowerBound'];
const failure = (message, status = 503) => Object.assign(new Error(message), { status });

function createIndex({ directory = process.env.HOTPOT_COLLECTION_DIR || path.join(__dirname, '..', '.cache', 'collected-videos'),
    io = fs, now = Date.now, maxEntries = 50000, compactThreshold = 2000 } = {}) {
    const states = new Map();

    function filename(platform) {
        if (!PLATFORMS.has(platform)) throw failure('采集索引平台无效', 400);
        return path.join(directory, platform + '.json');
    }
    // 增量日志：每轮只 append 本轮变更，热路径写入量与索引规模无关。
    function logName(platform) { return filename(platform) + '.log'; }

    function decode(text, platform) {
        const data = JSON.parse(text);
        if (data.version !== 1 || data.platform !== platform || typeof data.revision !== 'string' || !Array.isArray(data.rows)) throw new Error('索引格式错误');
        const seen = new Set();
        for (const row of data.rows) {
            if (!row?.video?.id || normalizePlatform(row.video.platform) !== platform || !row.video.title
                || !Number.isFinite(row.video.fetchedAt) || !Number.isFinite(row.firstSeenAt) || !Number.isFinite(row.lastSeenAt)
                || !Array.isArray(row.categories) || row.categories.some(c => !CATEGORIES.has(c)) || seen.has(row.video.id)) throw new Error('索引记录损坏');
            seen.add(row.video.id);
        }
        return data;
    }

    // 读取增量日志并叠加到 snapshot 上。
    // 日志行格式：{"put":{row}} 或 {"del":"id"}。
    // 崩溃可能截断最后半行 —— 该行 JSON.parse 失败即丢弃，不影响前面已写入的记录。
    function replay(platform, data) {
        const log = logName(platform);
        if (!io.existsSync(log)) return { data, logCount: 0 };
        let text;
        try { text = io.readFileSync(log, 'utf8'); } catch { return { data, logCount: 0 }; }
        const rows = new Map(data.rows.map(row => [row.video.id, row]));
        let logCount = 0, skipped = 0;
        for (const line of text.split('\n')) {
            if (!line) continue;
            let entry;
            try { entry = JSON.parse(line); } catch { skipped++; continue; }
            if (entry && entry.put && entry.put.video && entry.put.video.id) {
                rows.set(entry.put.video.id, entry.put);
                logCount++;
            } else if (entry && typeof entry.del === 'string') {
                rows.delete(entry.del);
                logCount++;
            } else skipped++;
        }
        // 保持与 snapshot 一致的淘汰顺序，供 query 与容量控制使用
        const merged = [...rows.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.video.id.localeCompare(b.video.id));
        return { data: { ...data, rows: merged }, logCount, skipped };
    }

    function load(platform) {
        const file = filename(platform);
        if (states.has(platform)) return states.get(platform);
        let data = { version: 1, platform, revision: crypto.randomUUID(), rows: [] }, validText = null, recovered = false;
        // A missing primary may still have a backup after an interrupted disk operation.
        if (io.existsSync(file) || io.existsSync(file + '.bak')) {
            try { validText = io.readFileSync(file, 'utf8'); data = decode(validText, platform); }
            catch {
                try { validText = io.readFileSync(file + '.bak', 'utf8'); data = decode(validText, platform); recovered = true; }
                catch { throw failure('采集索引及备份无法读取，已保留原文件；请检查磁盘或恢复备份。'); }
            }
        }
        // snapshot 之后可能还有未 compact 的增量，必须 replay 才完整
        const replayed = replay(platform, data);
        const state = { data: replayed.data, validText, recovered, logCount: replayed.logCount };
        states.set(platform, state);
        return state;
    }

    // 把当前状态整体写成 snapshot，并清空增量日志。
    // 保留原有全部约束：原子写 / 备份 / 损坏保全 / 失败不假报。
    function save(platform, state, data) {
        const file = filename(platform), temporary = file + '.' + crypto.randomUUID() + '.tmp';
        const backupTemp = temporary + '.bak';
        try {
            io.mkdirSync(directory, { recursive: true });
            io.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
            if (state.recovered && io.existsSync(file)) {
                // Keep the damaged primary for diagnosis before replacing it with verified data.
                io.copyFileSync(file, file + '.corrupt-' + crypto.randomUUID());
            }
            if (state.validText !== null) {
                io.writeFileSync(backupTemp, state.validText, { mode: 0o600, flag: 'wx' });
                io.renameSync(backupTemp, file + '.bak');
            } else if (!io.existsSync(file + '.bak')) {
                // 首次写入也要留一份可回退的基线：
                // 否则主文件损坏时没有 .bak 可恢复（增量日志模式下不会再有第二次全量写）。
                io.writeFileSync(backupTemp, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
                io.renameSync(backupTemp, file + '.bak');
            }
            io.renameSync(temporary, file);
            // snapshot 已包含全部数据，旧日志可安全清掉
            try { io.unlinkSync(logName(platform)); } catch {}
        } catch {
            throw failure('采集索引写入失败，本次数据未假报保存；请检查磁盘，已有索引继续保留。');
        } finally {
            for (const temp of [temporary, backupTemp]) try { io.unlinkSync(temp); } catch {}
        }
        state.data = data;
        state.validText = JSON.stringify(data);
        state.recovered = false;
        state.logCount = 0;
    }

    // 热路径：只把本轮变更追加到日志，写入量与索引规模无关。
    function appendLog(platform, state, puts, dels = []) {
        const log = logName(platform);
        try {
            io.mkdirSync(directory, { recursive: true });
            const lines = [];
            for (const row of puts) lines.push(JSON.stringify({ put: row }));
            for (const id of dels) lines.push(JSON.stringify({ del: id }));
            if (!lines.length) return;
            // append 模式下崩溃只会截断最后半行，replay 会丢弃它，不会污染已写入记录
            io.appendFileSync(log, lines.join('\n') + '\n', { mode: 0o600 });
            state.logCount += puts.length + dels.length;
        } catch {
            throw failure('采集索引写入失败，本次数据未假报保存；请检查磁盘，已有索引继续保留。');
        }
    }

    function record(platform, list, { category = 'all' } = {}) {
        const state = load(platform), rows = new Map(state.data.rows.map(row => [row.video.id, row]));
        const puts = [];                      // 本轮真正变更的记录
        const candidates = (Array.isArray(list) ? list : []).filter(v => v && !v.isCached
            && normalizePlatform(v.platform) === platform && Number.isFinite(v.fetchedAt) && v.fetchedAt > 0 && v.fetchedAt <= now() + 300000);
        for (const item of prepareVideoList(candidates, { limit: candidates.length })) {
            const old = rows.get(item.id);
            const categories = [...new Set([...(old?.categories || []), ...(CATEGORIES.has(category) && category !== 'all' ? [category] : [])])].sort();
            // A watch-page counter can arrive after the same metadata observation.
            const newerCounter=old && item.fetchedAt===old.lastSeenAt && ['viewsFetchedAt','likesFetchedAt'].some(key=>Number.isFinite(item[key]) && item[key]>(old.video[key] || 0) && item[key]<=now()+300000);
            if (old && item.fetchedAt <= old.lastSeenAt && !newerCounter && categories.join() === old.categories.join()) continue;
            const video = old && item.fetchedAt < old.lastSeenAt ? old.video : { platform,
                ...Object.fromEntries(FIELDS.filter(key => item[key] !== undefined).map(key => [key, item[key]])) };
            const row = { video, categories, firstSeenAt: Math.min(old?.firstSeenAt ?? item.fetchedAt, item.fetchedAt), lastSeenAt: Math.max(old?.lastSeenAt || 0, item.fetchedAt) };
            rows.set(item.id, row);
            puts.push(row);
        }
        if (!puts.length) return { status: state.recovered ? 'recovered' : 'saved', count: state.data.rows.length };

        // 容量控制：超限时跨全量按 lastSeenAt 淘汰最旧（内存操作，不产生额外 I/O）。
        const dels = [];
        const sorted = [...rows.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.video.id.localeCompare(b.video.id));
        let kept = sorted;
        if (sorted.length > maxEntries) {
            kept = sorted.slice(0, maxEntries);
            const keptIds = new Set(kept.map(row => row.video.id));
            for (const id of rows.keys()) if (!keptIds.has(id)) dels.push(id);
        }

        // 先算出写入后的完整状态，全部成功后才替换内存，保证失败可回滚。
        const nextData = { ...state.data, revision: crypto.randomUUID(), rows: kept };
        const noSnapshot = state.validText === null;

        // 首次写入必须落 snapshot（否则索引没有可读主体）；日志到达阈值时也 compact。
        // 从备份恢复后要先 compact 一次，才能把损坏主文件保全为 .corrupt-* 并落下干净快照。
        if (noSnapshot || state.recovered || state.logCount + puts.length + dels.length >= compactThreshold) {
            // save 内部负责原子写 + 备份 + 失败抛错，失败时内存未被替换（保持旧数据）
            save(platform, state, nextData);
        } else {
            appendLog(platform, state, puts, dels);
            state.data = nextData;
        }
        return { status: state.recovered ? 'recovered' : 'saved', count: state.data.rows.length };
    }

    // 结果缓存：同一 revision + 同一筛选 + 同一时间基准下，排序结果与聚合值可复用。
    // revision 每次写入都变，缓存自然失效，不会返回陈旧结果。
    const resultCache = new Map();
    const CACHE_LIMIT = 8;

    function query({ platform, category = 'all', timeRange = 'all', query = '', cursor = '', sortBy='views' }) {
        if(!['views','likes'].includes(sortBy))throw failure('排序指标无效',400);
        const state = load(platform);
        const filter = crypto.createHash('sha256').update(JSON.stringify({ platform, category, timeRange, query, sortBy })).digest('hex');
        let offset = 0, asOf = now();
        if (cursor) {
            let page;
            try { page = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw failure('采集记录翻页参数无效', 400); }
            if (!page || typeof page !== 'object' || page.filter !== filter || !Number.isSafeInteger(page.offset) || page.offset < 0 || page.offset > maxEntries
                || !Number.isSafeInteger(page.asOf) || page.asOf <= 0 || page.asOf > now() + 300000) throw failure('采集记录翻页参数与筛选不匹配', 400);
            if (page.revision !== state.data.revision) throw failure('采集记录已更新，请刷新后重新翻页，以免重复或遗漏作品。', 409);
            offset = page.offset;
            asOf = page.asOf;
        }
        const rows = state.data.rows;

        // prepareVideoList 会为每条记录构造完整展示对象（含多次指标归一化与格式化），
        // CPU profile 显示 63% 时间在它自身、22% 在 GC：50K 条只为返回 30 条，白白分配 5 万个对象。
        // 因此这里先用轻量代理参与筛选与排序，最后只对当前页 30 条做完整构造。
        // 缓存策略必须区分两种请求：
        //  - 带游标的翻页：沿用首批 asOf 与已算好的排序结果，只做 slice
        //  - 无游标的首屏：必须按当前时刻重新计算，否则时效筛选会返回过期结果
        const cacheKey = state.data.revision + '|' + filter + '|' + asOf;
        let cached = cursor ? resultCache.get(cacheKey) : null;
        const end = offset + PAGE_SIZE;
        if (!cached) {
            // 1) 筛选：直接复用 row.video 引用，不逐条展开成新对象。
            //    旧写法 {...row.video} 在 4.8 万条时要 281ms，而这些对象最终只用到 30 条。
            //    row.video 只被读取，不在此处改动：
            //    附加字段由 attachMeta 在 prepareVideoList 新构造的展示对象上补齐，
            //    持久化的行对象保持干净（isCached 等展示标记不会写进 snapshot/日志）。
            const candidates = [];
            for (const row of rows) {
                if (category !== 'all' && !row.categories.includes(category) && !matchesCategory(row.video, category)) continue;
                if (!matchesQuery(row.video, query)) continue;
                candidates.push(row.video);
            }
            // 2) 一次调用同时拿到"到当前页末尾的构造结果 + 筛选后真实总数"
            //    attachMeta 负责把 isCached / firstSeenAt / lastSeenAt 补回，
            //    这样索引层不必为每条候选展开新对象（4.8 万条约 281ms）。
            const metaById = new Map();
            for (const row of rows) {
                if (!metaById.has(row.video.id)) metaById.set(row.video.id, row);
            }
            const attachMeta = (item) => {
                const row = metaById.get(item.id);
                if (!row) return;
                item.isCached = true;
                item.firstSeenAt = row.firstSeenAt;
                item.lastSeenAt = row.lastSeenAt;
            };
            const built = prepareVideoList(candidates, { timeRange, sortBy, now: Math.floor(asOf / 1000), limit: Math.min(end, maxEntries), attachMeta });
            const total = Number.isFinite(built.filteredTotal) ? built.filteredTotal : built.length;
            // 全量已知播放量条数（不是本页 30 条），coverage 必须如实反映整个筛选结果
            const knownViews = Number.isFinite(built.filteredKnownViews) ? built.filteredKnownViews : null;

            let earliestCollectedAt = null, latestCollectedAt = null;
            for (const row of rows) {
                if (earliestCollectedAt === null || row.firstSeenAt < earliestCollectedAt) earliestCollectedAt = row.firstSeenAt;
                if (latestCollectedAt === null || row.lastSeenAt > latestCollectedAt) latestCollectedAt = row.lastSeenAt;
            }

            cached = { candidates, total, knownViews, earliestCollectedAt, latestCollectedAt };
            if (cursor) {
                resultCache.set(cacheKey, cached);
                while (resultCache.size > CACHE_LIMIT) resultCache.delete(resultCache.keys().next().value);
            }
            return finishQuery(state, rows, built, total, offset, end, filter, asOf, platform, sortBy, maxEntries, cached);
        }

        // 命中缓存：按当前页深度重新构造（翻页 offset 可能更深）
        const need = Math.min(end, cached.total);
        const metaById = new Map();
        for (const row of rows) if (!metaById.has(row.video.id)) metaById.set(row.video.id, row);
        const attachMeta = (item) => {
            const row = metaById.get(item.id);
            if (!row) return;
            item.isCached = true;
            item.firstSeenAt = row.firstSeenAt;
            item.lastSeenAt = row.lastSeenAt;
        };
        const built = prepareVideoList(cached.candidates, { timeRange, sortBy, now: Math.floor(asOf / 1000), limit: need, attachMeta });
        return finishQuery(state, rows, built, cached.total, offset, end, filter, asOf, platform, sortBy, maxEntries, cached);
    }

    // 统一组装返回体，避免两条分支重复
    function finishQuery(state, rows, built, total, offset, end, filter, asOf, platform, sortBy, maxEntries, cached) {
        let newestFetchedAt = null;
        for (const v of built) {
            if (Number.isFinite(v.fetchedAt) && (newestFetchedAt === null || v.fetchedAt > newestFetchedAt)) newestFetchedAt = v.fetchedAt;
        }
        // knownViews 用全量筛选结果（cached.knownViews），不是本页条数，
        // 否则文案会声称"只有 30 件有播放量"而实际远不止。
        const knownViews = Number.isFinite(cached.knownViews) ? cached.knownViews : null;
        const pageList = built.slice(offset, end);
        return { success: true, list: pageList, total, hasMore: end < total,
            nextCursor: end < total ? Buffer.from(JSON.stringify({ revision: state.data.revision, filter, offset: end, asOf })).toString('base64url') : '',
            source: platform + ':collection-index', historical: true, stale: true, ranking:require('../public/ranking').summary(pageList,sortBy),
            scope: { kind: 'collected-history', label: '已采集记录 · 历史指标，非实时', exhaustive: false, metric: sortBy, categoryMethod: 'observed-category-or-semantic-title' },
            coverage: { candidates: rows.length, unique: total, knownViews,
                unknownViews: total - knownViews, capacity: maxEntries,
                earliestCollectedAt: cached.earliestCollectedAt,
                latestCollectedAt: cached.latestCollectedAt,
                recoveredFromBackup: state.recovered },
            sourceMessage: '仅查询本机持久保存的已发现作品，播放量为最后一次实际采集值，未重新核验可播放性；不是全站历史总榜。',
            message: total ? undefined : '尚无符合筛选的采集记录。浏览实时视频榜后会自动积累；空记录不代表平台没有相关作品。',
            fetchedAt: newestFetchedAt };
    }

    return { record, query };
}

module.exports = { ...createIndex(), createIndex, PAGE_SIZE };
