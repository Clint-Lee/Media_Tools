# 2026-10-20 抖音播放量采集专项 · 实测记录与结论

> 本轮目标：让抖音（以及其余平台）的视频排行榜与播放量数据尽可能真实可用。
> 方法：先用 Eazo GPT-6-Astra 做全网方案调研（`.cache/astra-research.md`、
> `.cache/astra-research-segmented.md`），再对每条路线做**真实网络实测**，
> 只把实测通过的写进代码。所有探测脚本与原始响应留在 `.cache/`。

---

## 一、实测结论：抖音 Web 端匿名 `play_count` 是平台级隐藏计数

### 1.1 已排除的路线（全部实测失败）

| 路线 | 实测结果 | 证据 |
|---|---|---|
| `/aweme/v1/web/aweme/detail/` 匿名 | `play_count: 0`，`digg_count: 1000` 正常 | `.cache/douyin-stats-probe.json` |
| 同上 + 注入 `sessionid` | 仍是 `play_count: 0` | `.cache/douyin-login-probe.json` |
| 同上 + 完整登录 Cookie 集（sessionid/ttwid/sid_ucp_v1/sid_tt/uid_tt/passport_csrf_token） | 仍是 `play_count: 0` | `.cache/douyin-login-probe.json` |
| 移动端 UA（iPhone Safari） | 页面根本不发 aweme XHR | `.cache/douyin-mobile-probe.json` |
| `iesdouyin.com/share/video/{id}/` 分享页 | HTML 无 statistics | `.cache/douyin-alt-probe.json` |
| `/aweme/v1/web/aweme/post/`（用户作品） | `403 Blocked by ArgusSecurityPlugin Uifid Not Found` | `.cache/endpoint-probe.json` |
| `/aweme/v1/web/search/item/`、`general/search/single/` | `status_code: 2483 请先登录，再继续搜索吧` | `.cache/douyin-route-probe.json` |
| 移动端 API `aweme.snssdk.com` / `api-hl.amemv.com` | 空响应（缺签名） | `.cache/douyin-alt-probe.json` |
| 第三方公开 API（douyin.wtf / urlebird / tikcdn / 60s 其他端点） | 404 / Cloudflare 403 / TLS 重置 | `.cache/douyin-alt-probe.json`、`.cache/route-probe2.json` |

**关键判断**：`play_count: 0` 与 `digg_count: 1000` 同时出现时，0 不是"零播放"，
而是**平台不向当前访问者返回播放计数**的占位。项目原有的
`public-view-evidence.js` 早已把这个状态标为 `placeholder-zero`，本轮继续沿用，
绝不把 0 写进播放量字段，也不用点赞反推播放量。

### 1.2 实测可用的新来源：官网热点视频榜

浏览器访问 `https://www.douyin.com/hot` 时，页面会请求：

```
GET /aweme/v1/web/channel/hotspot
    ?device_platform=webapp&aid=6383&channel=channel_pc_web
    &tag_id=&count=10&Seo-Flag=0&channel_id=99
    &pc_client_type=1&pc_libra_divert=Windows
    &support_h265=1&support_dash=0
    &version_code=170400&version_name=17.4.0
```

实测返回（`.cache/douyin-hotspot-probe.json`）：

- `status_code: 0`，`aweme_list` 每次 10 条，`has_more: 1`
- 每条含完整 `aweme_id` / `desc` / `author` / `video.cover` / `create_time` / `duration`
- `statistics` 含 `digg_count` / `comment_count` / `share_count` / `collect_count`（真实值）
- `play_count` 仍为 0（同上，平台隐藏计数）

这条接口是**抖音热点视频榜的真实作品实体**，比原来的 `/jingxuan` 公开精选
多一个官方榜单位置的数据，因此本轮把它作为独立来源并入（见
`lib/douyin-hotspot.js`）。

### 1.3 落地方式：三源合并 + 登录态补全钩子

```
抖音 getVideos
 ├─ 开放平台 hotsearch/videos/        （需 DOUYIN_CLIENT_TOKEN，有则优先）
 ├─ 官网热点视频榜 channel/hotspot    （新增，匿名可用）
 └─ 官网公开精选 module/feed           （原有）
      ↓ 合并去重
      ↓ 若本机保存了抖音登录态（npm run platform:login -- douyin）
      │    → lib/douyin-views.js 用该会话逐条请求 aweme/detail/
      │      · 拿到真实 play_count → viewEvidence.status = verified
      │      · 仍是 0 → 保持 placeholder-zero（不冒充）
      ↓ 输出：list + coverage.hiddenViews + metricEnrichment
```

**为什么保留登录态钩子**：本轮实测"注入假 sessionid"无效，但**真实登录态**
（含平台下发的完整 Cookie 与 `odin_tt`/`sessionid_ss` 等）未经实测，
不能断言无效。代码里这条路径是**可选增强**：没配登录态时行为与之前完全一致，
不会因为多了这段代码而改变匿名用户的结果；配了之后只有拿到真实计数才会改写播放量。

