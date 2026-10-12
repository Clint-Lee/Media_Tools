'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:4000';
(async()=>{
    const report={checkedAt:new Date().toISOString(),platforms:[]};
    const {list}=await (await fetch(base+'/api/platforms')).json();
    for(const platform of list.map(p=>p.platform)) {
        const entry={platform};
        for(const kind of ['videos','topics']) {
            const endpoint=kind==='videos'?'/api/trends':'/api/topics';
            const response=await fetch(base+endpoint+'?'+new URLSearchParams({platform,category:'all',timeRange:'all',refresh:1}),{signal:AbortSignal.timeout(60000)});
            const data=await response.json();
            if(response.ok) {
                assert.equal(data.success,true); assert.ok(Array.isArray(data.list));
                if(kind==='videos') { assert.equal(data.scope.exhaustive,false); assert.ok(data.list.every(v=>v.id && v.title && v.url),'作品必须有原平台身份与链接'); }
                entry[kind]={status:'verified-response',count:data.list.length,source:data.source,metric:data.scope?.metric,partial:data.partial || false,message:data.sourceMessage};
            } else {
                assert.equal(data.success,false); assert.equal(data.list.length,0,'访问失败不能替换成固定素材');
                entry[kind]={status:'unavailable',httpStatus:response.status,message:data.message};
            }
        }
        report.platforms.push(entry); console.log(JSON.stringify(entry));
    }
    const auth=await require('./live-auth').liveAuth(base);
    const me=await (await fetch(base+'/api/auth/me',{headers:{Cookie:auth.cookie}})).json();
    assert.ok(me.user.quota); report.account={role:me.user.role,quota:me.user.quota};
    report.system=await (await fetch(base+'/api/system/status')).json();
    fs.mkdirSync(path.join(__dirname,'..','.cache','verification'),{recursive:true});
    fs.writeFileSync(path.join(__dirname,'..','.cache','verification','system-audit.json'),JSON.stringify(report,null,2));
    console.log('System audit recorded real availability, not an assertion that every platform is connected');
})().catch(error=>{console.error(error);process.exitCode=1});
