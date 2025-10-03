# Crawlify Agents

## Overview
Crawlify exposes HTTP-driven agents that wrap external services and local tooling to crawl webpages and search the web. Requests are validated in the Express layer (`src/routes`) and then delegated to agent functions in `src/lib`. Agents return JSON payloads and use the shared `HttpError` helper for predictable failures.

## Agents At A Glance
- `crawlUrl`: Crawls a target URL and can return multiple content representations.
- `searchWeb`: Proxies search queries to SerpAPI or SearXNG (depending on configuration) and normalizes the response.

Each route focuses on input validation, consistent error handling, and logging unexpected issues before surfacing a 502.

## Integration Guidelines
- Implement new agents under `src/lib` and expose them via routes in `src/routes`.
- Use `HttpError` for deterministic status codes and payloads.
- Mirror the existing test approach in `tests/api.test.js` by stubbing external APIs and environment variables.

## Collaboration
- Collaboration: Communicate with developers in Chinese; use English for all project code.
- Git commits: AI-generated commit messages should be in English.
