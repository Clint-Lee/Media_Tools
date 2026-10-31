const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.NODE_ENV = 'test';
process.env.HOTPOT_GUEST_SECRET = require('node:crypto').randomBytes(48).toString('hex');
delete process.env.HOTPOT_GUEST_LEDGER;
const guests = require(path.join(__dirname, '../lib/guest-access.js'));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-ledger-security-'));
try {
  const filename = path.join(directory, 'quotas.json');
  let store = guests.createStore(filename);
  store.connect('a', 'ip');
  const id = store.reserve('a', 'test');
  store.settle(id, true);
  store = guests.createStore(filename);
  store.connect('a', 'ip');
  assert.equal(store.quota('a').used, 1, 'quota survives restart');
  store.reserve('a', 'interrupted');
  store = guests.createStore(filename);
  store.connect('a', 'ip');
  assert.equal(store.quota('a').used, 2, 'crash does not refund reserved work');
  function access(cookie, fingerprint) {
    const req = { headers: { cookie, 'x-fingerprint': fingerprint }, ip: 'isolated-ip', secure: true };
    let issued;
    const res = { cookie: (key, value, options) => { issued = value; assert.ok(options.httpOnly && options.secure); }, setHeader() {}, status(code) { throw Error('unexpected status ' + code); } };
    guests.access(() => null)(req, res, () => {});
    return { owner: req.user.username, issued };
  }
  const first = access('', 'client-controlled');
  const cookie = 'hotpot_visitor=' + first.issued;
  assert.equal(access(cookie, 'changed-fingerprint').owner, first.owner);
  assert.equal(access(cookie, 'changed-fingerprint').issued, undefined);
  const forged = first.issued.slice(0, -1) + (first.issued.endsWith('0') ? '1' : '0');
  assert.notEqual(access('hotpot_visitor=' + forged, 'client-controlled').owner, first.owner);
  assert.notEqual(access('', 'client-controlled').owner, first.owner, 'fingerprints cannot impersonate another visitor');
  console.log('Guest security: signed identity, private isolation, persistent quotas and crash accounting passed');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
