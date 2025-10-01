const serpapi = require('serpapi');
const { loadEnv } = require('../config/loadEnv');
const HttpError = require('../utils/httpError');

loadEnv();

async function searchWeb({ query, limit }) {
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
        position: item?.position ?? null,
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

module.exports = {
  searchWeb,
};
