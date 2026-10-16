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
    'playRaw', 'likeRaw', 'commentCount', 'categoryId', 'partsCount', 'datePrecision', 'source', 'fetchedAt'];
const failure = (message, status = 503) => Object.assign(new Error(message), { status });

function createIndex({ directory = process.env.HOTPOT_COLLECTION_DIR || path.join(__dirname, '..', '.cache', 'collected-videos'),
    io = fs, now = Date.now, maxEntries = 50000 } = {}) {
    const states = new Map();

    function filename(platform) {
        if (!PLATFORMS.has(platform)) throw failure('采集索引平台无效', 400);
        return path.join(directory, platform + '.json');
    }

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
        const state = { data, validText, recovered };
        states.set(platform, state);
        return state;
    }

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
            }
            io.renameSync(temporary, file);
        } catch {
            throw failure('采集索引写入失败，本次数据未假报保存；请检查磁盘，已有索引继续保留。');
        } finally {
            for (const temp of [temporary, backupTemp]) try { io.unlinkSync(temp); } catch {}
        }
        state.data = data;
        state.validText = JSON.stringify(data);
        state.recovered = false;
    }

    function record(platform, list, { category = 'all' } = {}) {
        const state = load(platform), rows = new Map(state.data.rows.map(row => [row.video.id, row]));
        let changed = false;
        const candidates = (Array.isArray(list) ? list : []).filter(v => v && !v.isCached
            && normalizePlatform(v.platform) === platform && Number.isFinite(v.fetchedAt) && v.fetchedAt > 0 && v.fetchedAt <= now() + 300000);
        for (const item of prepareVideoList(candidates, { limit: candidates.length })) {
            const old = rows.get(item.id);
            const categories = [...new Set([...(old?.categories || []), ...(CATEGORIES.has(category) && category !== 'all' ? [category] : [])])].sort();
            if (old && item.fetchedAt <= old.lastSeenAt && categories.join() === old.categories.join()) continue;
            const video = old && item.fetchedAt < old.lastSeenAt ? old.video : { platform,
                ...Object.fromEntries(FIELDS.filter(key => item[key] !== undefined).map(key => [key, item[key]])) };
            rows.set(item.id, { video, categories, firstSeenAt: Math.min(old?.firstSeenAt ?? item.fetchedAt, item.fetchedAt), lastSeenAt: Math.max(old?.lastSeenAt || 0, item.fetchedAt) });
            changed = true;
        }
        if (changed) {
            const bounded = [...rows.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.video.id.localeCompare(b.video.id)).slice(0, maxEntries);
            save(platform, state, { ...state.data, revision: crypto.randomUUID(), rows: bounded });
        }
        return { status: state.recovered ? 'recovered' : 'saved', count: state.data.rows.length };
    }

    function query({ platform, category = 'all', timeRange = 'all', query = '', cursor = '' }) {
        const state = load(platform);
        const filter = crypto.createHash('sha256').update(JSON.stringify({ platform, category, timeRange, query })).digest('hex');
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
        const videos = rows.filter(row => (category === 'all' || row.categories.includes(category) || matchesCategory(row.video, category)) && matchesQuery(row.video, query))
            .map(row => ({ ...row.video, isCached: true, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt }));
        const list = prepareVideoList(videos, { timeRange, now: Math.floor(asOf / 1000), limit: maxEntries });
        const end = offset + PAGE_SIZE;
        return { success: true, list: list.slice(offset, end), total: list.length, hasMore: end < list.length,
            nextCursor: end < list.length ? Buffer.from(JSON.stringify({ revision: state.data.revision, filter, offset: end, asOf })).toString('base64url') : '',
            source: platform + ':collection-index', historical: true, stale: true,
            scope: { kind: 'collected-history', label: '已采集记录 · 历史指标，非实时', exhaustive: false, metric: 'views', categoryMethod: 'observed-category-or-semantic-title' },
            coverage: { candidates: rows.length, unique: list.length, knownViews: list.filter(v => v.playRaw !== null).length,
                unknownViews: list.filter(v => v.playRaw === null).length, capacity: maxEntries,
                earliestCollectedAt: rows.length ? Math.min(...rows.map(row => row.firstSeenAt)) : null,
                latestCollectedAt: rows.length ? Math.max(...rows.map(row => row.lastSeenAt)) : null,
                recoveredFromBackup: state.recovered },
            sourceMessage: '仅查询本机持久保存的已发现作品，播放量为最后一次实际采集值，未重新核验可播放性；不是全站历史总榜。',
            message: list.length ? undefined : '尚无符合筛选的采集记录。浏览实时视频榜后会自动积累；空记录不代表平台没有相关作品。',
            fetchedAt: list.length ? Math.max(...list.map(v => v.fetchedAt)) : null };
    }

    return { record, query };
}

module.exports = { ...createIndex(), createIndex, PAGE_SIZE };
