# 2026-10-24 实现：安全收尾 + 正确性隐患 + 死代码清理

基线 `29fd1b6`（hotVideo）。本轮按 2026-10-23 代码审查结论执行"安全短板优先"，全部为小步修改；未做联网验收，未改任何数据语义承诺。接手先读[根交接](../HANDOFF.md)。

## 一、安全修复（6 处）

1. **短链重定向 SSRF**（`lib/downloader-core.js` `resolveRedirect`）：原实现用裸 axios 跟随 5 跳重定向，无任何出站校验——b23.tv / v.douyin.com / xhslink.com 解析路径可被 302 用来探测内网。现挂载 `safeNetwork.safeOptions`（每跳 DNS/重定向都验公网地址）；**catch 兜底里未经校验的 `location` 也不再有资格成为解析结果**，必须先过 `parsePublicUrl`。
2. **媒体代理路由补会话**（`server.js`）：`/api/play` 原先完全无访问检查；`/api/proxy-video`、`/api/proxy-image` 仅 `download=1` 时检查。现在三个路由一律 `mediaAccess`。访客会话自动建立、不消耗处理额度（`guest-access.access()` 语义核实过），浏览器同源请求自动带 Cookie，正常使用不受影响；跨站（`Sec-Fetch-Site: cross-site`）盗链/匿名中继被拒。
3. **`GET /api/settings` 代理地址收敛**：原先任何访客都能拿到服务器出口代理地址（仅去掉了凭证）。现在 `proxy` 字段只对管理员返回；普通用户拿到新增的 `proxyConfigured` 布尔用于侧栏状态点。前端 `loadSettings`/`updateProxyStatus` 已同步改为按布尔显示状态。
4. **Host 白名单防"静默失效"**（`server.js` 启动块）：非本地监听（如 `HOST=0.0.0.0`）且未配置 `HOTPOT_ALLOWED_HOSTS` 时，原来 Host 检查中间件直接变 no-op（DNS rebinding 风险）。现在**拒绝启动**并给出明确提示。已冒烟验证：默认 127.0.0.1 正常启动；`HOST=0.0.0.0` 无白名单时按预期中止。
5. **弹幕 cid 收敛**（`/api/danmaku`）：`cid` 拼进固定主机 URL 路径前必须匹配 `^\d{1,15}$`。
6. **前端注入面收窄**（`public/app.js`）：新增 `safeExternalUrl()`——所有可点击 `href`（详情弹窗原站按钮、播放器占位原站链接、工作台结果原站链接）只接受 `http(s)`，`javascript:` 等协议落为 `#`；热点面板 `spot.color` 只接受 `#RRGGBB[AA]` 十六进制色值才进 style 属性；转写时间轴 `startSec` 与 AI 重点 `startSec` 一律 `Number()` 收敛后再插值（原先是原样字符串进 `data-start`）。

## 二、正确性与资源

7. **B站字幕响应上限**（`lib/media-jobs.js`）：该分支原先无 `maxContentLength`（其余字幕分支有 10MB），异常响应可吃满内存。补齐 10MB 上限。刻意**不加** `safeOptions`：国内直连路径（`biliGet` 等）一贯绕开公网 DNS 校验以兼容 Clash Fake-IP，且该 URL 来自已验连接的 B站 API 响应。
8. **子进程 spawn 失败泄漏**（`media-jobs.run`）：ENOENT 时只触发 `error` 不触发 `close`，15 分钟定时器与 `children` 集合永不回收。`error` 分支现在同时清理两者（`close` 分支保持幂等）。
9. **ASR 进度重建 O(n²) 降频**：`transcribeAudio` 原先每个分段事件都全量 `buildTranscript`，长音频成本随句数平方增长。改为每 10 句刷新一次进度，结束后仍有完整最终构建。
10. **`Math.min/max(...大数组)` 残留清除**：`live-sources.js` 预览路径（`Math.max(...list.map(fetchedAt))`，当前被 2000 上限护住但属同款定时炸弹）与 `server.js` geo `collectedAt` 均改逐项比较。
11. **`collectedAt` 不再冒充观测时刻**（`/api/geo-hotspots`）：原 `v.fetchedAt || Date.now()` 会把缺时间的记录显示成"现在采集"；现在只统计真实 `fetchedAt`，全缺时如实返回 `null`。
12. **抖音开放接口不再空成功**（`lib/douyin-open.js`）：关键词检索第 2 页起原返回空列表当成功，与全站"无可靠续页就明确拒绝"的纪律不一致；现在明确抛错。无关键词的官方热搜分页（有真实续页）不受影响，`douyin-open.test.js` 覆盖不变。
13. **弹幕预发射定时器**（`app.js` DanmakuEngine）：两个预发射 `setTimeout` 纳入 `this.timers`，弹窗关闭时随 `stop()` 一并清理，不再向已隐藏的屏幕追加弹幕。

