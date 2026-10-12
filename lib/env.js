'use strict';
const fs=require('fs'),path=require('path');
const filename=path.join(__dirname,'..','.env');
if(fs.existsSync(filename)) {
    if(typeof process.loadEnvFile!=='function') throw new Error('加载私有配置需要Node.js 20.12或更新版本');
    try { process.loadEnvFile(filename); } catch { throw new Error('.env配置读取失败，请检查格式；未输出任何凭证内容'); }
}
