'use strict';

const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createIndex } = require('../lib/collection-index');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotpot-collection-'));
let time = Date.now();
const now = () => time;
const options = { platform: 'youtube' };
const video = (id, extra = {}) => ({ id, platform: 'youtube', title: '科技原始作品 ' + id, playRaw: 100,
    pubdate: Math.floor(time / 1000), fetchedAt: time, source: 'youtube:official-page', ...extra });
try {
    let store = createIndex({ directory, now });
    assert.equal(store.query(options).total, 0);
    assert.equal(store.query(options).fetchedAt, null, '空索引不补当前采集时间');
    const initialTime = time;
    store.record('youtube', [video('a', { playRaw: 300, httpHeaders: { Cookie: 'must-not-save' }, downloadVideoUrl: 'must-not-save' }),
        video('b', { playRaw: null, likeRaw: 9999 }), video('c', { pubdate: 0 }),
        video('wrong', { platform: 'douyin' }), video('cached', { isCached: true }), video('future', { fetchedAt: time + 3600000 }),
        video('topic', { kind: 'topic' }), video('missing-time', { fetchedAt: undefined })], { category: 'tech', query: 'private-query' });
    let result = store.query(options);
    assert.equal(result.total, 3);
    assert.equal(result.list.at(-1).playRaw, null, '点赞不进入播放排名');
    assert.equal(result.coverage.knownViews, 2);
    assert.equal(result.coverage.unknownViews, 1);
    assert.equal(result.historical, true);
    const text = fs.readFileSync(path.join(directory, 'youtube.json'), 'utf8');
    assert.ok(!/must-not-save|private-query|httpHeaders|downloadVideoUrl/.test(text), '索引只存公开视频元数据');
    const originalRevision = JSON.parse(text).revision;
    store.record('youtube', [video('a', { playRaw: 300 })], { category: 'tech' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'youtube.json'))).revision, originalRevision, '缓存重读不制造新观测');

    time += 3600000;
    store = createIndex({ directory, now });
    assert.equal(store.query(options).total, 3, '历史索引跨重启且不受实时快照30分钟限制');
    assert.equal(store.query(options).list[0].fetchedAt, initialTime);
    store.record('youtube', [video('a', { playRaw: 50 })]);
    assert.equal(store.query(options).list.find(v => v.id === 'a').playRaw, 50, '采用最新真实观测，不能取历史最大值');
    store.record('youtube', [video('a', { playRaw: 999, fetchedAt: initialTime })]);
    assert.equal(store.query(options).list.find(v => v.id === 'a').playRaw, 50, '晚到旧响应不能覆盖新观测');
    assert.equal(store.query(options).list.find(v => v.id === 'a').firstSeenAt, initialTime);
    assert.equal(store.query({ ...options, query: '不存在' }).total, 0);
    assert.equal(store.query({ ...options, category: 'pets' }).total, 0, '不跨分类补数');
    assert.equal(store.query({ ...options, timeRange: '3days' }).total, 2, '未知发布日期不进入时效榜');
    time += 4 * 86400000;
    assert.equal(store.query({ ...options, timeRange: '3days' }).total, 0, '时效按查询时刻严格重算');

    store.record('youtube', Array.from({ length: 65 }, (_, i) => video('page-' + i, { playRaw: 1000 - i })));
    const first = store.query(options), second = store.query({ ...options, cursor: first.nextCursor });
    assert.equal(first.list.length, 30);
    assert.equal(second.list.length, 30);
    assert.equal(new Set([...first.list, ...second.list].map(v => v.id)).size, 60);
    const datedFirst = store.query({ ...options, timeRange: '3days' });
    time += 4 * 86400000;
    const datedSecond = store.query({ ...options, timeRange: '3days', cursor: datedFirst.nextCursor });
    assert.equal(datedSecond.list.length,30,'翻页锁定首批时效参照，避免时间流逝造成漏项');
    assert.throws(() => store.query({ ...options, query: 'new-filter', cursor: first.nextCursor }), e => e.status === 400);
    assert.throws(() => store.query({ ...options, cursor: 'malformed' }), e => e.status === 400);
    assert.throws(() => store.query({ ...options, cursor: Buffer.from('null').toString('base64url') }), e => e.status === 400);
    store.record('youtube', [video('new')]);
    assert.throws(() => store.query({ ...options, cursor: first.nextCursor }), e => e.status === 409, '索引变化后要求刷新，不静默重复或漏项');
    assert.throws(() => store.query({ platform: '../private' }), e => e.status === 400);

    const file = path.join(directory, 'youtube.json');
    const beforeFailure = fs.readFileSync(file, 'utf8');
    const broken = createIndex({ directory, now, io: { ...fs, renameSync(from, to) { if (to === file) throw new Error('disk failure'); return fs.renameSync(from, to); } } });
    assert.throws(() => broken.record('youtube', [video('not-saved')]), /未假报保存/);
    assert.equal(broken.query({ ...options, query: 'not-saved' }).total, 0, '写入失败必须回滚内存');
    assert.equal(fs.readFileSync(file, 'utf8'), beforeFailure);
    assert.ok(!fs.readdirSync(directory).some(name => name.endsWith('.tmp') || name.endsWith('.tmp.bak')));

    fs.writeFileSync(file, '{damaged');
    const recovered = createIndex({ directory, now });
    assert.equal(recovered.query(options).coverage.recoveredFromBackup, true);
    recovered.record('youtube', [video('after-recovery')]);
    assert.ok(fs.readdirSync(directory).some(name => name.startsWith('youtube.json.corrupt-')), '保留损坏主文件');
    assert.equal(createIndex({ directory, now }).query({ ...options, query: 'after-recovery' }).total, 1);
    fs.writeFileSync(file, '{bad-primary'); fs.writeFileSync(file + '.bak', '{bad-backup');
    const unreadable = createIndex({ directory, now });
    assert.throws(() => unreadable.query(options), /已保留原文件/);
    assert.throws(() => unreadable.record('youtube', [video('must-not-reset')]), /已保留原文件/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{bad-primary', '双损坏绝不能重建空库覆盖');

    const small = createIndex({ directory: path.join(directory, 'bounded'), now, maxEntries: 2 });
    small.record('youtube', [video('old-high', { playRaw: 99999, fetchedAt: initialTime }), video('new-low', { playRaw: 1 }), video('new-unknown', { playRaw: null })]);
    assert.equal(small.query(options).total, 2);
    assert.ok(!small.query(options).list.some(v => v.id === 'old-high'), '容量淘汰按最近采集时间而非播放量');
    console.log('collection-index tests passed (restart, provenance, filtering, paging, disk failures and backup recovery)');
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
