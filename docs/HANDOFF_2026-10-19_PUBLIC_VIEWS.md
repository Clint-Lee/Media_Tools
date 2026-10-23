> 历史记录：本文件仅保留当时的过程与证据，不代表当前已验收状态。当前接续请读[根交接](../HANDOFF.md)、[2026-10-21审查](REVIEW_2026-10-21.md)和[部署说明](DEPLOYMENT.md)；不要沿用旧PID、路径、计数或登录建议。

# 2026-10-19 接续：抖音/小红书免费公开播放量排查

## 当前结论与接续基线

从干净的 `4f19b2b` / `origin/hotVideo` 接续。本轮用户要求优先找两平台的真实播放量、免费公开来源、不用点赞替代，结束后更新文档并推送。**仍未找到本轮可核验、可接入的匿名作品播放量来源，不能写成需求已全部实现。** 已完成的是新来源审计、错误计数防护、拒绝证据可追踪和抖音采集等待修复。

不购买服务，不要求个人登录，不处理验证码，不伪造指纹或重置身份绕验证。抖音可选hotsearch模块仍只有此前隔离测试，不是本轮免费播放量解决方案。

## 新发现：小红书WatchAction不能直接当播放量

原站PC笔记和移动分享页含JSON-LD `VideoObject.interactionStatistic`，动作标为 `https://schema.org/WatchAction`。起初抽查发现非空数值，随后核对同一笔记的真实互动字段，发现以下关系：

| 实际笔记ID | JSON-LD计数 | 点赞 | 收藏 | 评论 | 对照 |
| --- | ---: | ---: | ---: | ---: | --- |
| `6a87a554000000003501590f` | 1,345 | 1,047 | 240 | 58 | 1,047＋240＋58＝1,345 |
| `6a7903c200000000050206e1` | 8,491 | 6,773 | 1,418 | 300 | 6,773＋1,418＋300＝8,491 |

这两个值在PC/移动入口一致，但**一致和WatchAction标签均不足以证明它是播放量**。它们与互动合计精确相同，没有独立作品播放证据，因此拒绝接入播放榜。另有点赞显示“2.1万”等缩写的笔记，JSON-LD计数为null；不能将null转换为零、对缩写做运算补数，或将其它非空schema值自动升级为可信播放。

原笔记ID由页面SSR `note.noteDetailMap`核验，标题可能为空、使用正文；schema标题会去掉话题标记并追加“小红书”后缀。新校验只在同笔记身份与标题/正文对应时记录拒绝证据，忽略其它推荐作品。没有把这些候选数接入后再假报完成。

时间：初查约北京时间10:32，进一步身份/互动核对约10:34—10:35。私有证据 `.cache/verification/red-schema-identity.json` 及当时诊断输出。该文件只用于注明时刻的原始观测，不是当前实时数据。

