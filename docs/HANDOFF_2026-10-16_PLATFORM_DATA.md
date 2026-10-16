# 2026-10-16 平台真实视频与播放数据接续交接

## 接手先读：任务尚未全部完成

用户的目标是每个平台都能看到真实视频信息和视频播放数据，不能只有空列表。用户随后明确选择：**没有官方API或数据服务，继续查免费公开来源**。保持最终用户免注册、免扫码、免短信；不要再次将购买数据服务、填写个人Cookie或用户登录作为默认解决办法。未知播放量不得拿点赞、话题热度、帖子曝光、其它平台计数或零占位替代。

本轮因用户额度将尽，用户明确要求停止功能开发、完善交接并直接推送。本文件记录停止时的代码、证据与下一步，不代表全平台验收完成。此前采集索引版本提交为 `e350e62`；本轮变更随本交接一起提交。

## 最新真实结果

最后一轮完整冷查询开始于 **2026-10-16 16:50:33（北京时间）**，使用独立空快照目录，避免旧缓存掩盖失败。不是固定数量保证。

| 平台 | 真实视频 | 有播放数据 | 本轮结果 |
| --- | ---: | ---: | --- |
| B站 | 1262 | 1262 | 通过；部分上游请求失败，范围仍为实际发现作品 |
| YouTube | 116 | 116 | 通过；公开搜索样本/近似日期，不是官方全站榜 |
| 抖音 | 19 | 0 | 视频信息可用，公开统计仍返回隐藏播放的零占位；未通过 |
| TikTok | 0 | 0 | HTTP 502；发现页、标签页、Creative Center均未返回作品；未通过 |
| X/Twitter | 69 | 69 | 新增免费官方匿名视频统计后通过，无个人账号或API Key |
| 小红书 | 0 | 0 | HTTP 502；公开发现未返回视频；未通过 |
| 快手 | 20 | 20 | 官网精彩短视频匿名样本通过 |

**全平台严格验收仍失败：抖音、TikTok、小红书。** 较早轮次TikTok确实取得54/70件含播放量作品，小红书曾取得9/24件视频信息但没有播放量；不能用这些旧结果覆盖最后冷查询失败。小红书后期返回的9/24件还可能只是已标注的30分钟真实缓存，不能称实时抓取成功。

X另一次直接采集75件、73件取得统计，余下有失败或缩写转换问题；已修复 `32.3K * 1000` 二进制浮点误差造成误判。最后空缓存69件全部有统计。旧快照可能保留少量没有媒体编号的旧记录，放在未入榜区；不要借此篡改计数。浏览器另已核验X首批30张卡片均有播放数据，示例为官方返回的14.7M、1.4M、989K，页面零JS异常。

## 本轮已写入的代码

1. **`lib/x-video-metrics.js`（核心有效增量）**：按正常匿名访客流程请求X官方 `/1.1/guest/activate.json`，然后读取 `/1.1/videos/tweet/config/<postId>.json` 的 `track.viewCount`。公共Web客户端标识是X网页公开发布的应用标识，不是用户凭证；技术访客Token仅进程内缓存，不入库/前端/日志。统计以 `track.contentId` 对照实际媒体编号，并核对返回的原帖URL；不得误取推荐作品或帖子曝光。
2. **`lib/x-public.js`**：仍通过FxEmbed公开API发现账号视频，再用上述X官方接口补播放统计，保留二者不同来源。不是全站搜索/热榜。官方返回 `87.8K` 等缩写时，保存原文、`viewPrecision=source-rounded` 与 `viewsFetchedAt`，前端显示“约”和精度说明，不冒充精确整数。统计请求有短缓存、并发/时间预算；失败保留作品与未知计数。
3. **`lib/data-quality.js`、`server.js`、`public/app.js`**：接口与系统状态区分视频信息和播放数据，返回/显示 `videos`、`withViews`、`withoutViews`、`roundedViews`。有视频但无播放量不会再被界面笼统称为完全可用。保留未知计数的真实卡片。
4. **`lib/douyin-open.js`**：按官方文档补了可选 `hotsearch` 应用接口、Token复用/到期更新、热点词关联视频实体和 `statistics.play_count` 映射。配置失败可保留原匿名精选结果并明确说明。**只有隔离测试通过，没有有效应用凭证，没有联网验收，不能把它算作已解决抖音免费公开播放量。** 用户选了免费公开来源，此路径仅保留为将来的可选能力，不是当前操作前提。环境变量见 `.env.example`。
5. **`lib/platform-rankings.js`**：X有官方Token时默认“全部时间”可读取并明确标注近7天可用样本；更长时间仍需要历史权限。修复原先默认筛选即因无历史权限报空的问题。此授权路径本轮未联网验收。
6. **`lib/live-sources.js`**：同一平台匿名技术会话保留于内存，每次任务仍独立页面；与可选个人凭证上下文隔离。遇验证失败不会重置身份来绕验证。**TikTok例外**：保持发现/标签/广告页原有独立上下文，避免并行来源互相干扰技术Cookie。排查时曾试过TikTok共享上下文，已撤回；恢复独立上下文后的单独空缓存复查仍失败，根因尚未确认。
7. **分区竞态**：抖音/TikTok改为按实际HTTPRequest对象记录epoch，避免同URL的新请求覆盖旧请求的分区归属。隔离用例已加入“相同URL、旧响应晚到”场景。
8. **采集索引**：新增保存统计来源、统计采集时间和平台原始缩写精度；不保存技术Token。

## 下一位按此顺序继续

### 1. 先查TikTok新出现的冷查询失败

