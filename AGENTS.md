# Crawlify Agents

## Overview
Crawlify exposes a small set of HTTP-driven agents that wrap external services and local tooling to crawl webpages and search the web. Incoming requests are validated in the Express layer (`src/routes`) and then delegated to agent functions in `src/lib`. Each agent returns plain JSON payloads and surfaces operational issues through the shared `HttpError` helper.

## Environment Configuration
- Create a `.env` file in the project root to provide secrets during local development or container startup. Keys defined here apply unless the process already supplies an environment variable with the same name.
- The crawler summary feature reads `OPENROUTER_API_KEY`, and the search agent reads `FIRECRAWL_API_KEY` from `process.env`.

## HTTP Entry Points
- `POST /api/v1/crawl` → `crawlUrl` in `src/lib/crawlService.js`
- `POST /api/v1/search` → `searchWeb` in `src/lib/searchService.js`

Validation of request payloads happens in the route handlers before the agent functions are invoked. Validation failures return a 422 with the standard `{ message, errors }` shape from `src/utils/validation.js`.

## Crawl Agent (`crawlUrl`)
- **Purpose**: Fetch a target URL and return one or more derived representations (`html`, `markdown`, `summary`, `links`).
- **External dependencies**:
  - `axios` for HTTP GETs with a bot user agent (`CrawlifyBot/1.0`).
  - Local binary `bin/html2markdown` for Markdown conversion.
  - OpenRouter Chat Completions API for summaries.
- **Environment variables**:
  - `OPENROUTER_API_KEY` (required for summaries; missing key returns an inline `status: error`).
- **Execution flow**:
  1. Validate and de-duplicate requested formats; default to `['html']` when none provided.
  2. Download HTML. Non-2xx upstream status throws `HttpError` with the upstream status code.
  3. Produce each requested format:
     - `html`: Raw content plus `content_type` header.
     - `markdown`: Pipe HTML through the `html2markdown` binary. Failures surface as `{ status: 'error', message: 'Failed to convert HTML to Markdown.' }`.
     - `summary`: Summarize plain text (or Markdown fallback) via OpenRouter `google/gemini-2.5-flash-lite`. Handles rate limits (429) and provider error messages.
     - `links`: Extract absolute links + anchor text via Cheerio with duplicate suppression.
  4. Return a response envelope containing a generated crawl id, timestamps, and the `formats` map.
- **Error surface**: Unexpected conditions (timeouts, binary failures) downgrade individual formats to an error payload instead of failing the entire request, except for the initial fetch which aborts the crawl.

## Search Agent (`searchWeb`)
- **Purpose**: Proxy user search queries to the Firecrawl v2 API and normalize the results.
- **External dependencies**: `axios` POST requests to `https://api.firecrawl.dev/v2/search`.
- **Environment variables**:
  - `FIRECRAWL_API_KEY` (required; absence throws `HttpError` 503).
- **Execution flow**:
  1. Validate presence of `FIRECRAWL_API_KEY`.
  2. Submit the query, limit, and fixed `sources: ['web']` payload.
  3. Ensure Firecrawl responded with both a 2xx status and `success: true` flag.
  4. Map result items to `{ title, description, url, metadata }`, normalizing nested `metadata` keys.
  5. Return the `query`, `limit`, `count`, `results`, and optional `warning` message.
- **Error surface**: Upstream failures are wrapped as `HttpError` with either the Firecrawl status code or 502 fallback. Axios/network errors also convert to `HttpError` 502.

## Shared Behaviors
- **HttpError**: Located in `src/utils/httpError.js`. Agents throw this to communicate deterministic HTTP status codes and JSON bodies back to the route layer.
- **Testing**: `tests/api.test.js` stubs axios and environment variables to verify success and error paths for each agent.
- **Observability**: Route handlers log unexpected errors to stdout/stderr before returning 502 responses.

## Adding a New Agent
1. Create an agent module in `src/lib` encapsulating the new integration logic and throw `HttpError` for expected failures.
2. Add an Express route in `src/routes` that validates request payloads, marshals inputs, and forwards them to the agent.
3. Document required environment variables and external dependencies.
4. Write integration-focused unit tests in `tests/` that mock external APIs similarly to the existing suites.