Schema.org的[WatchAction](https://schema.org/WatchAction)与[userInteractionCount](https://schema.org/userInteractionCount)解释了标签语义；Google[视频结构化数据文档](https://developers.google.com/search/docs/appearance/structured-data/video)也有相应示例。这些标准说明不是小红书具体实现的正确性证明，实际数据仍须核验。

## 抖音新检查与采集修复

普通匿名精选、同作品 `/video/<id>` 和带 `modal_id` 的公开入口均已检查，没有注入个人Cookie或手工签名请求。真实作品 `7697507167225580836` 在精选返回158,138点赞、详情稍后158,229点赞，两处 `statistics.play_count` 都为0占位；详情接口确实返回了同ID作品，不是仅因页面未就绪而漏读。没有把热搜话题view_count或点赞变成作品播放。

抖音[官方video.data文档](https://open.douyin.com/platform/resource/docs/openapi/video-management/douyin/search-video/video-data)要求用户授权和权限，且只能查询token对应用户上传的作品，不符合本次无凭证全网匿名目标。开源下载器/服务的play_count字段或示例存在，也不是免费真实播放已取得的证据；本轮未安装新的身份池或服务。

`collectDouyinPage` 增加25秒软预算，响应体收尾最多等待1.5秒，给既有30秒页面硬截止留出余量。旧逻辑无限等待全部 `response.json()`，一个卡住的响应能拖掉已收到的真实作品；现在保留成功作品，未完成响应/软截止标 `partial`，明确分页结束时停止空滚。仍受导航/页面调用本身及上游限制，不承诺永不超时。保留请求发起代次隔离，不让旧分区响应进入新分类。默认终态单次渲染和无自动轮询保持原行为。

## 代码变化

- `lib/public-view-evidence.js`：抖音只采用同ID统计中的正安全整数播放；零占位、缺字段、非法数值、错误身份都保持未知。小红书识别并拒绝与互动合计相同的WatchAction；其它无独立证据的schema数也不采用。该模块不生成估算播放量。
- `lib/red-public.js` / `lib/public-discovery.js`：正常详情缓存带入独立 `viewEvidence`，记录来源/观测时间/拒绝状态；不重新请求以制造新观测。保持 `playRaw=null`。已有更新的指标观测不被较旧详情覆盖。
- `lib/data-quality.js`：新增 `rejectedViewEvidence`，分别统计零占位、互动合计和未核实schema；这些状态不提高真实播放覆盖率。
- `public/app.js`：未知播放卡片的提示明确解释零占位/互动合计等拒绝理由，不显示虚假播放名次。点赞仍是独立、显式选择的指标。
- `lib/collection-index.js`：保留公开的拒绝证据，重启后仍是未知播放，不将诊断计数恢复成 `playRaw`。
- `scripts/probe-public-video-views.js`：可重复的正常公开页面诊断，审计精选/首页、同作品详情及分享入口；用 `verifiedViews` / `goalMet` 明确目标结果。退出0仅代表诊断完成，**不代表取得播放量**。每次保存带时间的报告及latest副本，避免后续失败覆盖唯一证据。已知真实ID模式直接检查作品，不反复访问已受限首页。

诊断报告不保存HTML、Cookie、签名请求头或媒体直链。为了正常访问公开分享，最新发现URL另存 `.cache/public-probes/<platform>-view-targets.json`，其中可能含匿名xsec参数；该文件和全部cache都不提交Git，也不得复制到公开文档。

## 最终冷采集与验收

开始 `2026-10-19T02:40:45.400Z`（北京时间10:40:45）。4002实例使用新的来源快照目录、独立索引/YouTube缓存、`HOTPOT_PREWARM=0`，未删除日常缓存。

| 平台 | 视频 | 有播放 | 严格结果 |
| --- | ---: | ---: | --- |
| B站 | 1348 | 1348 | 通过 |
| YouTube | 119 | 118 | 未通过，1件未知，不用旧计数补齐 |
| TikTok | 35 | 35 | 通过，部分来源失败 |
| X | 47 | 47 | 通过 |
| 快手 | 20 | 20 | 通过 |
| 抖音 | 58 | 0 | 未通过，真实视频可见，播放仍为零占位 |
| 小红书 | 0 | 0 | 未通过，本次发现未返回视频 |

本轮小红书后段正常首页进入登录页；已知原笔记无签名分享复查也未返回笔记数据，不把HTTP200当成功，没有继续通过重置会话或验证码操作撞墙。早段曾正常取得笔记和上述结构化误标证据，不能把早段结果写成本轮末次仍稳定可用。

- `npm test`：22组通过，包含新公开计数证据、抖音卡死响应/软截止、历史恢复测试；正计数用例为隔离结构，不是本轮抖音真实播放取得证明。
- `npm run test:metric-ui`：通过，页面明确拒绝互动合计/零占位，播放榜未知不排名，显式点赞切换正常。
- `npm run test:platform-data`：退出1，失败平台YouTube/抖音/小红书；门槛未降低。报告 `.cache/verification/platform-data.json`。
- 新诊断报告 `.cache/verification/<platform>-public-views-audit-*.json`，`goalMet=false`。只有正常页面探查，没有重新实测所有平台媒体文件、解码或ASR，也未重跑地图综合回归。

本轮4002实例配置：来源 `.cache/verification/oct19-views-source`、索引 `oct19-views-collection`、YouTube缓存 `oct19-views-youtube`。测试服务在本轮收尾停止；正常使用在工程根目录 `npm start`。旧PID/旧端口是否运行以实际监听为准，不结束不属于本轮的进程。

## 下一步按证据继续

1. 抖音优先寻找新的正常公开、绑定原作品的独立统计来源；已查的精选/详情零占位、旧iteminfo空数据、移动分享“在App打开”没有变化时，不重复无效扫描。若新来源真有播放，保存原字段、同ID/媒体身份、来源、精度、时间，并与独立原站观测交叉核验后才接入。
2. 小红书优先正常公开分享/SSR与公开页中独立的作品播放字段；**不要再将WatchAction单独视为突破**，不要将read_count/曝光或互动合计当视频播放。来源受限时如实显示，保留已有原时间快照，不要求个人登录或购买服务。
3. 本次YouTube有1件未知，下一轮可按同ID检查独立watch观测及隐藏状态；不能为了全平台通过而删除未知作品、填历史最大值或临时降低门槛。新时间采样需另标日期，不能覆盖本轮失败结果。
4. 尚缺真正可核验数据源，当前无法靠代码保证两平台全部有播放。后续若仍无公开来源，应保持目标未完成和具体证据，继续推进有证据的改进，不扩写成“所有平台已接通”。

复验命令（浏览器需本机Chrome；known-id只能使用真实观测到的作品ID）：

```powershell
$env:PUPPETEER_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm test
node scripts/probe-public-video-views.js douyin 3
node scripts/probe-public-video-views.js xiaohongshu 3
node scripts/probe-public-video-views.js douyin 1 7697507167225580836
# 页面/全平台检查需先启动相应端口服务
$env:TEST_BASE_URL='http://127.0.0.1:4002'
npm run test:metric-ui
npm run test:platform-data
```

本轮最终提交/推送状态见交付消息与 `git log -1` / `git status -sb`。不要把本篇的“诊断完成”理解成“两平台真实播放目标完成”。