## 三、死代码与仓库卫生

- 删除 `server.js` 的 `filterByTimeRange`（无人调用）与 `sendVideoList` 传入的幻影选项 `requireKnownDate`（`prepareVideoList` 已不接收；时效过滤本就由阶段一 `maxAge` 完成，行为不变）。
- 删除 `server.js` 的 `parseRelativeTime`（无调用点）与 `cacheVideoApi` 里永假的 `|| payload.stale` 死条件（上游已排除 stale）。
- 删除 `lib/youtube-innertube.js` 的 `continuation ? 'search' : 'search'` 死分支（URL 已内联）。
- 删除 `lib/live-sources.js` 的无用 `merged`（抖音多来源路径 reduce 后无人消费）与保留合并条件里的死第三子句（语义不变，仅消除"`scope?.kind` 检查被 discover 条件短路"的误导）。
- `lib/category-fallback-pool.js`（17,783 行硬编码假计数池）→ `git mv` 至 `archive/`，附 [archive/README.md](../archive/README.md) 说明"禁止重新接入生产"。根目录遗留脚本 `test_bilibili_bvids.js`（require）与 `generate_clean_category_pool.js`（写入路径）已同步更新；server/lib/test/scripts 零引用在移动前后均复核过。
- `package.json` 中挤在一行的 `"test"` / `"test:public-views"` 拆为两行（内容不变）。
- 修正 `lib/collection-index.js` 中描述过时机制的注释：`attachMeta` 实际附加在 `prepareVideoList` 新构造的展示对象上（`video-pipeline.js:209`），**不会**污染持久化的 `row.video`（本轮审查曾怀疑污染，读实现后推翻——如需再查以代码为准）。
- 复用 `youtube-public.js` 已导出的括号匹配 `initialObject` 替换 `fetchYouTubeLive` 的非贪婪正则提取 `ytInitialData`——原正则遇标题含 `};` 会截断整条兜底路径。

## 四、验证

- `npm test`：**28 个入口全部退出 0**（含 douyin-open、downloader-integration、media-identity、collection-index、view-evidence-pipeline 29 项、api-smoke 等本轮改动直接相关的套件）。
- `node --check` 通过全部 8 个改动文件（含 `public/app.js`）。
- `git diff --check` 干净。
- 启动冒烟：`HOTPOT_PREWARM=0 PORT=4599` 正常监听；`HOST=0.0.0.0` 无白名单时按预期拒绝启动。
- 交叉核对：`test/` 中对 `/api/settings`、`/api/play`、`/api/proxy-*` 的既有断言（含未入 npm test 的 live/browser 套件）与新行为兼容——`mediaAccess` 自动建会话、不耗额度，`GET /api/settings` 对未认证仍 200。

## 五、本轮未做（如实说明）

- 未做真实平台联网验收与浏览器 UI 回归（`test:interaction` 等需 Chrome 与本地服务实例，本轮以离线门禁为主）。
- 未动 `MEDIA_PROXY` 全局语义；代理自动探测逻辑保持原样（Astra 判定属隐患但改为显式提示是既定决策，本轮不重开）。
- 审查清单中仍开放的更大项未动：孤儿目录受控盘点（`media-jobs` 启动只扫索引行）、媒体代理全局带宽/字节预算、整任务磁盘预算、真实续页、地球 destroy/WebGL 释放、`npm test` 全局禁网守卫、UI01–UI06。
- 抖音播放量维持止损决策，未重开探查。
