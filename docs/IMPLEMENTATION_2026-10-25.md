# 2026-10-25 实现：测试禁网守卫（T01）+ 孤儿目录受控盘点（M02 收尾）

基线 `8ba07b5`（hotVideo，含 10-24 安全收尾批次）。本轮完成 10-21 审查清单中两项明确的测试/存储缺口。接手先读[根交接](../HANDOFF.md)。

## 一、T01 · 全局禁网守卫

**问题**：`npm test` 的"通过"不等于严格离线——任何套件里未 mock 的外访被 `catch` 吞掉后测试照样绿。此前只有两个来源用例做了显式 mock，没有全局防线。

**实现**（`test/net-guard.js`）：

- 通过 `node -r ./test/net-guard` 预加载，已挂载到 `npm test` 全部 28 个入口（`package.json`）。
- 拦截点：`dns.lookup` / `dns.promises.lookup` / `dns.resolve*` 家族 / `net.createConnection`（直连 IP 绕过 DNS，必须单独拦）。axios、http/https、undici fetch 最终都经过这些入口。
- 放行范围：回环（`127.0.0.1` / `::1` / `localhost` / `*.localhost`）与保留测试顶级域（`*.test`）。其余一律拒绝。
- 需要真实网络的验收套件（`test:live`、`test:platform-data`、`test:rankings`、`test:discovery`、`test:collection-live`、UI 套件等独立 script）**不挂**守卫。
- 调试逃生口 `HOTPOT_ALLOW_TEST_NET=1`，仅限调试，文档明示不得用于凑通过。

**反向验证**（证明门禁真的有效，与 10-23 证据门禁同款纪律）：

```
dns.lookup('example.com')     -> BLOCKED ✓
net.connect 8.8.8.8:53        -> BLOCKED ✓
fetch('http://example.com/')  -> BLOCKED ✓
dns.lookup('127.0.0.1')       -> allowed ✓（回环不受影响）
```

挂载守卫后 `npm test` 28 个入口全绿——说明现存套件本就没有隐藏外访（此前的显式 mock 是完整的），守卫把这一承诺变成**会被强制执行的约束**：今后任何套件引入未声明外访会直接失败，而不是静默通过。

## 二、M02 · 索引外孤儿任务目录受控盘点

**问题**：媒体任务目录由 `mkdtempSync` 创建、索引由 `persistJobs` 落盘，两步之间崩溃会留下不在任何索引行里的 `job-*` 目录。原启动恢复只遍历索引行，这样的目录永久遗留（10-23 只做了"索引内过期目录"的回收）。

**实现**（`lib/media-jobs.js`）：

- 启动时 `readdirSync(cacheRoot, {withFileTypes:true})` 扫描一遍孤儿目录；`cleanupJobs` 定时器继续重试此前删除失败的记录。
- **边界约束与 `removeJobDirectory` 完全一致（直接复用它）**：只接受 cacheRoot 直系、名字匹配 `job-*` 的真实目录；索引引用的、符号链接/junction 的、名字不符的、cacheRoot 之外的一律不动。
- **额外保守阈值**：mtime 在 30 分钟内的目录不碰——防御多实例误删与"崩溃后快速重启"竞态（该孤儿会留到下次 30 分钟后的启动回收）。
- 失败保留记录并持续重试；成功回收打日志注明"不在任务索引中，无法恢复为可查询任务"。
- 单实例仍是前提（多实例共享 cacheRoot 时此扫描不安全，与既有文档一致）。

**测试**（`test/media-cleanup.test.js` 新增 3 个夹具断言）：旧 mtime 孤儿启动即回收；新 mtime 孤儿被阈值保护；非 `job-*` 命名的旧目录永不扫描。原有全部边界断言（junction、外部目录、删除重试、重启重试）保持通过。

## 三、验证

- `npm test`：**28 个入口全部退出 0**（挂载禁网守卫 + 新增孤儿测试后）。
- `node --check` 通过改动文件；守卫反向注入 4 项场景实测符合预期。
- `test/media-cleanup.test.js` 在挂守卫下运行通过（该套件此前就在离线路径）。

## 四、本轮未做（如实说明）

- 未做真实平台联网验收、浏览器 UI 回归（`test:interaction` 等 opt-in 套件未跑）。
- 仍开放的更大项：媒体代理全局带宽/字节预算、整任务磁盘预算、真实续页、地球 destroy/WebGL 释放、`accounts.json` 日桶清理、UI01–UI06、公网部署前置。
- 守卫只覆盖 `npm test` 链；单文件调试运行（`node test/xxx.test.js`）不会自动挂载。
