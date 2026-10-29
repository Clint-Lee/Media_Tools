# 运行、换设备与交付说明

更新：2026-10-29；代码基线 `1e27760`。本文提供现有开发运行路径，不代表Linux冷机或公网部署已验收。当前问题以[根交接](../HANDOFF.md)为准。

## 1. 仓库和分支

```powershell
git clone --branch hotVideo https://github.com/Clint-Lee/Media_Tools.git
cd Media_Tools
git status --short --branch
```

已有仓库只需核对并更新远端，不要重建或覆盖用户工作树：

```powershell
git remote set-url origin https://github.com/Clint-Lee/Media_Tools.git
git fetch origin
git status --short --branch
```

确认无本地改动、当前就是目标分支且无需合并后，才用 `git pull --ff-only origin hotVideo`。若提示分歧，先处理分歧，不要强推或硬重置。

## 2. 最小启动：只看榜单

需要Node.js、npm和可启动的Chrome/Chromium。应用配置加载最低要求Node20.12；服务器应使用经过项目测试的受支持LTS，而不是将此最低版本当作生产建议。

```powershell
npm install
if (-not (Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
npm start
```

`Copy-Item`仅适用于没有私有`.env`的新设备；已有配置不要覆盖。默认访问 `http://localhost:4000`，监听 `127.0.0.1`。只看榜单不需要Whisper/Qwen模型；境外来源仍受服务器网络影响。若浏览器无法启动，可在`.env`配置实际安装的 `PUPPETEER_EXECUTABLE_PATH`。

当前包管理器/锁文件尚未统一，`npm install`不是冻结依赖的可复现生产部署。不要在未知状态下混用npm和pnpm重写锁文件。

## 3. Windows x64媒体环境

```powershell
npm run setup:media
```

安装器会准备项目私有Python依赖、yt-dlp、FFmpeg包、项目专用Node运行时、本地LLM依赖，并下载Whisper/Qwen模型。大模型约需数GB磁盘、下载流量和时间；不要把它当作瞬时命令反复运行。先检查旧设备已有模型是否能合法复制并校验，避免重复下载。

只补YouTube JS运行时可运行：

```powershell
npm run setup:ytdlp-js
```

该步骤从Node官方站点下载固定的Windows x64 Node24.22.2，核对SHA256，写入`.runtime/js-node`，不替换系统Node。yt-dlp优先使用显式 `YTDLP_JS_RUNTIME`，其次兼容的应用Node，最后项目专用Node；Node20不会被强制传给yt-dlp。固定媒体版本为yt-dlp2026.10.26，需Python至少3.11。

已有环境可在私有`.env`显式指定：

```dotenv
MEDIA_PYTHON=D:/your-runtime/venv/Scripts/python.exe
ASR_MODEL_PATH=D:/your-models/whisper-medium
YTDLP_JS_RUNTIME=node:D:/your-runtime/node.exe
```

路径按实际机器填写，不能原样复制示例。`YTDLP_JS_RUNTIME`也可设为`deno`或`deno:完整路径`（Deno至少2.3）。模型存在不代表能成功加载；Windows应用控制策略可能拦截本地LLM原生模块。本轮新目录的字幕和Whisper通过，神经LLM未恢复，TextRank是抽取兜底。

Linux/macOS不能直接运行现有Windows安装器；须另行安装Python、锁定的`scripts/media-requirements.txt`、JS运行时及模型，配置路径，并完成真实任务验收。这条路径尚未做冷机完整验证。

## 4. 网络和免登录

- 默认访客使用本应用的HttpOnly临时会话隔离任务，不要求手机验证码、HotPot注册或平台扫码。丢失访客Cookie可能无法再访问原任务。
- 原站正常发放的匿名技术Cookie不等于个人账号登录。可选运营者API权限不等于终端使用者必须登录，也不保证所有作品公开。
- `.env`中的 `MEDIA_PROXY`应指向运行服务器实际可用的代理；不要把开发电脑的`127.0.0.1:7897`复制到远程服务器当作已配置。
- 国内元数据通常直连；境外请求可走显式代理。平台CDN遇到Fake-IP时，应使用已知CDN的现有安全代理路径，不要通过关闭SSRF/DNS检查解决。
- 视频嵌入、图标和地图瓦片也会由访问者浏览器请求；服务端代理正常不代表客户端都能访问。
- 抖音/小红书缺失的播放量仍是未知；切换公开点赞榜是另一种指标选择，不是获得真实播放的办法。`10万+`仅为下界。

## 5. 验证顺序

```powershell
npm test
```

该命令包含4个指标pretest及29个原有入口，挂禁网守卫，允许本机回环测试服务。2026-10-29代码修复阶段全部通过；本文档整理阶段不重复宣称新增联网验收。

浏览器测试需要先启动专用本机测试实例，可按实际情况设置`TEST_BASE_URL`、`PUPPETEER_EXECUTABLE_PATH`。联网测试会抓取平台、写采集快照；媒体测试可能注册/复用测试账号、创建任务、下载真实文件。先读[验收说明](RELIABILITY.md)，使用独立的`HOTPOT_DB_FILE`、`HOTPOT_MEDIA_CACHE`、`HOTPOT_COLLECTION_DIR`，不要对生产实例一键运行全部脚本。

真实验收至少分开确认：

1. 作品ID、封面、发布时间及指标属于同一作品，筛选和名次正确。
2. 元数据解析成功且有实际媒体地址，不用其它推荐视频替换。
3. 完整文件成功下载，实际解复用存在音视频轨；Range响应或直链存在不是完整下载证明。
4. 平台字幕与ASR分别测试，引用能回溯到转写；准确标记LLM/TextRank/摘录。

## 6. 需要迁移和不能提交的内容

| 内容 | 迁移原则 |
|---|---|
| `.env`、运营者密钥、SSO配置 | 使用安全渠道单独配置；不提交Git，不在日志输出 |
| `.runtime`工具与Python venv | 重新安装；venv和平台二进制不能直接跨系统/路径复制 |
| Whisper/Qwen模型 | 可复制兼容模型并校验哈希，或运行安装器下载；不要提交Git |
| 账号JSON、采集索引、媒体任务索引 | 停止写入后做一致性备份；包含私有数据，核对实际路径和环境变量 |
| `.cache`、下载文件、诊断报告 | 临时数据不是固定源；有保留时间及过期链接，不视为永久存储 |
| 访客会话 | 主要是进程内状态，重启/换设备不保证恢复，不能承诺永久历史 |

不要在服务仍写JSON时直接复制半套文件，也不要把旧目录、开发机器代理和个人浏览器凭证隐式绑定到新设备。

## 7. 自有服务器上线前

当前只按单Node进程运行；不要直接开PM2多实例、cluster或多副本滚动部署。至少完成：

- 显式 `HOST` / `HOTPOT_ALLOWED_HOSTS`、真实域名、HTTPS及可信反代配置。
- 验证安全Cookie、来源检查、可信客户端IP与配额隔离；不信任任意转发头。
- IP/会话创建速率、并发、总磁盘水位、整任务下载/输出/带宽预算与断连清理。
- Python、Chromium及代理的出站隔离；JS层URL校验不覆盖所有子进程请求。
- 大文件Range/206、长任务超时、日志、备份恢复与磁盘失败测试。
- 私有配置不公开；Badge SSO未配置时的开发默认值不能直接用于生产。

详细风险和验收标准见[部署清单](DEPLOYMENT.md)。七个平台各一个下载样本成功，不等于服务器稳定性或公网安全已经验收。