### 1.4 播放量仍未解决时的诚实排序

播放量未公开的作品：
- `playRaw = null`，`viewEvidence.status = 'placeholder-zero'`
- **不参与播放量排名**，改用已公开互动计数辅助排序
- 新增 `interactRaw` 字段（赞+评+享+藏），字段名明确表达它不是播放量
- UI 通过 `coverage.hiddenViews` 显示"共 N 件未公开播放量"

---

## 二、同期完成的其余平台增强

| 平台 | 新增能力 | 实测结果 |
|---|---|---|
| TikTok | 详情页 `__UNIVERSAL_DATA_FOR_REHYDRATION__` → `itemStruct.stats.playCount` 补全 | 5/5 拿到真实播放量（127.7M / 50.4M / 46.6M…） |
| YouTube | `innertube` `youtubei/v1/search` + `sp=CAMSAhAB`（按播放量排序） | 20/20 有真实观看计数，免 API Key |
| 快手 | 原有 GraphQL `brilliantTypeData` 已验证可用 | 179/179 有 `viewCount` |
| B站 | 原有 ranking/v2 + wbi 检索 | 100/100 有播放量（用户确认本身正常，未改动） |
| 小红书 | 原有 homefeed + `__INITIAL_STATE__` | 12 条真实笔记；平台不公开视频播放量 |

### 2.1 TikTok 播放量补全（`lib/tiktok-views.js`）

explore/tag 页的 `itemList` 给的是近似计数；视频详情页内嵌结构化数据里
`stats.playCount` 才是平台实际计数。实测路径：

```
https://www.tiktok.com/@i/video/{id}
  → #__UNIVERSAL_DATA_FOR_REHYDRATION__
      .__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct.stats.playCount
  → （旧结构）#SIGI_STATE.ItemModule[{id}].stats.playCount
```

核验规则：`itemStruct.id` 必须与请求的 video id 一致，否则丢弃
（避免用详情页推荐视频顶替）。

### 2.2 YouTube 免 Key 播放量（`lib/youtube-innertube.js`）

```
POST https://www.youtube.com/youtubei/v1/search?prettyPrint=false
{
  "context": {"client": {"clientName": "WEB", "clientVersion": "2.20240101.00.00", "hl": "zh-CN", "gl": "US"}},
  "query": "music",
  "params": "CAMSAhAB"          // protobuf：sortBy=viewCount + type=video
}
→ contents[].videoRenderer[].viewCountText  ("209,277,527 views")
```

- 在浏览器页面上下文里 `fetch`，复用真实会话，不维护签名
- `params` 支持上传时间过滤（`today/3days/7days/1month/6months`）
- 播放量文本 `1.2M` / `3.4万` 按 `source-rounded` 精度记录，不冒充精确值
- 相对发布时间（`4 years ago`）只用于时效筛选，`datePrecision: 'approximate'`
- 失败时自动退回原有 `results` 页 HTML 解析路径（`server.js` 的 `fetchYouTubeLive`）

### 2.3 TikTok Creative Center 话题趋势榜（`lib/tiktok-creative.js`，Astra 调研挖出）

Astra 从 TikTok 当前前端 bundle 里挖出一组**新接口**，实测 200 可用：

```http
POST https://ads.tiktok.com/CreativeOne/KnowledgeAPI/GetHashtagList
Content-Type: application/json
Referer: https://ads.tiktok.com/creative/creativeCenter/trends/hashtag

{"timeRange": 7, "countryCode": "US", "page": 1, "limit": 20}
```

实测返回（`.cache/tiktok-cc-hashtag.json`）：

- `BaseResp.StatusCode = 0`
- `items[]`：`hashtagName` / `rankIndex` / `publishCnt`（平台作品数）/
  `popularityCurve[]`（0-100 归一化热度曲线）/ `topCreators[]`（达人榜）

**同一时间实测**：项目原先使用的
`/CreativeOne/Report/CreativeCenterGetTopContentsList` 已返回 **400**（接口已改版），
因此本轮替换。同族还有 `GetSongList` / `GetCreatorList`（代码已留常量，未启用）。

**口径隔离**：话题热度指数与作品数**都不是视频播放量**，
代码里走独立的 `topicRanking` 字段透出（`server.js` 的 `/api/trends` 响应），
不与视频列表混榜；测试 `test/public-discovery.test.js` 有断言守着这条边界。

---

## 三、反爬与合规边界（本轮遵守的规则）

1. **不破解签名**：抖音 `a_bogus`/`X-Bogus`/`msToken`、小红书 `x-s`/`x-t` 均未实现。
   Astra 报告与实测一致——签名解决请求合法性，**不解决平台不公开播放量**。
