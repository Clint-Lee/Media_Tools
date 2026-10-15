'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function extractMetadata(url) {
    const python = process.env.MEDIA_PYTHON || path.join(__dirname, '..', '.runtime', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    if (!fs.existsSync(python)) throw new Error('通用媒体解析引擎未安装，请运行 scripts/setup-media.ps1');
    const args = ['-m', 'yt_dlp', '--ignore-config', '--no-plugin-dirs', '--js-runtimes', 'node:' + process.execPath, '--no-remote-components', '--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings', '--socket-timeout', '15', '--retries', '1', '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best'];
    if (process.env.MEDIA_PROXY) args.push('--proxy', process.env.MEDIA_PROXY);
    const cookieFile=require('./platform-session').cookieFile(url);
    if (cookieFile) args.push('--cookies', cookieFile);
    args.push('--', url);
    return new Promise((resolve, reject) => {
        const child = spawn(python, args, { windowsHide: true });
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
        let output = '', error = '';
        const timer = setTimeout(() => child.kill(), 60000);
        child.stdout.on('data', chunk => { output += chunk; if (output.length > 20 * 1024 * 1024) child.kill(); });
        child.stderr.on('data', chunk => { error = (error + chunk).slice(-2000); });
        child.on('error', err => { clearTimeout(timer); reject(err); });
        child.on('close', code => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error('公开媒体解析失败，可能受网络、地区、验证墙或作品权限限制；未要求使用者登录：' + error.slice(-500)));
            try { resolve(JSON.parse(output)); } catch { reject(new Error('平台没有返回有效媒体信息')); }
        });
    });
}
module.exports = { extractMetadata };
