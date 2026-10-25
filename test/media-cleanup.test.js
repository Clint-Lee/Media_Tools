'use strict';
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotpot-cleanup-'));
const cache = path.join(directory, 'media');
fs.mkdirSync(cache);
process.env.HOTPOT_MEDIA_CACHE = cache;
const makeDirectory = name => { const target=path.join(name.startsWith('outside')?directory:cache,name); fs.mkdirSync(target); fs.writeFileSync(path.join(target,'fixture.txt'),'isolated cleanup fixture'); return target; };
const expired = makeDirectory('job-expired');
const recent = makeDirectory('job-recent');
const unrelated = makeDirectory('user-files');
const outside = makeDirectory('outside-job-protected');
const nestedParent = makeDirectory('user-folder');
const nested = path.join(nestedParent,'job-nested'); fs.mkdirSync(nested);
const blocked = makeDirectory('job-delete-retry');
const linked = path.join(cache, 'job-linked');
let hasLink = false;
try { fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir'); hasLink = true; }
catch (error) { if (!['EPERM','EACCES','ENOSYS'].includes(error.code)) throw error; }
// 索引外孤儿目录：stale 者启动即回收；fresh 者受30分钟保守阈值保护；非 job-* 命名者不动。
const orphanStale = makeDirectory('job-orphan-stale');
const orphanFresh = makeDirectory('job-orphan-fresh');
const unindexed = makeDirectory('unindexed-plain');
const staleTime = new Date(Date.now() - 2 * 3600000);
fs.utimesSync(orphanStale, staleTime, staleTime);
fs.utimesSync(unindexed, staleTime, staleTime);
const now = Date.now(), old = now-2*3600000;
const row = (id, target, completedAt=old) => ({id,owner:'alice',kind:'download',status:'complete',createdAt:old,completedAt,directory:target});
fs.writeFileSync(path.join(cache,'jobs-index.json'), JSON.stringify([row('expired',expired),row('recent',recent,now),row('unrelated',unrelated),row('outside',outside),row('nested',nested),row('blocked',blocked),...(hasLink?[row('linked',linked)]:[])]));
let jobs;
const remove = fs.rmSync;
try {
    fs.rmSync = (target, options) => {
        if (target === blocked) throw Object.assign(new Error('isolated deletion failure'), {code:'EACCES'});
        return remove(target, options);
    };
    jobs = require('../lib/media-jobs');
    fs.rmSync = remove;
    assert.equal(fs.existsSync(expired), false, 'startup removes expired controlled job directory');
    assert.equal(fs.existsSync(recent), true, 'unexpired job remains');
    assert.equal(fs.existsSync(unrelated), true, 'non-job user directory remains');
    assert.equal(fs.existsSync(outside), true, 'outside directory remains');
    assert.equal(fs.existsSync(nested), true, 'nested user directory is not an application job root');
    assert.equal(fs.existsSync(blocked), true, 'failed deletion retains files');
    assert.equal(jobs.getJob('blocked','alice').status, 'complete', 'failed deletion retains retry record');
    if (hasLink) assert.equal(fs.lstatSync(linked).isSymbolicLink(), true, 'junction/symlink is not removed or traversed');
    assert.equal(fs.existsSync(orphanStale), false, 'unindexed stale job directory is swept at startup');
    assert.equal(fs.existsSync(orphanFresh), true, 'recently modified unindexed directory is spared by the conservative age threshold');
    assert.equal(fs.existsSync(unindexed), true, 'non job-* name is never swept even when stale');
    assert.equal(jobs.getJob('expired','alice'), null);
    assert.equal(jobs.getJob('recent','alice').status, 'complete');
    jobs.shutdown();
    delete require.cache[require.resolve('../lib/media-jobs')];
    jobs = require('../lib/media-jobs');
    assert.equal(fs.existsSync(blocked), false, 'later startup retries failed cleanup');
    console.log('Restart expiration cleanup and controlled-directory boundaries passed');
} finally {
    fs.rmSync = remove;
    jobs?.shutdown();
    fs.rmSync(directory, {recursive:true, force:true});
}
