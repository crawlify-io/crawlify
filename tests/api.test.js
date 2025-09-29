const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const { crawlUrl } = require('../src/lib/crawlService');
const { searchWeb } = require('../src/lib/searchService');
const HttpError = require('../src/utils/httpError');

test('crawlUrl returns requested formats when fetch succeeds', async () => {
  const originalGet = axios.get;
  const html = '<html><body><a href="https://example.com">Example</a></body></html>';

  axios.get = async () => ({
    status: 200,
    data: html,
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  });

  try {
    const result = await crawlUrl({
      url: 'https://source.test/page',
      formats: ['html', 'links', 'summary'],
    });

    assert.strictEqual(result.url, 'https://source.test/page');
    assert.ok(result.formats.html);
    assert.strictEqual(result.formats.html.content, html);
    assert.strictEqual(result.formats.links.count, 1);
    assert.deepStrictEqual(result.formats.links.items[0], {
      url: 'https://example.com',
      text: 'Example',
    });
    assert.deepStrictEqual(result.formats.summary, {
      status: 'error',
      message: 'Summary is unavailable because OpenRouter API key is missing.',
    });
  } finally {
    axios.get = originalGet;
  }
});

test('crawlUrl throws HttpError when upstream returns non-2xx status', async () => {
  const originalGet = axios.get;

  axios.get = async () => ({
    status: 404,
    data: '',
    headers: {},
  });

  try {
    await assert.rejects(
      () => crawlUrl({ url: 'https://source.test/missing', formats: ['html'] }),
      (error) => {
        assert.ok(error instanceof HttpError);
        assert.strictEqual(error.statusCode, 404);
        assert.strictEqual(error.body.message, 'Unable to fetch the requested URL.');

        return true;
      },
    );
  } finally {
    axios.get = originalGet;
  }
});

test('searchWeb throws 503 when API key is missing', async () => {
  const originalKey = process.env.FIRECRAWL_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;

  await assert.rejects(
    () => searchWeb({ query: 'node', limit: 5 }),
    (error) => {
      assert.ok(error instanceof HttpError);
      assert.strictEqual(error.statusCode, 503);
      assert.strictEqual(error.body.message, 'Search is unavailable because Firecrawl API key is missing.');

      return true;
    },
  );

  if (originalKey !== undefined) {
    process.env.FIRECRAWL_API_KEY = originalKey;
  }
});

test('searchWeb returns normalized results when Firecrawl responds successfully', async () => {
  const originalPost = axios.post;
  const originalKey = process.env.FIRECRAWL_API_KEY;
  process.env.FIRECRAWL_API_KEY = 'test-key';

  axios.post = async () => ({
    status: 200,
    data: {
      success: true,
      data: {
        web: [
          {
            title: 'Example Page',
            description: 'A summary',
            url: 'https://example.com',
            metadata: {
              sourceURL: 'https://source.example.com',
              statusCode: 200,
              error: null,
            },
          },
        ],
      },
      warning: 'partial results',
    },
  });

  try {
    const result = await searchWeb({ query: 'example', limit: 3 });

    assert.strictEqual(result.query, 'example');
    assert.strictEqual(result.limit, 3);
    assert.strictEqual(result.count, 1);
    assert.deepStrictEqual(result.results[0], {
      title: 'Example Page',
      description: 'A summary',
      url: 'https://example.com',
      metadata: {
        source_url: 'https://source.example.com',
        status_code: 200,
        error: null,
      },
    });
    assert.strictEqual(result.warning, 'partial results');
  } finally {
    axios.post = originalPost;

    if (originalKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalKey;
    } else {
      delete process.env.FIRECRAWL_API_KEY;
    }
  }
});
