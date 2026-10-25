'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function jsRuntimeArgs({ env=process.env, version=process.versions.node, executable=process.execPath }={}) {
    const configured=env.YTDLP_JS_RUNTIME?.trim();
    if(configured) {
        if(configured.length>1024 || !/^(?:node|deno)(?::[^\r\n]+)?$/.test(configured))throw new Error('YTDLP_JS_RUNTIME仅支持node或deno及其本机可执行路径');
        return ['--js-runtimes',configured];
    }
    // Current yt-dlp EJS requires Node >=22. On older hosts leave its normal Deno discovery intact.
    return Number(version.split('.')[0])>=22?['--js-runtimes','node:'+executable]:[];
}

async function extractMetadata(url) {
    const python = process.env.MEDIA_PYTHON || path.join(__dirname, '..', '.runtime', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    if (!fs.existsSync(python)) throw new Error('通用媒体解析引擎未安装，请运行 scripts/setup-media.ps1');
    const runtimeArgs=jsRuntimeArgs();
    const args = ['-m', 'yt_dlp', '--ignore-config', '--no-plugin-dirs', ...runtimeArgs, '--no-remote-components', '--dump-single-json', '--skip-download', '--no-playlist', '--no-warnings', '--socket-timeout', '15', '--retries', '1', '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best'];
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
            if (code !== 0) {
                let youtube=false;try{const host=new URL(url).hostname;youtube=host==='youtu.be' || host==='youtube.com' || host.endsWith('.youtube.com');}catch{}
                const runtimeHint=youtube && !runtimeArgs.length?' 当前Node低于22，未强制注入不受支持版本；请检查Deno 2.3+或配置YTDLP_JS_RUNTIME指向Node 22+，并核验yt-dlp-ejs。':'';
                return reject(new Error('公开媒体解析失败，可能受网络、地区、验证墙或作品权限限制；未要求使用者登录。'+runtimeHint+' '+error.slice(-500)));
            }
            try { resolve(JSON.parse(output)); } catch { reject(new Error('平台没有返回有效媒体信息')); }
        });
    });
}
module.exports = { extractMetadata, jsRuntimeArgs };
