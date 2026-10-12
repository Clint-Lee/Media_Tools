'use strict';
require('../lib/env');
// 仅供拥有本机项目访问权限的维护者使用；不开放免密码网页提权。
const readline = require('readline/promises');
const { store } = require('../lib/accounts');
async function secret(prompt) {
    if (!process.stdin.isTTY) throw new Error('非交互环境需通过 HOTPOT_ADMIN_PASSWORD 设置密码，不能通过命令行参数传递');
    process.stdout.write(prompt); process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    return new Promise((resolve, reject) => {
        let value = '';
        function finish(error) { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); error ? reject(error) : resolve(value); }
        function onData(text) { for (const char of text) { if (char === '\u0003') return finish(new Error('已取消')); if (char === '\r' || char === '\n') return finish(); if (char === '\u007f' || char === '\b') value = value.slice(0, -1); else value += char; } }
        process.stdin.on('data', onData);
    });
}
(async () => {
    let username = process.env.HOTPOT_ADMIN_USERNAME;
    if (!username) { const input = readline.createInterface({ input: process.stdin, output: process.stdout }); username = await input.question('管理员账号：'); input.close(); }
    const password = process.env.HOTPOT_ADMIN_PASSWORD || await secret('管理员密码（输入不回显，至少12字符）：');
    if (!process.env.HOTPOT_ADMIN_PASSWORD && password !== await secret('再次输入密码：')) throw new Error('两次密码不一致');
    const user = await store.register({ username, password, nickname: '系统管理员' }, 'admin', true);
    console.log('真实管理员已创建：' + user.username + '。请从网页使用账号密码登录；没有输出或保存明文密码。');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
