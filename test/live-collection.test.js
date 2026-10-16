'use strict';

const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotpot-collection-live-'));
process.env.HOTPOT_COLLECTION_DIR = path.join(directory, 'collection');
process.env.HOTPOT_SOURCE_CACHE = path.join(directory, 'snapshots');
require('../lib/env');
const sources = require('../lib/live-sources');
const collection = require('../lib/collection-index');

(async () => {
    try {
        const options = { platform: 'bilibili', category: 'tech', timeRange: '3days', page: 1, refresh: true };
        const result = await sources.getVideos(options);
        assert.ok(result.list.length > 0, '需要真实平台作品；没有网络或被限流时明确失败');
        assert.equal(result.collection.status, 'saved');
        const restarted = collection.createIndex({ directory: process.env.HOTPOT_COLLECTION_DIR });
        const saved = restarted.query(options);
        assert.ok(saved.list.length > 0);
        for (const item of saved.list) {
            const original = result.list.find(v => v.id === item.id);
            assert.ok(original, '索引不能生成新的作品');
            assert.equal(item.playRaw, original.playRaw);
            assert.equal(item.pubdate, original.pubdate);
            assert.equal(item.fetchedAt, original.fetchedAt);
        }
        const evidence = path.join(__dirname, '..', '.cache', 'verification');
        fs.mkdirSync(evidence, { recursive: true });
        const report = { checkedAt: new Date().toISOString(), source: result.source, partial: Boolean(result.partial),
            fetched: result.list.length, persisted: saved.total, restoredPageSize: saved.list.length, sample: saved.list[0], scope: saved.scope };
        fs.writeFileSync(path.join(evidence, 'collection-live.json'), JSON.stringify(report, null, 2));
        console.log(`Real Bilibili collection passed: ${result.list.length} discovered, ${saved.total} persisted, ${saved.list.length} restored; original metrics/dates preserved`);
    } finally { await sources.closeBrowser(); fs.rmSync(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
