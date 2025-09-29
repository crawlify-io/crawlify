# Crawlify API

Crawlify exposes HTTP endpoints for capturing webpages and brokering search requests. Responses share a consistent envelope, support multiple output formats, and provide an optional dynamic rendering fallback for client-side applications.

## Table of Contents
- [Runtime Requirements](#runtime-requirements)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [HTTP Endpoints](#http-endpoints)
  - [/api/v1/crawl](#post-apiv1crawl)
  - [/api/v1/search](#post-apiv1search)
- [Dynamic Site Rendering](#dynamic-site-rendering)
- [Testing](#testing)
- [Project Layout](#project-layout)
- [Adding New Agents](#adding-new-agents)

## Runtime Requirements
- Node.js ≥ 18
- npm
- Repository-provided `bin/html2markdown` converter
- Optional: run `npx playwright install-deps && npx playwright install chromium` to provision the bundled headless browser dependencies

## Installation
```bash
npm install

# Start the development server with file watching
npm run dev

# Start in production mode
npm start
```

Before the first launch, create a `.env` file at the repository root (see the Environment Variables section).

## Environment Variables
| Name | Description | Required | Purpose |
| ---- | ----------- | -------- | ------- |
| `OPENROUTER_API_KEY` | OpenRouter Chat Completions API key | No (only when summary output is requested) | Generates the `summary` format |
| `FIRECRAWL_API_KEY` | Firecrawl v2 API key | Yes (required by the search endpoint) | Accesses the upstream search service |
| `CRAWL_HTTP_PROXY` | Shared HTTP/HTTPS proxy for crawling and rendering fallback, e.g., `http://user:pass@proxy.local:3128` | No | Reuses a single proxy when direct access is unavailable |

Example `.env`:
```env
OPENROUTER_API_KEY=sk-...
FIRECRAWL_API_KEY=fc-...
CRAWL_HTTP_PROXY=http://proxy.local:3128
```

## HTTP Endpoints

### `POST /api/v1/crawl`
- **Request body**
  ```json
  {
    "url": "https://example.com",
    "formats": ["html", "markdown", "summary", "links"]
  }
  ```
  - `url`: required, target page URL.
  - `formats`: optional, de-duplicated array supporting `html`, `markdown`, `summary`, and `links`; defaults to `['html']` when omitted.
- **Sample response**
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
- **Error handling**
  - When the upstream site cannot be fetched, the service returns a normalized error payload whose status mirrors the upstream status code or falls back to 502.
  - Failures affecting individual formats replace that format with `{ "status": "error", "message": "..." }` without aborting the entire request.

### `POST /api/v1/search`
- **Request body**
  ```json
  {
    "query": "open source crawling",
    "limit": 5
  }
  ```
- **Sample response**
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

## Dynamic Site Rendering
- The initial crawl uses a lightweight HTTP client to download raw HTML.
- Pages with sparse readable text or recognizable single-page application containers (for example `id="root"`, `id="__next"`, `data-reactroot`) trigger the headless rendering fallback:
  1. Launch a bundled headless browser and open the page with the `CrawlifyBot/1.0` user agent, waiting for network activity to settle.
  2. Replace the original HTML with the rendered markup and continue generating Markdown, summaries, and links.
  3. On rendering failures, gracefully fall back to the initial HTML response.
- When `CRAWL_HTTP_PROXY` is defined, both the initial request and the rendering fallback reuse the same proxy configuration.
- To avoid runtime errors, provision the bundled browser assets ahead of time:
  ```bash
  npx playwright install
  ```

## Testing
```bash
npm test
```
The tests use Node.js' built-in test runner to cover both successful and failure scenarios for `crawlUrl` and `searchWeb`, stubbing external interactions.

## Project Layout
```
src/
  lib/
    crawlService.js     # Crawl logic and browser-based fallback rendering
    searchService.js    # Search proxy logic
  routes/
    crawl.js            # /api/v1/crawl validation and delegation
    search.js           # /api/v1/search validation and delegation
  utils/
    httpError.js        # Normalized error response helper
    validation.js       # 422 validation utilities
bin/
  html2markdown         # Markdown conversion binary
tests/
  api.test.js           # Crawl/search integration-style tests
```

## Adding New Agents
1. Create a new module in `src/lib` with the agent logic and adopt the shared error response shape.
2. Add the companion route under `src/routes` to validate payloads and forward requests to the agent.
3. Document any new environment variables and dependencies.
4. Write integration-oriented tests in `tests/`, mocking external services to cover both success and failure flows.
