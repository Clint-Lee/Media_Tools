'use strict';
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotpot-accounts-test-'));
process.env.HOTPOT_DB_FILE = path.join(directory, 'accounts.json');
process.env.HOTPOT_MEDIA_CACHE = path.join(directory, 'media');
const { store, createStore, dayKey } = require('../lib/accounts');
const downloader = require('../lib/downloader-core');
downloader.unifiedParse = async () => ({ success:false, error:'隔离测试失败，未请求外部媒体' });
const jobs = require('../lib/media-jobs');
const app = require('../server');
(async () => {
    const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening',r));
    const base = 'http://127.0.0.1:' + server.address().port;
    const request = async (url, body, cookie='', method=body?'POST':'GET', headers={}) => {
        const r = await fetch(base+url,{method,headers:{'Content-Type':'application/json',Cookie:cookie,...headers},...(body?{body:JSON.stringify(body)}:{})});
        return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};
    };
    try {
        assert.equal(dayKey(Date.parse('2026-10-11T16:00:00Z')), '2026-10-12');
        assert.equal((await request('/api/auth/demo-login',{role:'admin'})).status,410);
        assert.equal((await request('/api/auth/me')).status,401);
        const invalidHost=await new Promise((resolve,reject)=>{
            const http=require('http');
            const r=http.get(base+'/api/auth/me',{headers:{Host:'attacker.invalid'}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));}); r.on('error',reject);
        });
        assert.equal(invalidHost,403,'本机服务拒绝DNS重绑定Host');
        const visitorJob=await request('/api/media/jobs',{url:'https://www.bilibili.com/video/BV1GGaZ6AEzJ'});
        assert.equal(visitorJob.status,202,'媒体处理不要求临时设备用户注册');
        assert.ok(visitorJob.cookie.includes('hotpot_visitor=') && visitorJob.cookie.includes('HttpOnly'));
        assert.equal((await request('/api/auth/me')).status,401,'访客会话不是伪造登录账号');
        assert.equal((await request('/api/auth/register',{username:'bad',password:'short'})).status,400);
        const registered = await request('/api/auth/register',{username:'alice',password:'ValidPassword-123 ',nickname:'真实账号',role:'admin'});
        assert.equal(registered.status,200); assert.equal(registered.data.user.role,'user','注册不能自授管理员');
        assert.ok(registered.cookie.includes('HttpOnly') && registered.cookie.includes('SameSite=Strict'));
        assert.ok(!registered.data.token && !registered.data.user.password);
        const cookie=registered.cookie.split(';')[0];
        assert.equal((await request('/api/auth/me',null,cookie)).data.user.quota.remaining,20);
        assert.equal((await request('/api/auth/login',{username:'alice',password:'ValidPassword-123'})).status,401,'密码空格不能被去除');
        assert.equal((await request('/api/settings',{proxy:''},cookie)).status,403);
        assert.equal((await request('/api/account/profile',{nickname:'新昵称',role:'admin'},cookie,'PATCH')).data.user.role,'user');
        assert.equal((await request('/api/account/profile',{nickname:'跨站篡改'},cookie,'PATCH',{Origin:'https://attacker.invalid'})).status,403);
        const ids=[]; for(let i=0;i<20;i++)ids.push(store.reserve('alice','isolated-test'));
        assert.throws(()=>store.reserve('alice','overflow'),error=>error.status===429);
        store.settle(ids[0],true); for(const id of ids.slice(1))store.settle(id,false);
        assert.equal((await request('/api/auth/me',null,cookie)).data.user.quota.used,1);
        assert.equal((await request('/api/auth/me',null,cookie)).data.user.quota.remaining,19);
        // Stale reservation auto-purge test: old reservations (>30m) must not leak user quota
        const testDb = store.read();
        testDb.reservations['stale-res-test'] = { username: 'alice', date: dayKey(), action: 'parse', createdAt: Date.now() - 35 * 60 * 1000 };
        fs.writeFileSync(process.env.HOTPOT_DB_FILE, JSON.stringify(testDb));
        const updatedDb = store.read();
        assert.equal(updatedDb.reservations['stale-res-test'], undefined, '超过30分钟的孤立预占应自动回收');

        store.log('alice',{kind:'parse',status:'parsed',url:'https://www.bilibili.com/video/BV1GGaZ6AEzJ',title:'隔离用例',platform:'bilibili'});
        const bob=await request('/api/auth/register',{username:'bob',password:'BobPassword-12345'}), bobCookie=bob.cookie.split(';')[0];
        assert.equal((await request('/api/account/history',null,bobCookie)).data.list.length,0,'历史隔离');
        assert.equal((await request('/api/account/history',null,cookie)).data.list.length,1);
        const j=jobs.createJob({url:'https://www.bilibili.com/video/BV1GGaZ6AEzJ',kind:'analyze',owner:'alice'});
        assert.equal((await request('/api/media/jobs/'+j.id,null,bobCookie)).status,404,'不可读其它账号任务');
        assert.equal((await request('/api/media/jobs/'+j.id,null,cookie)).status,200);
        assert.equal((await request('/api/media/jobs/'+j.id+'/file',null,bobCookie)).status,404);
        const changed=await request('/api/account/password',{currentPassword:'ValidPassword-123 ',password:'AnotherPassword-456'},cookie);
        assert.equal(changed.status,200); const newCookie=changed.cookie.split(';')[0];
        assert.equal((await request('/api/auth/me',null,cookie)).status,401,'修改密码撤销旧会话');
        assert.equal((await request('/api/auth/me',null,newCookie)).status,200);
        const reloaded=createStore(process.env.HOTPOT_DB_FILE);
        assert.equal(reloaded.identify(newCookie.split('=')[1]).quota.used,1,'重启仍有真实使用量');
        const db=reloaded.read(); assert.ok(db.users[0].password.startsWith('scrypt$')); assert.ok(!Object.hasOwn(db.sessions,newCookie.split('=')[1]),'会话只保存哈希');
        await request('/api/auth/logout',{},newCookie);
        assert.equal((await request('/api/auth/me',null,newCookie)).status,401);
        const corrupt=path.join(directory,'corrupt.json'); fs.writeFileSync(corrupt,'not-json');
        assert.throws(()=>createStore(corrupt)); assert.equal(fs.readFileSync(corrupt,'utf8'),'not-json','不能吞异常并覆盖空库');
        console.log('Real account, secure sessions, CSRF, quotas, history and job ownership tests passed');
    } finally { jobs.shutdown(); await require('../lib/live-sources').closeBrowser(); await new Promise(r=>server.close(r)); fs.rmSync(directory,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
