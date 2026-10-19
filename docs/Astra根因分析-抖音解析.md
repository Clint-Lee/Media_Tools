## 1. 根因：你在被动等待这次页面根本没有发出的请求

**不是播放接口失效，而是“等播放器触发请求，再反推直链”的前提不成立。**

### request 拦截器

```js
reqUrl.includes('aweme/v1/play') || reqUrl.includes('video_id=')
```

它只识别**播放入口 URL**，不能识别所有媒体地址：

- 页面拿到 `https://v26-web.douyinvod.com/...` 后，可以直接访问 CDN，完全不经过 `/aweme/v1/play/`，也不一定有 `video_id=`。
- 你的本次页面没有发出媒体请求，自然也没有可供这个条件提取的视频 ID。
- **`aweme_id` 是作品 ID，`video_id` 是视频资源 ID，两者不能互换。** 播放接口能用，只证明“已有正确资源 ID 时能播放”，不意味着页面会调用它。

### response 拦截器

```js
'/aweme/detail/' | '/aweme/post/' | '/aweme/iteminfo/'
```

**你捕获到的只有 `hot/search/list` 和 `social/count`，没有这些接口，因此条件没有命中对象。** `includes('/aweme/detail/')` 本身可以匹配 Web detail 路径，不是这里写错了。

此外还有一个独立缺陷：

```js
if (item) videoSrc = ...
```

**response 分支没有调用 `resolveIntercept()`。** 如果外部正在等待那个 Promise，即使将来成功拿到了地址，调用方仍可能继续等到超时。

**iPhone UA 是应修正的环境配置，不是凭现有证据就能断言的唯一根因。** 它可能让桌面 Chromium 进入移动端分流、分享页或唤端路径；但到底是哪一种，必须看页面和导航记录。Web detail 建议保留真实桌面 Chromium UA，不要把播放接口的 iPhone UA 要求套到整个浏览器上。

**修复方向：主动在已初始化的页面里请求 detail，直接读取返回值，不再依赖播放器和拦截器。**

---

## 2. 页面内 fetch 能过，不代表“浏览器自动免签”

**能确定的是：导出的 Cookie 不是完整的请求执行环境。**

页面内调用：

```js
window.fetch('/aweme/v1/web/aweme/detail/?aweme_id=...')
```

除了携带同源 Cookie，还可能经过页面已经安装的请求包装和安全 SDK，利用当前页面的存储、令牌、设备上下文，补齐参数或请求头；浏览器本身还会提供对应的请求来源信息。

Node axios 不会执行这些页面逻辑。**把 Cookie 搬过去，不等于把真正发到网络上的请求搬过去。**

尤其需要区分：

```text
Cookie: UIFID=...
```

与：

```text
uifid: ...
```

以及 URL 中可能出现的：

```text
?uifid=...
```

**它们是三个不同位置，不会由 axios 自动互相转换。** `Uifid Not Found` 说明网关没有取得它认可的 UIFID 上下文，并不能据此判断“Cookie 里没有 UIFID”。

