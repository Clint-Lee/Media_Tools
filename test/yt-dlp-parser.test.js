'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const filename = path.join(__dirname, '../lib/yt-dlp-parser.js');
const source = fs.readFileSync(filename, 'utf8');
const calls = [];
let personalReads = 0;
const sandbox = { module: { exports: {} }, __dirname: path.dirname(filename), setTimeout, clearTimeout, URL,
    process: { env: { MEDIA_PYTHON: 'fixture-python', MEDIA_PROXY: 'http://proxy.test:7897' }, platform: 'win32', versions: { node: '20.20.0' }, execPath: 'unsupported-old-node' },
    require(name) {
        if (name === 'fs') return { existsSync: value => value === 'fixture-python' };
        if (name === 'path') return path;
        if (name === './platform-session') return { cookieFile() { personalReads++; return 'private-cookie-file'; } };
        if (name === './safe-network') return require('../lib/safe-network');
        if (name === 'child_process') return { spawn(executable, args, options) {
            calls.push({ executable, args, options });
            const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
            setImmediate(() => { child.stdout.end(JSON.stringify({ id: 'jNQXAC9IVRw', view_count: 1234, like_count: 99 })); child.emit('close', 0); });
            return child;
        } };
        throw new Error('Unexpected module ' + name);
    }
};
vm.runInNewContext(source, sandbox, { filename });
(async () => {
    const engine = sandbox.module.exports;
    const info = await engine.extractMetadata('https://www.youtube.com/watch?v=jNQXAC9IVRw', { metadataOnly: true, anonymous: true });
    assert.equal(info.view_count, 1234);
    assert.equal(personalReads, 0, '匿名元数据尝试不能读取个人 Cookie');
    const { args } = calls[0];
    assert.ok(args.includes('--ignore-no-formats-error'), '计数读取不依赖下载格式是否可用');
    assert.ok(!args.includes('-f'));
    assert.ok(!args.includes('--js-runtimes'), '没有可用运行时就不强制 Node20');
    assert.ok(args.includes('--no-plugin-dirs') && args.includes('--no-remote-components'));
    assert.equal(args.at(-2), '--');
    assert.equal(args[args.indexOf('--proxy') + 1], 'http://proxy.test:7897');
    await engine.extractMetadata('https://www.douyin.com/video/7702031843788344610');
    assert.equal(calls[1].args[calls[1].args.indexOf('--proxy') + 1], '', '国内源不能误用境外代理');
    assert.ok(calls[1].args.includes('-f'));
    assert.ok(calls[1].args.includes('--cookies'));
    await assert.rejects(() => engine.extractMetadata('http://127.0.0.1/private'), /内网|保留地址/);
    assert.equal(calls.length, 2, '被拒绝链接不能启动 Python');
    console.log('yt-dlp production arguments, metadata-only mode, anonymous isolation and URL validation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