2. **不绕验证码**：遇到滑块/登录墙（`status_code: 2483`）直接如实报错，
   不接入打码平台，不用固定素材替代。
3. **不改写计数**：0、缺失、缩写展示值分别记为 `placeholder-zero` /
   `not-provided` / `source-rounded`，绝不互相转换。
4. **登录态是用户自主选择**：`npm run platform:login -- douyin` 由用户本人在
   官网完成登录，脚本只保存 Cookie 到本机 `.runtime/platform-sessions/`，
   不输出、不上传。
5. **频率克制**：热点榜单次请求；TikTok 详情补全每轮最多 8 条；
   YouTube innertube 单次请求；均有 60s 冷却与 5 分钟 TTL。

---

## 四、文件清单

### 新增
| 文件 | 作用 |
|---|---|
| `lib/douyin-hotspot.js` | 抖音官网热点视频榜采集器（channel/hotspot） |
| `lib/douyin-views.js` | 抖音登录态播放量补全（可选增强） |
| `lib/tiktok-views.js` | TikTok 详情页真实播放量补全 |
| `lib/tiktok-creative.js` | TikTok Creative Center 话题趋势榜（KnowledgeAPI） |
| `lib/youtube-innertube.js` | YouTube 免 Key innertube 检索 |
| `lib/platform-hotlists.js` | 公开热榜聚合源（60s API，抖音话题榜兜底） |
| `test/douyin-hotspot.test.js` | 抖音热点榜 + TikTok 补全隔离测试 |
| `test/youtube-innertube.test.js` | YouTube innertube 隔离测试 |

### 修改
| 文件 | 改动 |
|---|---|
| `lib/live-sources.js` | 抖音三源合并 + 登录态补全 + 话题榜聚合兜底 + Chrome 可执行路径探测 |
| `lib/platform-rankings.js` | TikTok 播放量补全接入；capabilities 增加 sources 字段 |
| `server.js` | `fetchYouTubeLive` 支持 innertube 优先 + 失败回退 |
| `scripts/platform-login.js` | Chrome 可执行路径探测 |
| `public/app.js` | 平台 badge 文案更新 |

---

## 五、验收命令

```powershell
npm test                                    # 23 个测试文件全绿
node .cache/test-all-platforms.js           # 全平台真实网络端到端
node .cache/test-douyin-multi.js            # 抖音多来源 + 话题榜
node .cache/test-hotspot.js                 # 抖音热点榜单独验证
node .cache/probe-tiktok-detail.js          # TikTok 详情页播放量验证
node .cache/test-yt-innertube.js            # YouTube innertube 验证
```

---

## 六、仍未解决（如实记录）

1. **抖音匿名播放量**：平台不向未登录 Web 会话返回 `play_count`。除非：
   - 配置抖音开放平台 `hotsearch` 应用权限（`DOUYIN_CLIENT_KEY/SECRET`）
   - 或本机保存真实抖音登录态后 `play_count` 恰好暴露（未实测，代码已留钩子）
   - 或采购第三方数据服务（新抖/蝉妈妈/飞瓜等，需商务资质）

   Astra 调研补充确认（`.cache/astra-research-segmented.md` 第 1 节）：
   - `Evil0ctal/Douyin_TikTok_Download_API` 维护者 2025-03-11 表示
     **Web 播放量接口已下架**，社区转用 TikHub App V3 统计接口
   - 目前唯一低门槛付费候选：
     ```http
     GET https://api.tikhub.io/api/v1/douyin/app/v3/fetch_video_statistics
         ?aweme_ids=7448118827402972455
     Authorization: Bearer <TIKHUB_API_KEY>
     ```
     声明返回 `play_count`/`digg_count`/`download_count`/`share_count`，
     每次最多 2 个 aweme_id；需第三方账号，非免费匿名接口。
     上游采集器与签名算法未开源，返回值**未经本项目后台对账**。
   - `a_bogus`（SM3+RC4+自定义Base64）/ `X-Bogus`（MD5+RC4+自定义Base64）/
     `msToken`（风控 token）/ `ttwid`（访客标识）四者只解决请求校验，
     **不能"解密"服务端返回的 0**。
   - 社区经验点赞率约 1%–3%（`estimated_play_count ≈ L/0.03 ~ L/0.01`），
     但这是 2025 年社区说法、非抽样验证结论。本项目**不采用**该估算，
     只分别报告赞/评/享/藏四项及 `ΔL/小时`。

2. **小红书视频播放量**：平台不公开，只能做互动榜（赞/藏/评）。
3. **X/Twitter 视频播放量**：需 `X_BEARER_TOKEN` + 官方 API 权限。
4. **TikTok Research API**：官方曾免费开放，但仅限美/欧/英/加拿大的学术机构
   与非营利研究，需伦理审查与四周审核，且新视频入库最长 48 小时、
   统计更新最长 10 天，不适合实时热榜（Astra 第 2 节）。
