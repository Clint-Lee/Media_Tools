'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function jsRuntimeArgs({ env = process.env, version = process.versions.node, executable = process.execPath,
    bundledExecutable = process.platform === 'win32' ? path.join(__dirname, '..', '.runtime', 'js-node', 'node.exe') : '' } = {}) {
    const selected = env.YTDLP_JS_RUNTIME?.trim();
    if (selected) {
        if (selected.length > 1024 || !/^(?:node|deno)(?::[^\r\n]+)?$/.test(selected))
            throw new Error('YTDLP_JS_RUNTIME 必须为 node、deno 或 node:/deno: 加本机可执行文件路径');
        return ['--js-runtimes', selected];
    }
    // EJS 不支持 Node 20；保留 yt-dlp 的默认 Deno 检测，不强制不兼容的进程。
    if (Number(version.split('.')[0]) >= 22) return ['--js-runtimes', 'node:' + executable];
    return bundledExecutable && fs.existsSync(bundledExecutable) ? ['--js-runtimes', 'node:' + bundledExecutable] : [];
}

function proxyArgs(url, env = process.env) {
    const host = new URL(url).hostname;
    const domestic = ['douyin.com', 'iesdouyin.com', 'bilibili.com', 'b23.tv', 'xiaohongshu.com', 'xhslink.com', 'kuaishou.com', 'gifshow.com']
        .some(domain => host === domain || host.endsWith('.' + domain));
    // 不继承系统残留 HTTP_PROXY；国内源直连，境外源只用运营者明确配置的代理。
    return ['--proxy', domestic ? '' : env.MEDIA_PROXY || ''];
}

async function extractMetadata(url, { metadataOnly = false, anonymous = false } = {}) {
    require('./safe-network').platformUrl(url);
    const python = process.env.MEDIA_PYTHON || path.join(__dirname, '..', '.runtime', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    if (!fs.existsSync(python)) throw new Error('通用媒体解析引擎未安装，请运行 scripts/setup-media.ps1');
    const args = ['-m', 'yt_dlp', '--ignore-config', '--no-plugin-dirs', ...jsRuntimeArgs(), '--no-remote-components', '--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings', '--socket-timeout', '15', '--retries', '1', ...proxyArgs(url)];
    if (metadataOnly) args.push('--ignore-no-formats-error');
    else args.push('-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best');
    const cookieFile=anonymous ? null : require('./platform-session').cookieFile(url);
    if (cookieFile) args.push('--cookies', cookieFile);
    args.push('--', url);
    return new Promise((resolve, reject) => {
        const child = spawn(python, args, { windowsHide: true });
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
        let output = '', error = '', stopped = '';
        const timer = setTimeout(() => { stopped = '媒体解析超过60秒时限'; child.kill(); }, 60000);
        child.stdout.on('data', chunk => {
            if (stopped) return;
            output += chunk;
            if (output.length > 20 * 1024 * 1024) { stopped = '媒体元数据超过20MB上限'; child.kill(); }
        });
        child.stderr.on('data', chunk => { error = (error + chunk).slice(-2000); });
        child.on('error', err => { clearTimeout(timer); reject(err); });
        child.on('close', code => {
            clearTimeout(timer);
            if (stopped) return reject(new Error(stopped));
            if (code !== 0) return reject(new Error('公开媒体解析失败，可能受网络、地区、验证墙或作品权限限制；未要求使用者登录：' + error.slice(-500)));
            try { resolve(JSON.parse(output)); } catch { reject(new Error('平台没有返回有效媒体信息')); }
        });
    });
}
module.exports = { extractMetadata, jsRuntimeArgs, proxyArgs };
