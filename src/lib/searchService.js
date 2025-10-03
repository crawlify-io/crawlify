const serpapi = require('serpapi');
const axios = require('axios');
const { URL } = require('node:url');
const { loadEnv } = require('../config/loadEnv');
const HttpError = require('../utils/httpError');

loadEnv();

const BACKENDS = {
  SERPAPI: 'serpapi',
  SEARXNG: 'searxng',
};

function resolveBackend() {
  const raw = (process.env.SEARCH_BACKEND ?? BACKENDS.SERPAPI).trim().toLowerCase();

  if (raw === BACKENDS.SEARXNG) {
    return BACKENDS.SEARXNG;
  }

  if (raw === BACKENDS.SERPAPI || raw === '') {
    return BACKENDS.SERPAPI;
  }

  throw new HttpError(503, {
    status: 'error',
    message: `Search is unavailable because backend "${process.env.SEARCH_BACKEND}" is not supported.`,
  });
}

async function searchWithSerpAPI({ query, limit }) {
  const apiKey = process.env.SERPAPI_API_KEY ?? '';

  if (apiKey.trim() === '') {
    throw new HttpError(503, {
      status: 'error',
      message: 'Search is unavailable because SerpAPI key is missing.',
    });
  }

  try {
    const params = {
      engine: 'google',
      api_key: apiKey,
      q: query,
      num: limit,
    };

    const body = await new Promise((resolve, reject) => {
      serpapi.getJson(
        params,
        (json) => resolve(json),
        (error) => reject(error),
      );
    });

    if (!body || typeof body !== 'object') {
      throw new Error('Search API response is invalid.');
    }

    if (typeof body.error === 'string' && body.error.trim() !== '') {
      throw new Error('Search API responded with an error.');
    }

    const rawItems = Array.isArray(body?.organic_results) ? body.organic_results.slice(0, limit) : [];

    const results = rawItems.map((item) => ({
      title: item?.title ?? null,
      description: item?.snippet ?? item?.description ?? null,
      url: item?.link ?? item?.url ?? null,
      metadata: {
        position: typeof item?.position === 'number' ? item.position : null,
        displayed_url: item?.displayed_link ?? null,
        source: item?.source ?? null,
      },
    }));

    const warning = body?.search_metadata?.status && body.search_metadata.status !== 'Success'
      ? body.search_metadata.status
      : null;

    return {
      query,
      limit,
      count: results.length,
      results,
      warning,
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(502, {
      status: 'error',
      message: 'Unable to complete search request.',
    });
  }
}

async function searchWithSearxng({ query, limit }) {
  const defaultBaseUrl = 'http://searxng:8080';
  const rawBaseUrl = (process.env.SEARXNG_BASE_URL ?? defaultBaseUrl).trim();

  if (rawBaseUrl === '') {
    throw new HttpError(503, {
      status: 'error',
      message: 'Search is unavailable because SearXNG base URL is missing.',
    });
  }

  let requestUrl;

  try {
    requestUrl = new URL('/search', rawBaseUrl);
  } catch (error) {
    throw new HttpError(503, {
      status: 'error',
      message: 'Search is unavailable because SearXNG base URL is invalid.',
    });
  }

  requestUrl.searchParams.set('q', query);
  requestUrl.searchParams.set('format', 'json');

  const searxngLanguage = (process.env.SEARXNG_LANGUAGE ?? '').trim();
  if (searxngLanguage) {
    requestUrl.searchParams.set('language', searxngLanguage);
  }

  const searxngEngines = (process.env.SEARXNG_ENGINES ?? '').trim();
  if (searxngEngines) {
    requestUrl.searchParams.set('engines', searxngEngines);
  }

  const searxngCategories = (process.env.SEARXNG_CATEGORIES ?? '').trim();
  if (searxngCategories) {
    requestUrl.searchParams.set('categories', searxngCategories);
  }

  try {
    const response = await axios.get(requestUrl.toString(), {
      timeout: Number.parseInt(process.env.SEARXNG_TIMEOUT_MS ?? '0', 10) || 10000,
    });

    const body = response?.data;

    if (!body || typeof body !== 'object') {
      throw new Error('Search API response is invalid.');
    }

    const rawItems = Array.isArray(body?.results) ? body.results.slice(0, limit) : [];

    const results = rawItems.map((item) => ({
      title: item?.title ?? null,
      description: item?.content ?? null,
      url: item?.url ?? null,
      metadata: {
        engine: item?.engine ?? null,
        category: item?.category ?? null,
        score: typeof item?.score === 'number' ? item.score : null,
      },
    }));

    const warning = Array.isArray(body?.errors) && body.errors.length > 0
      ? body.errors.join('; ')
      : null;

    return {
      query,
      limit,
      count: results.length,
      results,
      warning,
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(502, {
      status: 'error',
      message: 'Unable to complete search request.',
    });
  }
}

async function searchWeb({ query, limit }) {
  const backend = resolveBackend();

  if (backend === BACKENDS.SERPAPI) {
    return searchWithSerpAPI({ query, limit });
  }

  return searchWithSearxng({ query, limit });
}

module.exports = {
  searchWeb,
};
