# 2026-10-25 数据来源调研与下一步接手

基线：`917d476`，分支`hotpot-wip`（不是hotVideo），工作区起始干净。该提交已经保存10月23日改动，旧文档“仍未提交37项”不再代表当前状态。本轮读取最新代码、原作者GitHub及官方文档，补了小范围接线/运行环境代码；没有购买服务、登录平台、安装新模型或执行全平台真实媒体验收。

## 一、现在能否勉强满足要求

**可以作为受控单机的有限样本发现、公开指标比较和字幕/原声学习工作台继续试用；不能按原愿景验收为七平台真实播放总榜或直接交付公网。** 这是代码与证据审查结论，不是本轮实测可用率。

| 要求 | 当前判断 |
|---|---|
| 默认不要求终端用户手机/扫码 | 使用流程具备；匿名不等于平台开放全部数据，运营者可选应用凭证要单独说明 |
| 各平台真实作品与已公开点赞 | 有对应采集/身份/精度链路，仍受来源、地区与限流影响；不是完整覆盖 |
| 所有平台播放量降序、历史总榜 | **不满足**：抖音/小红书匿名播放仍缺，候选有限；没有播放的作品不能排名 |
| 分类/3天/7天、30条懒加载 | 已有逻辑与隔离回归；严格日期会排除未知，样本不足不等于全站无视频；前端30条不是上游完整采集 |
| 下载/字幕/AI分析 | 有真实媒体及字幕/ASR/文本总结链路，不是任意作品保证；YouTube有运行依赖门槛，快手通用提取不能保证支持 |
| 地球展示来源城市 | 是有限地名关联而非来源定位，暂无多地/证据下钻；不代表作者IP |
| 直接部署服务器交付用户 | **不建议**：可信反代、流量/磁盘预算、共享状态、Linux冷机验收等仍未完成 |

## 二、最有价值的调研结论

“支持平台”要拆成四项：作品发现、独立指标、媒体地址、实际下载/解码。接口能返回点赞或MP4，不等于它有播放量；显示播放按钮也不证明下载成功。

### A. 抖音：官方应用能力优先，不是要求每个用户扫码

