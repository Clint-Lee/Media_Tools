# 服务器部署与换设备接续

2026-10-29 补充：仓库已迁移、远端改名，本机媒体运行时已重建；见[最新接续](HANDOFF_2026-10-29.md)。yt-dlp锁定2026.10.26，Python最低3.11；Windows另有 `npm run setup:ytdlp-js` 安装项目专用Node24（官方SHA256校验），Linux可显式配置兼容JS运行时。`.runtime`及模型不随Git分发。下文为历史审查清单，行号和状态须以当前代码核对；YouTube实际媒体下载现已委托yt-dlp，因此Python出站限制不仅影响元数据，也影响媒体流。

文档定稿：2026-10-23；审查基于2026-10-21代码`48b6afb`，续查提交未变。这是部署准备与未完成工作清单，**不是已经验收的生产部署教程**。已做首批业务修复，详见[实现记录](IMPLEMENTATION_2026-10-23.md)；未上线服务器或安装/升级运行环境。

## 当前部署判定

- 现有完整媒体安装入口面向Windows x64；Linux/macOS/ARM没有冷机完整验收。
- 当前仅按一个Node进程设计；JSON原子写不是多实例事务，不要直接开cluster、PM2多实例、Kubernetes多副本或重叠滚动启动。
- 可以先在受控的本机/私网环境开发和验证。公网开放前必须处理下面的P1项，以及[审查文档](REVIEW_2026-10-21.md)中的M01–M04。
- 没有已验收的Docker、systemd、生产反向代理模板或专用readiness服务。`/api/system/status`报告配置/近次观测，不能代替真实健康和容量检查。

## 上线前必须解决

### D01 · P1：可信反代、HTTPS和客户端IP

`server.js:29`未配置可信代理；账号/访客使用`req.secure`生成Secure Cookie、使用`req.ip`计算限额。TLS在反代终止、HTTP转给Node时，当前配置可能不带Secure且把所有人算作代理IP。

