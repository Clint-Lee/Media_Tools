# archive · 历史资产归档

本目录存放**已从生产路径断开**的历史试验资产。其中的静态素材池（如 `category-fallback-pool.js`，原位于 `lib/`）包含硬编码的旧计数与旧日期，**禁止重新接入生产代码作为"视频不足兜底"或任何数据来源**——所有榜单与卡片必须来自平台实际返回（见根目录 `README.md` 与 `PROJECT_DOCUMENTATION.md` 的数据诚实性约束）。

- `category-fallback-pool.js`：2026-10-24 自 `lib/` 移入。当时已确认 `server.js`、`lib/`、`test/`、`scripts/` 零引用；根目录遗留脚本 `test_bilibili_bvids.js`（读取）与 `generate_clean_category_pool.js`（生成）的路径已同步更新。彻底删除前仍需按交接文档单独确认价值。

新的生产代码不得 import 本目录任何文件。 lint/评审时把本目录视为只读历史。
