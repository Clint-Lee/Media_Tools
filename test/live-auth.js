'use strict';
// 联网验收使用真实本地注册账号；凭证仅写忽略于Git的私有验收缓存，不输出日志。
const fs=require('fs'),path=require('path'),crypto=require('crypto');
async function liveAuth(base) {
    const filename=path.join(__dirname,'..','.cache','verification','test-account.json');
    let credentials;
    if(process.env.TEST_ACCOUNT_USERNAME && process.env.TEST_ACCOUNT_PASSWORD) credentials={username:process.env.TEST_ACCOUNT_USERNAME,password:process.env.TEST_ACCOUNT_PASSWORD};
    else { try { const saved=JSON.parse(fs.readFileSync(filename,'utf8')); if(saved.base===base)credentials=saved; } catch {} }
    if(!credentials) credentials={base,username:'audit_'+crypto.randomBytes(6).toString('hex'),password:crypto.randomBytes(24).toString('base64url')};
    const send=async endpoint=>fetch(base+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)});
    let response=await send('/api/auth/login');
    if(response.status===401)response=await send('/api/auth/register');
    if(!response.ok)throw new Error('无法建立真实验收账号：HTTP '+response.status);
    const cookie=response.headers.get('set-cookie')?.split(';')[0];
    if(!cookie)throw new Error('真实登录未返回服务端会话');
    if(!process.env.TEST_ACCOUNT_USERNAME) { fs.mkdirSync(path.dirname(filename),{recursive:true}); fs.writeFileSync(filename,JSON.stringify(credentials),{mode:0o600}); }
    return {cookie,username:credentials.username};
}
module.exports={liveAuth};
