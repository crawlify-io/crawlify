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
  OpenRouter Chat Completions API key. Only required if you want to use the summary output format. You can obtain an API key by signing up at [https://openrouter.ai/](https://openrouter.ai/) and generating a key in your dashboard.

- `SERPAPI_API_KEY`  
  SerpAPI key. Required for the search endpoint. You can obtain an API key by registering at [https://serpapi.com/](https://serpapi.com/) and generating a key in your dashboard.

- `CRAWL_HTTP_PROXY`  
  Shared HTTP/HTTPS proxy for crawling and rendering fallback, e.g., `http://user:pass@proxy.local:3128`. Not required. Reuses a single proxy when direct access is unavailable.

Example `.env`:
```env
OPENROUTER_API_KEY=sk-...
SERPAPI_API_KEY=serp-...
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
