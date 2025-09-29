# Crawlify API

Crawlify 提供一组基于 Express 的 HTTP 接口，用于抓取网页和代理搜索请求。每个代理模块位于 `src/lib`，通过 `src/routes` 暴露成 REST API，并统一使用 `HttpError` 格式化错误响应。

## 目录
- [运行环境](#运行环境)
- [安装与启动](#安装与启动)
- [环境变量](#环境变量)
- [HTTP 接口](#http-接口)
  - [/api/v1/crawl](#post-apiv1crawl)
  - [/api/v1/search](#post-apiv1search)
- [动态站点渲染策略](#动态站点渲染策略)
- [测试](#测试)
- [目录结构](#目录结构)
- [新增代理的步骤](#新增代理的步骤)

## 运行环境
- Node.js ≥ 18
- npm
- 可执行的 `bin/html2markdown`（仓库已提供）
- 可选：Playwright 浏览器依赖（运行时需要执行 `npx playwright install-deps && npx playwright install chromium` 安装浏览器）

## 安装与启动
```bash
npm install

# 启动开发环境（监听文件变更）
npm run dev

# 生产模式启动
npm start
```

首个启动前请在根目录创建 `.env` 文件（参见下文的环境变量章节）。

## 环境变量
| 变量名 | 说明 | 必填 | 用途 |
| ------ | ---- | ---- | ---- |
| `OPENROUTER_API_KEY` | OpenRouter Chat Completions API 密钥 | 否（只在需要摘要时必填） | 为 `summary` 格式生成摘要 |
| `FIRECRAWL_API_KEY` | Firecrawl v2 API 密钥 | 是（使用 search 接口时） | 访问 Firecrawl 搜索服务 |

`.env` 示例：
```env
OPENROUTER_API_KEY=sk-...
FIRECRAWL_API_KEY=fc-...
```

## HTTP 接口

### `POST /api/v1/crawl`
- **请求体**
  ```json
  {
    "url": "https://example.com",
    "formats": ["html", "markdown", "summary", "links"]
  }
  ```
  - `url`：必填，目标页面 URL。
  - `formats`：可选，去重后仅接受 `html`、`markdown`、`summary`、`links`，默认 `['html']`。
- **响应示例**
  ```json
  {
    "id": "crawl_...",
    "status": "completed",
    "url": "https://example.com",
    "fetched_at": "2024-06-01T12:00:00.000Z",
    "formats": {
      "html": {
        "content": "<html>...",
        "content_type": "text/html; charset=utf-8"
      },
      "markdown": {
        "content": "# Title ...",
        "content_type": "text/markdown; charset=utf-8"
      },
      "summary": {
        "content": "Short summary...",
        "content_type": "text/plain; charset=utf-8"
      },
      "links": {
        "count": 5,
        "items": [
          { "url": "https://example.com/about", "text": "About" }
        ]
      }
    }
  }
  ```
- **错误处理**
  - 无法抓取源站：抛出 `HttpError`，状态码为上游响应码或 502。
  - 各格式转换失败：不会终止请求，而是将该格式替换为 `{ status: 'error', message: '...' }`。

### `POST /api/v1/search`
- **请求体**
  ```json
  {
    "query": "open source crawling",
    "limit": 5
  }
  ```
- **响应示例**
  ```json
  {
    "query": "open source crawling",
    "limit": 5,
    "count": 3,
    "results": [
      {
        "title": "Example Page",
        "description": "A summary",
        "url": "https://example.com",
        "metadata": {
          "source_url": "https://source.example.com",
          "status_code": 200,
          "error": null
        }
      }
    ],
    "warning": null
  }
  ```

## 动态站点渲染策略
- 初次抓取使用 `axios` 获取 HTML。
- 对于文本极少或包含典型 SPA 容器（例如 `id="root"`、`id="__next"`、`data-reactroot` 等）的页面，会触发 Playwright 渲染：
  1. 启动 headless Chromium；
  2. 以 `CrawlifyBot/1.0` User-Agent 打开页面，优先等待 `networkidle`；
  3. 回收渲染后的完整 HTML 替换原内容，再继续生成 Markdown、摘要、链接等格式；
  4. Playwright 出错时自动降级使用原始 HTML。
- 为避免运行时报错，请提前执行：
  ```bash
  npx playwright install
  ```

## 测试
```bash
npm test
```
测试使用 Node.js 原生测试运行器对 `crawlUrl` 与 `searchWeb` 的成功和失败场景进行断言，axios 与外部 API 均通过 stub 模拟。

## 目录结构
```
src/
  lib/
    crawlService.js     # 抓取逻辑与 Playwright 回退
    searchService.js    # Firecrawl 搜索代理
  routes/
    crawl.js            # /api/v1/crawl 路由校验与转发
    search.js           # /api/v1/search 路由校验与转发
  utils/
    httpError.js        # 标准化错误响应
    validation.js       # 422 验证工具
bin/
  html2markdown         # Markdown 转换二进制
tests/
  api.test.js           # crawl/search 集成式单测
```

## 新增代理的步骤
1. 在 `src/lib` 新建代理模块，实现业务逻辑并透出 `HttpError`。
2. 在 `src/routes` 中添加对应路由，负责请求体验证与参数整理。
3. 在 README/文档中记录所需环境变量与依赖。
4. 在 `tests/` 编写集成取向的单测，Mock 外部服务以覆盖成功与错误场景。