下一步应根据真实拓扑只信任指定代理跳数/地址，保留浏览器Host，覆盖不可信的转发头；不要笼统设`trust proxy=true`。CDN→Nginx→Node和单层代理不能共用未经验证的信任配置。[Express官方说明](https://expressjs.com/en/guide/behind-proxies/)

验收：实际域名HTTPS登录/访客Cookie带Secure；两个客户端IP配额独立；伪造X-Forwarded-For无效；同源修改成功、跨站拒绝；服务端注销/过期正常。额外配置HSTS需与域名HTTPS策略一起验证。

### D02 · P1：公开代理和匿名入口的资源预算

非下载模式的`/api/proxy-video`、`/api/proxy-image`可被公开调用，已有URL/DNS/重定向检查，但没有充分的全局并发、累计字节与带宽预算；每日成功任务额度不等于入口限流。

补会话创建/IP速率、连接/请求并发、媒体代理限速、任务输入/输出/时长/磁盘水位及总缓存上限。只让浏览器请求合法平台资源不代表不会被大流量滥用。详见M03/M04。

反代层另验证Range/206、Content-Range、客户端断连和长响应；对媒体流评估buffering和临时磁盘开销，对API设置合理超时。不能以无限延长超时代替修复卡住的采集。[Nginx代理模块说明](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)

验收：超限稳定拒绝、断连释放上游、低磁盘中止且安全清理，其他用户仍能访问状态页。不要只做一次小视频下载测试。

### D03 · P1：统一出站保护与浏览器隔离

已有`lib/safe-network.js`公网DNS/重定向保护，不应说项目完全没有SSRF防护；但覆盖不是端到端一致：

- `lib/yt-dlp-parser.js:16`的Python子进程自行获取网页/清单、跟随重定向，不继承JS的publicLookup/beforeRedirect。当前有`--skip-download`，所以这里是**元数据提取出站**，不能写成yt-dlp负责下载媒体。
- `lib/downloader-core.js:147–158`的部分短链展开用普通Axios；快手展开后转通用解析的分支还需复核目标平台。
- 实际媒体下载回到Node并使用mediaOptions；代理端DNS解析也不能一概视为本机lookup保护已生效。

以上是静态覆盖缺口，**本轮没有证实可利用的内网访问**。建议统一短链/子进程网络策略，并用低权限账户、容器/网络出站ACL限制内网、元数据地址和不必要文件访问。

Chromium当前固定`--no-sandbox --disable-setuid-sandbox`（`live-sources.js:57`）。公网环境应验证可用沙箱或等效隔离，不要直接以开发者管理员桌面身份执行外部网页。[Puppeteer官方故障与沙箱说明](https://pptr.dev/troubleshooting)

验收：用隔离假DNS/重定向/子进程探针覆盖所有路径；不在真实服务器上尝试访问敏感内网以“验证安全”。

### D04 · P1：运营者个人凭证不能成为匿名共享权限

匿名发现与可选个人凭证上下文已分离，但`platform-session.js`、yt-dlp和部分解析仍可读取服务级Cookie。最终用户免登录，不意味着公共请求可以借用运营者个人权限。

公网默认不放入个人Cookie/浏览器资料；如确有合法授权使用需求，先定义租户、内容授权、凭证存取/过期/审计边界。不要复制个人浏览器profile或在聊天/日志中粘贴Cookie。官方API应用凭证同样需要私有存储、限额和权限实测。

验收：访客不会因运营者配置而取得原本无权访问的作品；凭证不出现在响应/URL/日志/仓库。没有凭证时仍能按公开范围使用，不恢复扫码门槛。

## 可复现安装与扩容准备

### D05 · P2：固定运行版本与包管理器

- 本机只读核验为Node20.20.0/npm10.8.2/pnpm10.32.1；Node20截至2026-10-21已EOL。20.12只是`.env`能力下限。先在受支持LTS（例如24）验证后再固定生产版本，不直接替换现有环境。[Node发布状态](https://nodejs.org/en/about/previous-releases)
- 仓库有pnpm锁而没有已提交npm锁，旧说明使用npm install；npm不按pnpm锁解析，无法由此保证依赖一致。[npm安装规则](https://docs.npmjs.com/cli/v10/commands/npm-install/)
- `pnpm-workspace.yaml`的`allowBuilds.puppeteer`是占位字符串，需要选定包管理器后按实际版本修正、固定版本并做冻结锁冷装；不要声称当前直接可冻结复现。[pnpm配置说明](https://pnpm.io/10.x/settings#allowbuilds)
- Chromium缓存通常在安装用户目录；换成服务账户、容器或设备后不会自动存在。明确浏览器下载/可执行路径策略，应用与所有浏览器测试都应遵守`PUPPETEER_EXECUTABLE_PATH`；当前并非所有测试都采用同一探测逻辑。

验收：干净机器安装不漂移锁文件；普通服务账户能启动实际浏览器；测试和本地LLM原生模块兼容所选Node/OS。

### D06 · P2：目标OS安装器与模型路线

`scripts/setup-media.ps1`硬编码PowerShell、uv.exe、python.exe、npm.cmd、curl.exe、`@node-llama-cpp/win-x64`；不能把它当Linux/macOS安装脚本。不要复制Windows venv或原生包到另一OS/架构。

后续交付目标OS安装器或容器构建，固定Python/媒体依赖/原生包与模型校验。现有大模型有SHA256校验，但部分附属配置和传递依赖仍需锁定。

模型文件约4GB不等于运行内存4GB；还需Chromium、ASR、LLM上下文、转码与保留文件。先实测峰值RSS/CPU/磁盘再选容量，不能承诺小内存VPS实时分析。当前本地LLM为`gpu:false`、ASR默认CPU/int8，装GPU不代表自动启用加速。

可选远端LLM会发送真实字幕，应有用户可见的数据去向与同意边界。仅字幕/原句摘录、缺本地模型、远端失败应分别展示，不把安装存在性当运行就绪。

验收：目标OS冷机完成短公开作品的解析、实际音轨、MP4/MP3解码、平台字幕/ASR、本地或明确远端总结、原句/时间戳对照；记录耗时与峰值资源。

### D07 · P2：单进程存储和任务生命周期

账号、会话、额度、采集索引、任务存在本地JSON/内存中；多进程读改写可能相互覆盖，启动还会清理预占。原子rename防半文件，不提供跨进程事务。切换目录会影响带绝对路径的任务文件。

当前只运行一个实例，停服维护管理员/数据；升级先停旧进程再启新进程，明确运行中任务会中断而非续跑。将来扩容应先交付事务存储、共享会话/额度、持久队列和对象/文件所有权设计。

### D08 · P2：监控、清理与恢复

- M02索引内过期清理已修，历史无索引orphan仍待受控盘点；再建立受控临时文件盘点、磁盘水位、写入失败、队列等待、任务失败、来源成功率与延迟指标；当前没有完整监控/readiness闭环。
- `.bak`不是异机定时备份；为账号库、采集索引、必要配置做加密备份与恢复演练。恢复后验证角色/登录/历史/索引，不只检查文件存在。
- 日志脱敏、轮转、保留期、作业中断提示、模型缺失和代理失联均应告警；不向公共状态页暴露凭证与绝对私有路径。

## 换设备迁移

先记录Git分支/提交、未提交修改、OS/CPU架构、运行版本和环境变量名称；当前旧路径/PID不可复用。应用有写入时先停服做一致性备份，勿通过聊天传输私有库。

| 数据 | 建议 |
|---|---|
| Git源码/文档/锁 | 正常拉取；工作区补丁另行保存，不能漏掉未提交文件 |
| `.runtime/data/accounts.json`或HOTPOT_DB_FILE | 按需加密迁移；含账号、会话/历史/额度，限制ACL。`db.json`是旧库导入来源，不是当前主账号库 |
| `.cache/collected-videos/`及`.bak` | 需要保留采集历史时迁移；实际目录可由HOTPOT_COLLECTION_DIR覆盖 |
| `.env`、`.runtime/platform-sessions/`、`.runtime/platform-logins/`、Cookie文件 | 敏感、单独授权传输；会话目录可由HOTPOT_SESSION_DIR覆盖；公网通常不迁移个人凭证，不要随源码压缩包分发 |
| `.runtime/models/` | 可按许可复用并验证哈希；其存在不代表新平台能加载 |
| node_modules、Python venv、LLM原生包、Chromium | 新设备重建，不跨OS直接复制 |
| `.cache/media/` | 临时产物，索引含绝对路径；不要当永久可迁移资产。需要的合法成品先单独导出 |
| 源快照、YouTube指标缓存、访客历史 | 可重建/有时效，迁移不得重写观测时间；访客历史主要驻内存，不保证新设备续接 |

不要直接复制整个开发目录、私人浏览器profile、测试账号文件、日志或历史音视频到公开服务器。处理者只能搬迁自己有权保存的数据。

### 配置核对

所有路径按新机器重新设置，私有目录不得放进`public/`。环境变量可在根目录`.env`或服务环境中配置；不要用下面的名称清单代替权限和网络验收。

| 范围 | 变量 |
|---|---|
| 服务 | HOST、PORT、HOTPOT_ALLOWED_HOSTS、HOTPOT_PREWARM |
| 数据 | HOTPOT_DB_FILE、HOTPOT_SESSION_DIR、HOTPOT_COLLECTION_DIR、HOTPOT_SOURCE_CACHE、HOTPOT_YOUTUBE_METRICS_DIR、HOTPOT_MEDIA_CACHE |
| 工具/模型 | PUPPETEER_EXECUTABLE_PATH、MEDIA_PYTHON、FFMPEG_PATH、ASR_MODEL_PATH、LOCAL_LLM_MODEL_PATH |
| 网络/语义 | MEDIA_PROXY、LLM_BASE_URL、LLM_MODEL、LLM_API_KEY |
| 可选接口/授权 | YOUTUBE_API_KEY、X_BEARER_TOKEN、X_SEARCH_ARCHIVE、DOUYIN_CLIENT_TOKEN或DOUYIN_CLIENT_KEY、DOUYIN_CLIENT_SECRET；各平台Cookie、MEDIA_COOKIES_FILE仅在授权边界明确时使用 |

初次受控验证可保持HOST=127.0.0.1、PORT=4000并设HOTPOT_PREWARM=0，避免刚启动就多源外访。自定义域名要加入HOTPOT_ALLOWED_HOSTS；只有在D01等前置完成后才开放入口，不把改成0.0.0.0当部署方案。

## 三条网络路径需分别验收

1. **服务器采集/媒体**：新服务器出站、地区、DNS、TLS和代理。127.0.0.1指服务器自身；MEDIA_PROXY不是原电脑代理的远程共享。部分安装下载和Python宿主代理还有独立策略。
2. **模型/依赖安装**：模型下载脚本含`--noproxy '*'`，不受MEDIA_PROXY统一控制；无法下载时先查安装网络，不反复下载到同一生产目录。
3. **用户浏览器**：Font Awesome、DiceBear、嵌入播放器、OSM/Esri瓦片。服务端能访问不代表临时设备浏览器也能访问；优先本地图标与可读降级，地球保留本地概览。

OSM公共瓦片无SLA，有限容量且限制批量下载/预取；保留署名、Referer和正常缓存，不把免费服务当无限并发商用后端。[OSM使用政策](https://operations.osmfoundation.org/policies/tiles/)

国家名称/边界、地图服务、模型、FFmpeg、图标和vendored资源还需检查来源、许可与实际运营地区要求；现有Natural Earth许可文件不等于全部分发许可审计完成。

## 上线/迁移验收门槛

- [ ] R01–R04、M01/M02虽已有代码回归，仍要实际验收；M03后续/M04及公网D01–D04未完成，当前仅受控验证。
- [ ] 干净目标设备安装、冻结依赖、Chromium及实际模型加载通过。
- [ ] 不要求手机/扫码；访客与不同账号文件/历史互不可见，真实IP额度和跨日结算正确。
- [ ] 原作品指标/日期/封面对账；缺字段不填造；下一页真实推进；热度与播放不混。
- [ ] 实际媒体字节/音视频轨/字幕/总结引用通过；Range、断连、长队列、磁盘不足可控。
- [ ] 停机跨过缓存保留期、重启中断、备份恢复、换目录后不返回失效下载链接。
- [ ] 负载/流量/缓存水位与告警达标；只启一个实例，模型和数据不在静态公开目录。

验收脚本及副作用见 [RELIABILITY.md](RELIABILITY.md)。以上勾选须由真实结果支持，不能只因npm test成功或模型文件存在而勾选。