- 先读 `lib/platform-rankings.js:tiktokPublicVideos`、`lib/public-discovery.js` 和 `lib/live-sources.js:withPage`。上一轮成功不意味着现在可用。
- 使用 `scripts/probe-public-sources.js tiktok` 抓普通公开页实际状态；建议先只检查explore，再检查tag与Creative Center，避免同时扫许多页面加重限制。现有脚本仅支持平台筛选，尚未加“单个kind”筛选。
- 比较页面最终URL/标题、相关接口HTTP状态/响应码、`itemList`/实体结构、request/response对象对应与代理可达性。先判断是验证/地区/网络、上游结构变化还是监听/筛选漏数，不预设“换Cookie就好”。
- 对照独立上下文版本；不要为了凑数回退热搜、静态池或其它平台，也不要把全缓存成功当冷查询通过。

### 2. 抖音：只接真正公开视频播放统计

- 已检查官网精选 `module/feed`、正常移动分享页、网页详情与旧 `iesdouyin` iteminfo路径。详情真实作品的 `statistics.play_count`仍为0占位；旧iteminfo没有返回有效作品。移动分享页本次提示在抖音内观看。
- 精选payload曾发现非零 `hot_list.view_count`，但它属于话题对象，**不能拿来填某件作品播放量**。
- 若发现新的免费公开来源，先核对作品ID和字段口径，区分累计/周期/话题统计/作者自述。只把可证实的作品计数写入 `playRaw`。不能从标题数字或作者公布的其它视频数据猜。
- 可选官方热点视频文档见下方；有权限这一条件目前不满足，不得以代码存在替代联网证据。

### 3. 小红书：先恢复可靠匿名视频信息，再查播放字段

- 已试官网主页/explore、允许关闭的登录提示、已有笔记的explore/discovery分享页。发现接口后期出现 `code=-101`；详情未返回与输入编号一致的笔记。未处理验证码，也未使用个人账号。
- 公开列表取得过真实视频、标题/封面/点赞，但没有可核验的视频播放量。创作者后台数据、话题浏览量、笔记阅读量不自动等于视频播放。
- 优先检查普通匿名会话连续性与正常公开页面实际实体；不能把登录工具或需扫码的CLI当免登录解法。免费分享页有可用计数时，需留原始字段证据后再扩展映射。

### 4. 最后复验全平台与用户实际页面

启动服务后运行 `npm run test:platform-data`。该命令不是旧 `test:system` 的“只记录现状”，任一平台空列表、任何返回作品缺播放量/基本元数据、或没有本轮新采集作品，都会退出1。部分来源失效但本轮确有新作品、保留记录有原始指标时可通过，报告仍写出缓存和partial。

按报告区分“平台至少能看到一些播放量”和“本轮返回作品全部带播放量”；不能修改判据掩盖未知作品。再实际点击7个平台，检查30条批次、封面、来源/时间、缩写精度、错误提示与零JS异常。旧数据要明确缓存/历史，不能补新采集时间。

## 验证状态与命令

- 最近完整 `npm test` 与 `npm run test:collection-ui` 已通过，含官方抖音隔离适配、X匿名统计、会话隔离、API/账号/访客与既有媒体回归。
- X缩写浮点修复及TikTok恢复独立上下文后，提交前最后完整 `npm test` 再次通过；不代表全平台联网验收通过。
- 全平台真实数据命令最后退出1，**这是尚未完成目标的真实证据，不能在报告中写成所有测试通过**。
- 本轮没有重装媒体模型，也没有重新验收各平台媒体转写/实际下载。不要把榜单统计验收扩写成全平台视频可播放/下载/分析保证。

```powershell
npm install --ignore-scripts --no-package-lock
$env:PUPPETEER_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm test
npm start
# 另一个终端；服务地址可按实际端口更改
$env:TEST_BASE_URL='http://127.0.0.1:4000'
npm run test:platform-data
npm run test:collection-ui
```

`--ignore-scripts`不下载Puppeteer浏览器，需已有Chrome或单独准备浏览器。当前检测到本机代理 `http://127.0.0.1:7897`。仅访问本地HTTP的沙箱可能报EACCES，临时目录重命名也可能受限；要区分环境权限与代码失败，不要因此删库。

本轮自有测试服务4016/4017/4018/4019均已停止。最后4019使用 `HOTPOT_PREWARM=0`、`HOTPOT_SOURCE_CACHE=.cache/verification/platform-final-snapshots`；新接手可按需重启。正常4000服务未由本轮接管，不要终止其它Node/浏览器。

## 私有证据与外部参考

以下均在 `.cache/`，忽略于Git；新拉取仓库不包含它们。不要分发整个运行目录，也不要提交匿名Token、平台Cookie、账号、音视频。

- `.cache/verification/platform-data.json`：最后完整冷查询结果（总体失败）。
- `.cache/verification/x-anonymous-views.json`：X单独匿名统计样本。
- `.cache/verification/x-free-public-views.png`：真实浏览器首批30件播放量。
- `.cache/public-probes/`：正常公开页探查、抖音移动分享结果等；部分payload含短期平台技术参数，应保持私有。
- `.cache/verification/platform-final-snapshots/`、`tiktok-recheck/`：隔离冷查询快照。不要将这里的失败当成已完成来源接入。

参考：[X官方指标口径](https://docs.x.com/x-api/fundamentals/metrics)；[匿名视频配置接口的开源原作者实现说明](https://github.com/arraypress/swift-x-metadata)；[FxEmbed公开API说明](https://docs.fxembed.com/api/introduction/)；[抖音官方热点关联视频接口](https://open.douyin.com/platform/resource/docs/openapi/data-open-service/hot-video-data/get-hot-words-polymerization-video/)；[抖音应用Token文档](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/account-permission/client-token)。外部文档不是当前账号已有权限或接口永久可用的证明。
