# HotPot 项目与架构说明

文档定稿：2026-10-23；代码审查日期2026-10-21，续查基线仍为`48b6afb`。本文说明现有结构，不是“全部功能已交付”清单。当前问题以 [根交接](HANDOFF.md) 和 [审查清单](docs/REVIEW_2026-10-21.md) 为准。

## 产品定义

HotPot（万热观象）面向视频创作者，聚合可访问的公开视频样本，比较播放/点赞等原始指标，并通过真实字幕或原声转写辅助学习内容结构。暗色界面包含视频流、话题流、已采集记录、城市关联地球和媒体工作台。

原始愿景中的全平台实时完整榜、任意视频无缝播放/无水印下载、自动画面理解尚未全部实现，不能作为当前承诺。默认不要求终端用户平台登录。

## 技术形态

- Node.js / Express 单进程服务；Axios、Puppeteer处理HTTP与正常浏览器公开访问。
- 原生 HTML/CSS/JavaScript 前端，无Vue/React构建链；`public/app.js`约3,179行，`index.css`约5,270行。
- Globe.gl / Three.js 本地UMD地球，Natural Earth国家面、有限城市词表，可选OSM/Esri瓦片。
- Python媒体工具链：yt-dlp元数据、FFmpeg音画封装/音频转换、faster-whisper原声ASR。
- 本地node-llama-cpp / Qwen语义总结，或运营者配置的远端兼容服务；失败可降级原句摘录。
- 私有JSON账号/索引/任务存储与进程内访客账本，没有数据库事务、分布式任务队列或多实例协调。

`lib/env.js`的Node 20.12下限只是配置加载要求。生产运行时应另选并验收受支持LTS，详见 [部署文档](docs/DEPLOYMENT.md)。

## 主要数据流

```text
公开视频发现 → 原作品身份/指标证据 → 时效/分类/去重/显式指标排序 → 30条分批展示
                              └→ 本机采集索引（最新观测，不是全站历史）
                              └→ 明确地名关联 → 城市聚合 → 地球

公开链接 → 解析与身份核验 → 访客/账号所有权 → 串行媒体任务
          ├→ 实际媒体下载/音画封装/MP3
          └→ 平台字幕，失败再原声ASR → 文本总结与引用 → 可回看时间点
```

### 发现与排序

| 入口 | 负责内容 |
|---|---|
| `lib/live-sources.js` | 来源编排、真实快照、部分失败保留、分区/时效池、城市统计 |
| `lib/platform-rankings.js`、各平台 `*-public/*-views/*-hotspot` | 作品结构适配、可选API、详情补充及来源范围 |
| `lib/metric-evidence.js`、`lib/public-view-evidence.js` | 原计数、近似/下界、零占位、来源证据与拒绝原因 |
| `lib/video-pipeline.js`、`public/ranking.js` | 统一身份、时间筛选、去重、播放/点赞比较 |
| `lib/collection-index.js` | 每平台最多50,000件的本机最新观测、备份与游标分页 |
| `lib/geo-hotspots.js` | 从标题/描述/公开位置识别有限词表中的单个最佳城市关联 |

10月23日已修YouTube新免Key路径的分类/计数/时效及两平台详情接线，新增共享有界详情队列；仍需实际原站验收、真正续页和指标就绪反馈。后续应复用统一管线，不再引入宽松数值解析或空结果补池。

### 媒体、账号与安全

| 入口 | 负责内容及边界 |
|---|---|
| `lib/downloader-core.js`、`lib/media-identity.js` | 原链接、作品ID与实际媒体匹配；小红书多编码与媒体响应核验 |
| `lib/media-jobs.js` | 单并发任务、平台字幕/ASR、封装、MP3、结果所有权和临时索引 |
| `lib/transcript-content.js`、`lib/transcript-analyzer.js`、`lib/local-analysis.js` | 字幕时间轴、原句依据、语义总结和明确降级；不包含视觉/OCR分析 |
| `lib/accounts.js`、`lib/guest-access.js` | 真实账号、HttpOnly会话、配额/预占、访客账本和历史隔离 |
| `lib/safe-network.js`、`lib/platform-session.js` | URL/DNS/重定向保护、可选服务级凭证；非所有子进程出站均覆盖 |

长任务预占、索引内到期目录、空会话和跨日桶已有最小修复；历史无索引orphan和公网资源控制仍待完成。2GB仍只是每下载stream限制，不是整任务或总盘预算。

## 主要接口

| 接口 | 用途 |
|---|---|
| `GET /api/trends`、`/api/search` | 实时来源样本，platform/category/timeRange/query/page/cursor，显式sort=views或likes |
| `GET /api/topics`、`/api/search-topic` | 已接通话题榜及关联作品；不是七平台都有话题接口 |
| `GET /api/collected-videos` | 本机历史采集索引，游标绑定条件/版本 |
| `GET /api/geo-hotspots` | 当前或已采集平台汇总的地名关联，不是来源定位 |
| `POST /api/parse` | 解析公开链接、建立媒体所有权 |
| `POST /api/media/jobs`、`GET /api/media/jobs/:id` | 创建和查询分析/视频/音频任务；文件受所有权约束 |
| `/api/auth/*`、`/api/account/*`、`/api/media/history` | 可选账号、资料/密码/会话与私有历史 |
| `GET /api/platforms`、`/api/system/status` | 配置和近期观测诊断，不是完整健康/readiness证明 |
| `/api/proxy-image`、`/api/proxy-video` | 封面/媒体中转，公网需另补带宽/并发约束 |

服务默认监听本机、带Host检查。改变服务器域名/监听方式时，不可只改一个端口就当公网配置完成。

## 建议演进，不是本轮已实现

1. 先修生产接线、统一计数/时效/分页契约，补覆盖真实调用链的回归。
2. 把采集任务状态与HTTP展示分离；已加载卡片保持稳定，新结果明确通知后应用，不恢复无提示整屏刷新。
3. 按feed、globe、media、account拆原生ES模块与样式域；保留现有UI，不以换框架代替修逻辑。
4. 公网前补共享状态设计、资源预算与出站隔离；当前先只运行一个实例。
5. 地球增加匹配原文、置信度、未定位比例和城市作品下钻；不把坐标可视化当成定位证明。

根目录旧素材池JSON、历史试验脚本和 `lib/category-fallback-pool.js` 不应重新接入生产作为“视频不足兜底”。整理删除这些历史资产需单独确认引用与价值，本次未删除。