当前官方“查询热点视频”能力明确列点赞、下载、播放、分享等字段，网站应用等可申请，但需审批且不支持沙盒。现有`lib/douyin-open.js`已是可继续验证的入口，首先核对获批scope、当前端点及真实响应，不必先换爬虫框架。[官方能力页](https://developer.open-douyin.com/capacity-center-page/capacity-detail/7180573594794065975)

详细文档的`/hotsearch/videos/`使用应用client_token，不要求终端用户授权；但旧详细站样例年代较早，不能把示例当2026实测。范围仅热点关联作品，不是任意作品或全站历史。[官方端点说明](https://open.douyin.com/platform/resource/docs/openapi/data-open-service/hot-video-data/get-hot-words-polymerization-video/)

**下一步**：运营者若愿意申请，一次取得合法应用能力后用3个真实热点作品对账ID、play_count、digg_count、原日期和原链接，保存脱敏响应。未配置时保留现有匿名路径，绝不把应用申请变成普通用户使用前提。个人视频分析API则是授权创作者自己的数据，不能拿来做匿名竞品榜。

### B. 小红书：没有找到可靠匿名播放来源，付费也不能凭想象补齐

MediaCrawler的小红书原始映射保存点赞、收藏、评论、分享和video_url，未提供可复用的播放字段；其小红书入口还有登录流程。只能借鉴字段契约，不适合整体替换默认免登录链路，接代码前另查许可与用途约束。[存储映射](https://github.com/NanmiCoder/MediaCrawler/blob/main/store/xhs/__init__.py)、[入口](https://github.com/NanmiCoder/MediaCrawler/blob/main/media_platform/xhs/core.py)

ReaJason/xhs快速入门要求个人Cookie，不是免会话匿名播放API；官方账号开放范围也不是任意笔记播放统计。[作者文档](https://reajason.github.io/xhs/basic)、[官方账号权限](https://openaccount.xiaohongshu.com/docs/scope)

TikHub当前FAQ明确不提供小红书播放量与下载次数，可取得媒体/点赞等；“下载次数没有”与“视频文件无法下载”是不同问题。其旧App/Web系列已换代，不能照旧博客调用。**这也不是购买即可解决播放量缺口的证据。**[厂商FAQ](https://tikhub.io/zh/faq)、[当前产品边界](https://tikhub.io/xiaohongshu-api)

**下一步**：继续真实公开互动与媒体，播放保留未知；拒绝WatchAction里的互动合计。若以后取得授权品牌/创作者分析，独立标注授权资产与广告/自然口径，不混进匿名全站榜。

### C. Evil0ctal：当前已是v5，不能沿用旧v4调用与demo假设

原作者仓库当前为v5自托管架构，API有任务封装、平台身份/额度、媒体下载等；旧v4 Cookie/demo经验不应直接搬来。它是下载/作品元数据候选，**不是已证明能返回抖音非零播放的服务**。[原项目](https://github.com/Evil0ctal/Douyin_TikTok_Download_API)、[当前API契约](https://github.com/Evil0ctal/Douyin_TikTok_Download_API/blob/main/documents/en/11-api.md)

**下一步**：如评估，只在隔离自建侧车测试普通公开作品，核对服务身份/授权范围、任务done/failed、原ID及原始stats；`play_count:0`仍按来源规则判断占位，不能因它来自另一个服务就当真零。不要依赖公共demo，不复制签名、验证码或私密访问规避代码。侧车运维成本/权限并不因为开源而消失。

### D. 付费抖音候选：只记录，不默认采购/接入

TikHub星图端点文档给出`watch_cnt`（整数或null），说明是包含广告加热的总播放；自然播放另走App统计接口。应区分口径，并先做小样本原始响应/后台对账，不能与平台自然播放静默混排。本轮没有Key、计费调用或成功样本。[厂商端点文档](https://tikhub.apifox.cn/493289600e0)

这条路线需要运营者另行同意预算与授权，不属于“免费匿名已经解决”。费用按采用时的具体接口重新核对，不依赖历史报价。

### E. YouTube：先修JS运行时，再分开验元数据和下载

本机Node20.20.0，现有yt-dlp固定版本2026.8.19的JS执行支持也要求Node22+；不是只有未来新版本才有此门槛。`yt-dlp[default]`包含匹配EJS，不能简单说“缺包”。Deno2.3+是另一受支持选择。[固定版本源码](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/yt_dlp/utils/_jsruntime.py#L120)、[EJS说明](https://github.com/yt-dlp/yt-dlp/wiki/EJS)

本轮已停止在旧Node上强制注入`process.execPath`，新增`YTDLP_JS_RUNTIME`选择独立Node/Deno；留空且Web服务Node低于22时保留yt-dlp默认Deno发现，不假报有可用运行时。仍保留禁止远程组件/插件目录自动加载的限制。

**你/下一位需要做**：在受控机器安装受支持的本机运行时，在私有.env设例如`YTDLP_JS_RUNTIME=deno:C:/Tools/deno.exe`（换成真实路径），再检查版本、EJS、真实格式和实际音视频。这里没有自动下载安装，也未升级整个Web服务。

JS运行时正确仍可能遇到按client/会话/视频的PO Token限制；不要取消安全选项、接来历不明token服务来凑成功。先记录拒绝原因和官方支持边界。[yt-dlp PO指南](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)

统计首选可选运营者Key的Data API `videos.list(part=statistics)`；它提供viewCount/likeCount，不是通用媒体下载接口，也不自动授予下载/再分发权利。[官方视频资源](https://developers.google.com/youtube/v3/docs/videos)、[开发者政策](https://developers.google.com/youtube/terms/developer-policies)

### F. TikTok：展示API、授权统计、浏览器提取三者不同

官方Display视频查询核验作品属于授权用户，需其access token，不是任意作者ID的公共统计入口；oEmbed/Embed Player用于展示。Creative Center趋势不能拿来补单视频播放。[Video Query](https://developers.tiktok.com/docs/en/tiktok-api-v2-video-query)、[嵌入说明](https://developers.tiktok.com/docs/en/embed-videos)

TikTok-Api的video.info读取statsV2/stats，bytes读取实际play/download地址，可作字段对照；但其浏览器技术会话/msToken获取并不保证成功，仍会EmptyResponse，不是无会话保证。[原作者视频实现](https://github.com/davidteather/TikTok-Api/blob/main/TikTokApi/api/video.py)、[会话实现](https://github.com/davidteather/TikTok-Api/blob/main/TikTokApi/tiktok.py)

**本轮代码起头**：TikTok详情在源memo之外补到正常API响应和索引，完成后下一次普通请求可见，不必等重新采源；不自动轮询或整屏刷新。补充播放/点赞时不复活更晚的明确null观测。

### G. X：扩大候选覆盖可以研究，但别把帖子曝光当视频播放

FxEmbed当前v2有搜索/趋势/游标等，比固定公开账号池更值得评估；仍是第三方转述，自建还可能需要运营者凭证改善覆盖。顶层views不是视频独立播放，当前媒体计数核验不可删除。[v2说明](https://docs.fxembed.com/api/introduction/)、[状态字段](https://github.com/FxEmbed/FxEmbed/wiki/Status-Fetch-API)、[自建凭证](https://docs.fxembed.com/deployment/credentials/)

官方路线核验`media.public_metrics.view_count`和variants，需要应用权限；帖子impression不替代视频播放。[官方媒体字典](https://docs.x.com/x-api/fundamentals/data-dictionary#media)

**下一步**：先做v2搜索/游标的只读实验适配，原帖ID/媒体ID/统计证据分开，陌生来源的views不能直写playRaw。

### H. 快手与cobalt：下载侧车候选不等于完整视频索引

快手官方photo/list、photo/info有view_count/play_url/cursor，但需要OAuth用户授权，只覆盖授权用户；不能把应用client token当任意公开视频凭证。[官方视频接口](https://open.kuaishou.com/platformDocs/openAbility/contentManagement/searchForVideos.html)

yt-dlp的快手支持仍有专门的开放请求/维护者限制说明，不能继续凭“通用提取”假定快手下载稳定成功。[支持请求](https://github.com/yt-dlp/yt-dlp/issues/14010)、[维护者说明](https://github.com/yt-dlp/yt-dlp/issues/14024)

cobalt可评估自建下载侧车，不是榜单/统计API；接口有redirect/tunnel/local-processing/picker等不同结果，需正确实现流程。不能未经许可调用公共实例或绕Turnstile；接入前另审其AGPL许可、出站/流量隔离。[原作者API](https://github.com/imputnet/cobalt/blob/main/docs/api.md)、[TikTok原始提取](https://github.com/imputnet/cobalt/blob/main/api/src/processing/services/tiktok.js)

## 三、下一步顺序与验收契约

1. **先做当前链路实测**：每个平台1–3个本人有权处理的原链接，记录身份、计数原文/来源/观测时间、媒体响应、最终解码；不要再只数“有封面的卡片”。
2. **YouTube运行时**：检查独立Node/Deno版本与EJS，真实格式/音轨/字幕下载；明确缺PO/地区/权限，不编造成功。
3. **抖音官方能力**：按意愿申请运营者hotsearch，验证当前端点/scopes及真实字段；免费匿名路径继续并保留未知。
4. **修采集索引按指标合并**：目前整行更新可能把新播放观测回滚。例如旧views@4000、likes@3000，收到views@3500+likes@5000时必须保留前者播放、采用后者点赞。两种时间、明确null、跨重启均需回归；本轮未修。
5. **分离适配器与默认产品**：任何候选先走独立实验入口、默认关闭、受控主机/预算；字段、游标、身份、权限、缓存和失败状态验证后才接默认页面。
6. **最后补覆盖/体验/部署**：真续页、更多公开账号、城市证据下钻、受控长尾采集；并落实反代、磁盘/流量预算，不先宣布生产高可用。

接入统一记录至少包括platform、原作品ID/URL、source及字段、observedAt、metric类型、precision（integer/rounded/lower-bound/unknown）、授权模式和范围。下载地址要核验真实媒体响应/时效，不能当计数证据。候选没有独立播放字段就保持空，不按点赞率推算。

## 四、本轮代码、测试与提交

- TikTok源缓存外应用匿名详情，并传播真实pending/索引；新增生产handle隔离回归。
- TikTok/抖音播放/点赞：时间更新的明确null不被旧详情复活，无独立观测时间时仍可用有效缓存补。
- yt-dlp运行时选择与失败提示、`.env.example`和无子进程网络的argv回归。
- 这些是可继续接的最小实现，不是已接入新的商业/第三方数据源；没有自动引入签名库、登录、付费接口或远程脚本。
- `npm test`完整29个入口退出0，`git diff --check`通过；独立临时目录与loopback回归，不用正常数据库。没有真实平台计数、媒体下载或ASR/LLM成功率的新结论，隔离通过不等于全平台上线验收。

保持当前分支提交，不自动合并、强推或切到hotVideo。下一设备应确认取到了本轮提交，而不是只拉旧hotVideo。研究链接截至2026-10-25读取，主分支/厂商接口会变化，采用时固定版本并重新核验。
