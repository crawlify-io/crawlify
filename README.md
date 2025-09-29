# Crawlify

Crawlify is a service designed for AI Agents to fetch and search web content, providing HTTP endpoints for efficient access and retrieval of webpage information.

## Runtime Requirements
- Node.js ≥ 18
- npm

## Installation
```bash
npm install
npx playwright install-deps
npx playwright install

# Start the development server with file watching
npm run dev

# Start in production mode
npm start
```

Before the first launch, create a `.env` file at the repository root (see the Environment Variables section).

## Container Deployment
```bash
# Build the runtime image
docker compose build

# Start the service in the background
docker compose up -d

# Follow logs when needed
docker compose logs -f crawlify
```

The compose stack reads environment variables from `.env` and exposes the API on `http://localhost:3000` by default. Set `PORT` in `.env` (for example `PORT=4000`) to update both the container listener and the published host port.

Building via Compose produces an image tagged `crawlify`, which you can reuse in other orchestrators.

## Environment Variables
Environment variables:

- `OPENROUTER_API_KEY`  
  OpenRouter Chat Completions API key. Not required unless the summary output is requested. Used to generate the `summary` format.

- `FIRECRAWL_API_KEY`  
  Firecrawl v2 API key. Required for the search endpoint. Used to access the upstream search service.

- `CRAWL_HTTP_PROXY`  
  Shared HTTP/HTTPS proxy for crawling and rendering fallback, e.g., `http://user:pass@proxy.local:3128`. Not required. Reuses a single proxy when direct access is unavailable.

Example `.env`:
```env
OPENROUTER_API_KEY=sk-...
FIRECRAWL_API_KEY=fc-...
CRAWL_HTTP_PROXY=http://proxy.local:3128
```

## HTTP Endpoints

### Usage Examples

#### Crawl Endpoint
```bash
# Basic usage - fetch HTML content
curl -X POST http://localhost:3000/api/v1/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": ["html", "markdown", "summary"]
  }'
```

#### Search Endpoint
```bash
# Basic search
curl -X POST http://localhost:3000/api/v1/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "open source crawling",
    "limit": 5
  }'
```

### `POST /api/v1/crawl`
- **Request body**
  ```json
  {
    "url": "https://example.com",
    "formats": ["html", "markdown"]
  }
  ```
  - `url`: required, target page URL.
  - `formats`: optional, de-duplicated array supporting `html`, `markdown`, `summary`, `links`, and `screenshot`; defaults to `['html']` when omitted.
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
      },
      "screenshot": {
        "url": "/screenshots/crawl_1234.png",
        "content_type": "image/png",
        "captured_at": "2024-06-01T12:00:00.000Z"
      }
    }
  }
  ```
- **Error handling**
  - When the upstream site cannot be fetched, the service returns a normalized error payload whose status mirrors the upstream status code or falls back to 502.
  - Failures affecting individual formats replace that format with `{ "status": "error", "message": "..." }` without aborting the entire request.
  - When the `screenshot` format is requested, the service captures a full-page PNG using Playwright, saves it under `public/screenshots`, and returns a relative URL that is immediately accessible via `GET /screenshots/<filename>.png`.

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
  npx playwright install-deps
  npx playwright install
  ```

## Screenshot Lifecycle
- Screenshots are written to `public/screenshots` and exposed through `/screenshots/*`.
- A background task runs hourly to delete images older than six hours, keeping disk usage predictable.
- Customize the retention interval by adjusting `initializeScreenshotCleanup` in `src/utils/screenshotCleanup.js` if your deployment needs different limits.

## Testing
```bash
npm test
```
The tests use Node.js' built-in test runner to cover both successful and failure scenarios for `crawlUrl` and `searchWeb`, stubbing external interactions.