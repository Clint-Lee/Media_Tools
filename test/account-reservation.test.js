'use strict';
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const filename = path.resolve(__dirname, 'virtual-accounts.json');
let now = Date.parse('2026-10-23T02:00:00Z');
class TestDate extends Date { static now() { return now; } }
const seed = { authVersion:2, users:[{username:'alice',role:'user',usage:{}}], logs:[], sessions:{}, reservations:{} };
const files = new Map([[filename, JSON.stringify(seed)]]);
const memoryFs = {
    readFileSync(name) { if (!files.has(name)) throw Object.assign(new Error('missing'), {code:'ENOENT'}); return files.get(name); },
    writeFileSync(name, data) { files.set(name, data); },
    renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); },
    existsSync: name => files.has(name), mkdirSync() {}, unlinkSync: name => files.delete(name)
};
const sandboxModule = {exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/accounts.js'),'utf8'), {
    require: name => name === 'fs' ? memoryFs : require(name), module:sandboxModule,
    __dirname:path.resolve(__dirname,'../lib'), process:{env:{HOTPOT_DB_FILE:filename}}, Date:TestDate, Intl, Buffer
});
{
    const { store, createStore } = sandboxModule.exports;
    const id = store.reserve('alice', 'analyze');
    now += 31 * 60 * 1000;
    assert.equal(store.publicUser(store.read().users[0]).quota.pending, 1, 'live reservation survives long queue/runtime');
    store.settle(id, true);
    store.settle(id, true);
    assert.equal(store.publicUser(store.read().users[0]).quota.used, 1, 'long successful task charged exactly once');
    const failed = store.reserve('alice', 'transcript');
    now += 31 * 60 * 1000;
    store.settle(failed, false);
    assert.equal(store.publicUser(store.read().users[0]).quota.used, 1, 'failed long task refunds');
    const fullQueue = Array.from({length:9}, () => store.reserve('alice', 'queued'));
    now += 31 * 60 * 1000;
    assert.throws(() => store.reserve('alice', 'over-limit'), error => error.status === 429, 'aged live queue still holds quota');
    for (const pending of fullQueue) store.settle(pending, false);
    const db = JSON.parse(memoryFs.readFileSync(filename, 'utf8'));
    db.reservations.orphan = {username:'alice', date:store.publicUser(db.users[0]).quota.date, createdAt:now-31*60*1000};
    memoryFs.writeFileSync(filename, JSON.stringify(db));
    assert.equal(store.read().reservations.orphan, undefined, 'persisted orphan really removed');
    store.reserve('alice', 'restart-test');
    const restarted = createStore(filename);
    assert.equal(Object.keys(restarted.read().reservations).length, 0, 'restart refunds interrupted process reservations');
    console.log('Long active reservations, genuine orphan cleanup, idempotent settlement and restart tests passed');
}
