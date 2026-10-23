'use strict';

// One bounded batch per client; failures never become verified observations.
function createQueue({ fetchDetail, accept, now, limit, maxEntries, budgetMs = 6500 }) {
    const cache = new Map(), attempts = new Map();
    let job = null, lastBatch = { attempted: 0, failed: 0, timedOut: false, skipped: 0 };
    function peek(id) {
        const row = cache.get(id);
        if (!row || now() - row.fetchedAt >= 300000) return null;
        cache.delete(id); cache.set(id, row); return row;
    }
    function status() {
        return { cached: [...cache.values()].filter(row => now() - row.fetchedAt < 300000).length,
            pending: job ? job.ids.size : 0, ttlMs: 300000, concurrency: 2, budgetMs, lastBatch: { ...lastBatch } };
    }
    async function enrich(list) {
        if (job) { await job.promise; return status(); }
        const ids = [...new Set(list.map(video => String(video.id)))].filter(id => /^\d{15,22}$/.test(id)
            && !peek(id) && (!attempts.has(id) || now() - attempts.get(id) >= 60000)).slice(0, limit);
        if (!ids.length) return status();
        const current = { ids: new Set(ids) }, controller = new AbortController();
        const deadline = Date.now() + budgetMs;
        const batch = { attempted: 0, failed: 0, timedOut: false, skipped: 0 };
        job = current;
        current.promise = (async () => {
            let cursor = 0;
            const timer = setTimeout(() => { batch.timedOut = true; controller.abort(); }, budgetMs);
            try {
                await Promise.all(Array.from({ length: Math.min(2, ids.length) }, async () => {
                    while (cursor < ids.length && !controller.signal.aborted) {
                        const id = ids[cursor++]; batch.attempted++;
                        let onAbort;
                        try {
                            const aborted = new Promise((resolve, reject) => {
                                onAbort = () => reject(new Error('详情补全达到批次时限'));
                                controller.signal.addEventListener('abort', onAbort, { once: true });
                            });
                            const detail = await Promise.race([fetchDetail(id, {
                                signal: controller.signal, timeoutMs: Math.max(1, deadline - Date.now())
                            }), aborted]);
                            if (!detail || !accept(detail)) throw new Error('未取得可核验播放计数');
                            cache.set(id, detail);
                            if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
                        } catch {
                            batch.failed++; attempts.set(id, now());
                            if (attempts.size > maxEntries) attempts.delete(attempts.keys().next().value);
                        } finally {
                            controller.signal.removeEventListener('abort', onAbort);
                            current.ids.delete(id);
                        }
                    }
                }));
                batch.skipped = ids.length - batch.attempted;
            } finally {
                clearTimeout(timer); current.ids.clear(); lastBatch = batch;
                if (job === current) job = null;
            }
        })();
        await current.promise; return status();
    }
    return { enrich, peek, status };
}
module.exports = { createQueue };
