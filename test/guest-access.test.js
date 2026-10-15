'use strict';
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hotpot-visitors-'));
process.env.HOTPOT_DB_FILE=path.join(directory,'accounts.json');process.env.HOTPOT_MEDIA_CACHE=path.join(directory,'media');
const token=Date.now()+'.'+crypto.randomBytes(32).toString('hex'),cookie='hotpot_visitor='+token;
const owner='guest:'+crypto.createHash('sha256').update(token).digest('hex'),jobId=crypto.randomUUID();
fs.mkdirSync(process.env.HOTPOT_MEDIA_CACHE);
const fixtureFile=path.join(process.env.HOTPOT_MEDIA_CACHE,'access-test-only.mp3');fs.writeFileSync(fixtureFile,'isolated access-control fixture, not a real audio test');
fs.writeFileSync(path.join(process.env.HOTPOT_MEDIA_CACHE,'jobs-index.json'),JSON.stringify([{id:jobId,owner,kind:'audio',title:'隔离文件权限用例',file:fixtureFile,status:'complete',createdAt:Date.now(),completedAt:Date.now()}]));
const {createStore,LIMIT,IP_LIMIT}=require('../lib/guest-access');
const ledger=createStore();ledger.connect('a','isolated-ip');
const reservations=Array.from({length:LIMIT},()=>ledger.reserve('a','test'));
assert.throws(()=>ledger.reserve('a','overflow'),e=>e.status===429);
ledger.settle(reservations[0],true);for(const id of reservations.slice(1))ledger.settle(id,false);
assert.equal(ledger.quota('a').remaining,LIMIT-1);assert.equal(ledger.quota('a').pending,0);
ledger.log('a',{status:'parsed',title:'真实状态的隔离用例'});assert.equal(ledger.history('a').length,1);
ledger.connect('b','isolated-ip');assert.equal(ledger.history('b').length,0);
ledger.clearHistory('a');assert.equal(ledger.history('a').length,0);
for(let i=0;i<IP_LIMIT-1;i++){const id='other-'+i;ledger.connect(id,'isolated-ip');const reserved=ledger.reserve(id,'test');ledger.settle(reserved,true);}
assert.throws(()=>ledger.reserve('b','ip-overflow'),e=>e.status===429,'换访客Cookie不得无限绕过同IP资源限额');
const downloader=require('../lib/downloader-core');
downloader.unifiedParse=async()=>({success:true,data:{url:'https://www.bilibili.com/video/BV1GGaZ6AEzJ',title:'隔离解析用例',platform:'bilibili',noteType:'image'}});
const jobs=require('../lib/media-jobs'),app=require('../server');
(async()=>{
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
    const request=(route,options={})=>fetch(base+route,{...options,headers:{Cookie:cookie,...options.headers}});
    try {
        assert.equal((await fetch(base+'/api/auth/me')).status,401);
        const bootstrap=await fetch(base);assert.ok(bootstrap.headers.get('set-cookie').includes('hotpot_visitor='));assert.ok(bootstrap.headers.get('set-cookie').includes('HttpOnly'));
        assert.equal((await request('/api/media/jobs/'+jobId)).status,200);
        assert.equal((await fetch(base+'/api/media/jobs/'+jobId)).status,404,'其它访客不可读取任务');
        const file=await request('/api/media/jobs/'+jobId+'/file');assert.equal(file.status,200);assert.ok((await file.text()).includes('isolated access-control fixture'));
        assert.equal((await fetch(base+'/api/media/jobs/'+jobId+'/file')).status,404,'无同一访客Cookie不可下载别人结果');
        const parsed=await request('/api/parse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://www.bilibili.com/video/BV1GGaZ6AEzJ'})});
        assert.equal(parsed.status,200);assert.ok((await parsed.json()).data.mediaId);
        const history=await(await request('/api/media/history')).json();assert.equal(history.visitor,true);assert.equal(history.quota.used,1);assert.ok(history.list.some(row=>row.status==='parsed'));
        assert.equal((await(await fetch(base+'/api/media/history')).json()).list.length,0);
        const crossSite=await request('/api/parse?url='+encodeURIComponent('https://www.bilibili.com/video/BV1GGaZ6AEzJ'),{headers:{'Sec-Fetch-Site':'cross-site'}});assert.equal(crossSite.status,403);
        assert.equal((await request('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"proxy":""}'})).status,401,'访客不获得账号或管理员权限');
        assert.equal((await request('/api/auth/me')).status,401,'免登录会话不能冒充已注册用户');
        await request('/api/media/history',{method:'DELETE'});assert.equal((await(await request('/api/media/history')).json()).list.length,0);
        console.log('Guest media access, private results, CSRF, real quotas and non-admin isolation passed');
    }finally{jobs.shutdown();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
