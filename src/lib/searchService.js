const axios = require('axios');
const HttpError = require('../utils/httpError');

async function searchWeb({ query, limit }) {
  const apiKey = process.env.FIRECRAWL_API_KEY ?? '';

  if (apiKey.trim() === '') {
    throw new HttpError(503, {
      status: 'error',
      message: 'Search is unavailable because Firecrawl API key is missing.',
    });
  }

  const payload = {
    query,
    limit,
    sources: ['web'],
  };

  try {
    const response = await axios.post('https://api.firecrawl.dev/v2/search', payload, {
      timeout: 20_000,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new HttpError(response.status || 502, {
        status: 'error',
        message: 'Unable to complete search request.',
      });
    }

    const body = response.data;

    if (!body || typeof body !== 'object' || body.success !== true) {
      throw new Error('Search API response indicates failure.');
    }

    const rawItems = Array.isArray(body?.data?.web) ? body.data.web : [];

    const results = rawItems.map((item) => ({
      title: item?.title ?? null,
      description: item?.description ?? null,
      url: item?.url ?? null,
      metadata: {
        source_url: item?.metadata?.sourceURL ?? null,
        status_code: item?.metadata?.statusCode ?? null,
        error: item?.metadata?.error ?? null,
      },
    }));

    return {
      query,
      limit,
      count: results.length,
      results,
      warning: body.warning ?? null,
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 502;

      throw new HttpError(status, {
        status: 'error',
        message: 'Unable to complete search request.',
      });
    }

    throw new HttpError(502, {
      status: 'error',
      message: 'Unexpected error occurred while searching.',
    });
  }
}

module.exports = {
  searchWeb,
};
