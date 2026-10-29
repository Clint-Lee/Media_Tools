'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotpot-tiktok-response-'));
process.env.HOTPOT_DB_FILE = path.join(directory, 'accounts.json');
process.env.HOTPOT_MEDIA_CACHE = path.join(directory, 'media');
process.env.HOTPOT_COLLECTION_DIR = path.join(directory, 'collection');
process.env.HOTPOT_PREWARM = '0';
fs.writeFileSync(process.env.HOTPOT_DB_FILE, JSON.stringify({ authVersion: 2, users: [], logs: [], sessions: {}, reservations: {} }));
const id = '1234567890123456789', observed = Date.now();
let finishDetail;
const gate = new Promise(resolve => { finishDetail = resolve; });
const views = require('../lib/tiktok-views');
const client = views.createClient({ now: () => observed + 1000, withPage: async (platform, worker, options) => {
    assert.equal(options.anonymous, true);
    return worker({ goto: async () => gate, evaluate: async () => ({ '#__UNIVERSAL_DATA_FOR_REHYDRATION__': {
        __DEFAULT_SCOPE__: { 'webapp.video-detail': { itemInfo: { itemStruct: { id,
            stats: { playCount: 100, diggCount: 4 }, statsV2: { playCount: '222', diggCount: '12' }
        } } } }
    } }) });
} });
Object.assign(views, client);
const list = [{ id, title: 'isolated TikTok cache', platform: 'tiktok', url: 'https://www.tiktok.com/@i/video/' + id,
    playRaw: 100, likeRaw: 4, fetchedAt: observed, viewsFetchedAt: observed, likesFetchedAt: observed }];
const sources = require('../lib/live-sources');
sources.getVideos = async () => ({ list, source: 'tiktok:test-cache', message: 'isolated', hasMore: false });
const saved = [];
require('../lib/collection-index').record = (platform, rows) => { saved.push(rows); return { status: 'saved' }; };
const jobs = require('../lib/media-jobs'), app = require('../server');
(async () => {
    const handle = app._router.stack.find(layer => layer.route?.path === '/api/trends').route.stack[0].handle;
    async function response() {
        let body, status = 200;
        await handle({ path: '/api/trends', query: { platform: 'tiktok' } }, {
            status(code) { status = code; return this; }, json(value) { body = value; return value; }
        });
        assert.equal(status, 200); return body;
    }
    try {
        const first = await response();
        assert.equal(first.list[0].playRaw, 100);
        assert.equal(first.metricEnrichment.pending, 1);
        finishDetail(); await client.enrich(list);
        const next = await response();
        assert.equal(next.list[0].playRaw, 222, '普通缓存请求也必须回填已完成的详情');
        assert.equal(next.list[0].likeRaw, 12, '支持 statsV2 字符串整数');
        assert.equal(next.list[0].viewEvidence.field, 'itemStruct.statsV2.playCount');
        assert.equal(next.list[0].fetchedAt, observed);
        assert.equal(next.metricEnrichment.pending, 0);
        assert.equal(saved.at(-1)[0].playRaw, 222);
        assert.equal(list[0].playRaw, 100, '不修改原来源缓存');
        list[0] = { ...list[0], playRaw: 333, viewsFetchedAt: observed + 2000 };
        assert.equal((await response()).list[0].playRaw, 333, '旧详情不能倒灌新指标');
        console.log('TikTok HTTP response cache supplementation, V2 metrics and independent freshness passed');
    } finally {
        finishDetail(); jobs.shutdown(); await sources.closeBrowser();
        fs.rmSync(directory, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