已有开源客户端也显式区分了 UIFID Cookie、`uifid` 请求头/参数、`verifyFp` 和 Argus 请求头，佐证了“仅复制 Cookie 不等价”；但那是特定实现的观察，不能当成你当前网关的永久协议。[参考实现](https://github.com/NanmiCoder/MediaCrawler/blob/main/media_platform/douyin/client.py)

| 字段 | 角色 | 不能当成什么 |
|---|---|---|
| `a_bogus` | Web 请求防滥用签名参数，与请求及客户端上下文有关，具体算法和校验策略可能变化 | 不是登录 Cookie，也不是可跨请求长期复用的常量 |
| `msToken` | Web 安全 SDK 使用的动态令牌，参与会话/风控上下文 | 不是随便生成一个同长度字符串就有效 |
| `ttwid` | 字节系 Web 访客/设备标识，游客也可能拥有 | 不是接口通行证，也不是请求签名 |
| `UIFID` / `UIFID_TEMP` | 当前风控链使用的客户端身份标识；临时值能否使用取决于当前流程 | Cookie 中存在，不代表网关需要的请求字段已经补齐 |

这些角色属于公开实现与工程观察，不是公开、稳定的官方接口契约。[参数参考](https://juejin.cn/post/7400523716717920306)

**精确到“这一次究竟由哪个字段使请求通过”，仅凭你列出的事实还不能确认。** 应对比成功请求实际发出的 URL 和请求头，重点看 `uifid`、`x-tt-argus`、`a_bogus`、`msToken`、`verifyFp/fp`；不要把“肯定是自动补了 a_bogus”当成已经验证的结论。

---

## 3. 完整 `parseDouyin`

以下实现：

- 接受完整 URL、`v.douyin.com` 短链、中文/emoji 分享文本；
- 优先复用**你已经验证 fetch 能成功的 Puppeteer page**；
- 在页面主执行环境调用当前的 `window.fetch`；
- 不依赖媒体播放，也不依赖 `_ROUTER_DATA`；
- 对初始化期间的失败做有限重试，不承诺绕过验证码、登录要求或内容权限；
- 返回时长统一为**秒**，同时保留毫秒值。

安装：

```bash
npm install puppeteer
```

保存为 `parseDouyin.mjs`：

```js
import puppeteer from 'puppeteer';

const ORIGIN = 'https://www.douyin.com';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function isDouyinHost(host) {
  return host === 'douyin.com' ||
    host.endsWith('.douyin.com') ||
    host === 'iesdouyin.com' ||
    host.endsWith('.iesdouyin.com');
}

// 仅提取 URL 字符，不把紧跟其后的中文、emoji 吃进链接。
function extractInputUrl(input) {
  const candidates = String(input ?? '').match(
    /https?:\/\/[a-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi
  ) ?? [];

  for (const candidate of candidates) {
    const cleaned = candidate.replace(/[.,;!?'")\]]+$/g, '');

    try {
      const url = new URL(cleaned);

      if (
        isDouyinHost(url.hostname) &&
        !url.username &&
        !url.password &&
        (!url.port || url.port === '443' || url.port === '80')
      ) {
        return url.href;
      }
    } catch {}
  }

  throw new Error('输入中未找到有效的抖音作品链接');
}

function awemeIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (!isDouyinHost(url.hostname)) return null;

    const pathId = url.pathname.match(
      /\/(?:share\/)?(?:video|note)\/(\d+)(?:\/|$)/
    )?.[1];

    if (pathId) return pathId;

    for (const key of ['modal_id', 'aweme_id', 'item_id']) {
      const id = url.searchParams.get(key);
      if (id && /^\d+$/.test(id)) return id;
    }
  } catch {}

  return null;
}

// 用独立标签解析短链，不破坏调用者已经初始化好的工作页面。
async function resolveAwemeId(page, inputUrl, timeoutMs) {
  const directId = awemeIdFromUrl(inputUrl);
  if (directId) return directId;

  const resolver = await page.browserContext().newPage();
  let seenId = null;
  let navigationError = null;

  const onRequest = request => {
    if (
      request.isNavigationRequest() &&
      request.frame() === resolver.mainFrame()
    ) {
      seenId ||= awemeIdFromUrl(request.url());
    }
  };

  resolver.on('request', onRequest);

  try {
    try {
      await resolver.goto(inputUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs
      });
    } catch (error) {
      navigationError = error;
    }

    // 兼容先返回分享页、再执行客户端跳转的短链。
    const deadline = Date.now() + 5000;

    while (!seenId && Date.now() < deadline) {
      seenId = awemeIdFromUrl(resolver.url());
      if (!seenId) await sleep(250);
    }

    const id = awemeIdFromUrl(resolver.url()) || seenId;

    if (!id) {
      throw new Error(
        '短链未解析到作品 ID；可能已失效、进入验证页或不是作品链接' +
        (navigationError ? `（${navigationError.name}）` : '')
      );
    }

    return id;
  } finally {
    resolver.off('request', onRequest);
    await resolver.close().catch(() => {});
  }
}

async function fetchDetailInPage(page, awemeId, timeoutMs) {
  return page.evaluate(async ({ awemeId, timeoutMs }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // 保留你实测成功的最小请求。
      // 不手工拼接过期签名，也不绕开页面当前的 fetch 包装。
      const url = new URL(
        '/aweme/v1/web/aweme/detail/',
        window.location.origin
      );
      url.searchParams.set('aweme_id', awemeId);

      const response = await window.fetch(url.href, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal
      });

      const text = await response.text();
      let json = null;

      try {
        json = JSON.parse(text);
      } catch {}

      return {
        httpStatus: response.status,
        json,
        // 仅返回分类诊断，不输出 Cookie、签名或整段响应正文。
        argusBlocked: /ArgusSecurityPlugin/i.test(text),
        uifidMissing: /Uifid Not Found/i.test(text),
        signatureMissing: /Signature Not Found/i.test(text),
        nonJson: json === null
      };
    } catch (error) {
      return {
        httpStatus: 0,
        json: null,
        networkError: String(error?.name || 'FetchError')
      };
    } finally {
      clearTimeout(timer);
    }
  }, { awemeId, timeoutMs });
}

function httpUrls(values) {
  if (!Array.isArray(values)) return [];

  return [...new Set(values.filter(value => {
    if (typeof value !== 'string') return false;

    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }))];
}

function expiresAtFromUrl(value) {
  try {
    const raw = new URL(value).searchParams.get('x-expires');

    // 只解析明确的十进制 Unix 秒，未知格式不猜。
    if (!raw || !/^\d+$/.test(raw)) return null;

    const seconds = Number(raw);
    const date = new Date(seconds * 1000);

    return Number.isSafeInteger(seconds) &&
      Number.isFinite(date.getTime())
      ? date.toISOString()
      : null;
  } catch {
    return null;
  }
}

export async function parseDouyin(input, options = {}) {
  const {
    page: suppliedPage,
    userDataDir,
    headless = false,
    timeoutMs = 30000,
    fetchTimeoutMs = 15000,
    attempts = 3
  } = options;

  const inputUrl = extractInputUrl(input);

  let ownedBrowser = null;
  let page = suppliedPage;

  try {
    if (!page) {
      ownedBrowser = await puppeteer.launch({
        headless,
        ...(userDataDir ? { userDataDir } : {})
      });

      page = await ownedBrowser.newPage();
      await page.setViewport({ width: 1365, height: 900 });

      // 不设置 iPhone UA，保留浏览器真实 UA。
    }

    const awemeId = await resolveAwemeId(page, inputUrl, timeoutMs);

    // 已有可用 douyin 页面时直接复用，避免丢掉已初始化的 SDK 状态。
    if (new URL(page.url()).origin !== ORIGIN) {
      await page.goto(`${ORIGIN}/video/${awemeId}`, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs
      });
    }

    if (new URL(page.url()).origin !== ORIGIN) {
      throw new Error('未进入 www.douyin.com；请先完成正常页面访问');
    }

    // 不用 networkidle：站点可能持续上报、轮询。
    await page.waitForFunction(
      () => document.readyState === 'complete',
      { timeout: timeoutMs }
    );

    let detail = null;
    let lastError = '未取得作品详情';

    const tries = Number.isInteger(attempts)
      ? Math.min(5, Math.max(1, attempts))
      : 3;

    for (let i = 0; i < tries; i++) {
      if (i > 0) await sleep(1000 * 2 ** (i - 1));

      const result = await fetchDetailInPage(
        page, awemeId, fetchTimeoutMs
      );

      const body = result.json;
      const candidate = body?.aweme_detail;

      if (
        result.httpStatus === 200 &&
        (body?.status_code == null || body.status_code === 0) &&
        candidate &&
        String(candidate.aweme_id) === awemeId
      ) {
        detail = candidate;
        break;
      }

      lastError = [
        `HTTP ${result.httpStatus}`,
        body?.status_code != null
          ? `status_code=${body.status_code}`
          : null,
        result.argusBlocked ? 'Argus 拦截' : null,
        result.uifidMissing ? 'Uifid Not Found' : null,
        result.signatureMissing ? 'Signature Not Found' : null,
        result.nonJson ? '非 JSON 响应' : null,
        result.networkError,
        candidate && String(candidate.aweme_id) !== awemeId
          ? '响应作品 ID 不匹配'
          : null
      ].filter(Boolean).join('；');

      // 明确的业务失败不靠重复请求解决。
      if (
        result.httpStatus === 429 ||
        (body?.status_code != null && body.status_code !== 0)
      ) {
        break;
      }
    }

    if (!detail) {
      throw new Error(
        `detail 获取失败：${lastError}。` +
        '请在同一浏览器页面确认作品可访问，完成必要登录或验证后重试。'
      );
    }

    const video = detail.video;

    if (!video) {
      throw new Error('作品详情中没有 video；可能是图文或不可播放内容');
    }

    let videoUrls = httpUrls(video.play_addr?.url_list);

    // 仅在默认播放地址缺失时，尝试清晰度列表。
    if (!videoUrls.length) {
      const bitRates = Array.isArray(video.bit_rate)
        ? [...video.bit_rate].sort(
            (a, b) => Number(b.bit_rate || 0) - Number(a.bit_rate || 0)
          )
        : [];

      for (const item of bitRates) {
        videoUrls = httpUrls(item.play_addr?.url_list);
        if (videoUrls.length) break;
      }
    }

    if (!videoUrls.length) {
      throw new Error('作品详情已返回，但没有可用的 play_addr');
    }

    const cover = [
      video.cover,
      video.origin_cover,
      video.dynamic_cover
    ].flatMap(item => httpUrls(item?.url_list))[0] ?? null;

    const rawDuration = video.duration ?? detail.duration;
    const numericDuration = Number(rawDuration);
    const durationMs = rawDuration != null &&
      Number.isFinite(numericDuration) &&
      numericDuration >= 0
      ? numericDuration
      : null;

    const userAgent = await page.evaluate(() => navigator.userAgent);

    return {
      awemeId,
      sourceUrl: `${ORIGIN}/video/${awemeId}`,
      videoUrl: videoUrls[0],
      videoUrls,
      desc: detail.desc ?? '',
      cover,
      duration: durationMs === null ? null : durationMs / 1000,
      durationMs,
      statistics: detail.statistics ?? {},
      fetchedAt: new Date().toISOString(),
      expiresAt: expiresAtFromUrl(videoUrls[0]),
      // 给 Node 下载器使用，不是在页面 fetch 中强设这些头。
      downloadHeaders: {
        Referer: `${ORIGIN}/`,
        'User-Agent': userAgent
      }
    };
  } finally {
    // 调用者传入的页面/浏览器不关闭。
    if (ownedBrowser) await ownedBrowser.close();
  }
}
```

### 调用方式

**首选你实测能成功的那个 page。** 不要换成一个全新的无状态浏览器后，认为运行结果必然一样。

```js
import { parseDouyin } from './parseDouyin.mjs';

// page 是已有、已初始化的 www.douyin.com 页面。
const result = await parseDouyin(
  '复制打开抖音，看看这个作品 https://v.douyin.com/实际短码/ 🎬',
  { page }
);

console.log(result);
```

独立运行时，可以使用专用持久化浏览器目录；首次访问可能仍需正常完成登录或验证：

```js
const result = await parseDouyin(
  'https://www.douyin.com/video/实际作品ID',
  {
    userDataDir: './douyin-browser-profile',
    headless: false
  }
);
```

**以上代码未在你的真实作品和会话上执行验证；关键成功前提是该页面当前的 `window.fetch` 确实具备你第 5 条实测中的能力。**

### CDN Referer 和 `x-expires`

**返回的是带有效期的播放地址，不是永久裸链；你实测的 Referer 要求必须保留。**

Node 下载时：

```js
const response = await fetch(result.videoUrl, {
  headers: result.downloadHeaders
});

const contentType = response.headers.get('content-type') ?? '';

if (!response.ok || !/^video\//i.test(contentType)) {
  await response.body?.cancel();
  throw new Error(`下载失败：HTTP ${response.status}，${contentType}`);
}

// response.body 是流，交给文件写入或服务端流式转发。
// 不要为了下载大视频先整体 arrayBuffer()。
```

过期处理规则：

1. **存作品 ID，不把 CDN URL 当永久资源 ID。**
2. `expiresAt` 已到期或距到期不足 60 秒，重新调用 `parseDouyin(result.sourceUrl, { page })` 获取新地址。
3. **不要修改 `x-expires`、删签名或重新拼接 CDN 查询参数。** 这些字段可能相互绑定。
4. 没过期却 403，先检查 Referer、请求环境及内容权限；**403 不等于过期**。允许刷新详情再试一次，不要无限重试。
5. 前端 `<video>` 不能任意设置 `Referer`。在你自己的域名上播放时，`referrerpolicy` 也不能把来源伪装成抖音；需要服务端按权限流式转发，并正确传递 `Range`、`206`、`Content-Range` 等响应信息。转发接口应接收作品 ID，而不是允许用户提交任意上游 URL。