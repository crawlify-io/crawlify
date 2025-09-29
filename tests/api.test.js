const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const axios = require('axios');
const { crawlUrl } = require('../src/lib/crawlService');
const { searchWeb } = require('../src/lib/searchService');
const HttpError = require('../src/utils/httpError');

test('crawlUrl returns requested formats when fetch succeeds', async () => {
  const originalGet = axios.get;
  const originalSummaryKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
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

    if (originalSummaryKey !== undefined) {
      process.env.OPENROUTER_API_KEY = originalSummaryKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
  }
});

test('crawlUrl supports screenshot format output', async () => {
  const originalGet = axios.get;
  const playwrightModuleId = require.resolve('playwright');
  const originalPlaywrightModule = require.cache[playwrightModuleId];
  const createdFiles = [];

  axios.get = async () => ({
    status: 200,
    data: '<html><body><h1>Screenshot Page</h1></body></html>',
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  });

  require.cache[playwrightModuleId] = {
    id: playwrightModuleId,
    filename: playwrightModuleId,
    loaded: true,
    exports: {
      chromium: {
        launch: async () => ({
          newContext: async () => ({
            newPage: async () => ({
              goto: async () => ({
                headerValue: async () => 'text/html; charset=utf-8',
                headers: async () => ({ 'content-type': 'text/html; charset=utf-8' }),
              }),
              screenshot: async ({ path: filePath }) => {
                createdFiles.push(filePath);
                await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
                await fsPromises.writeFile(filePath, 'mock image content');
              },
              close: async () => {},
            }),
            close: async () => {},
          }),
          close: async () => {},
        }),
      },
    },
  };

  try {
    const result = await crawlUrl({
      url: 'https://screenshot.example',
      formats: ['screenshot'],
    });

    assert.ok(result.formats.screenshot);
    assert.strictEqual(result.formats.screenshot.content_type, 'image/png');
    assert.ok(result.formats.screenshot.url.startsWith('/screenshots/'));

    const fileName = path.basename(result.formats.screenshot.url);
    const outputPath = path.resolve(__dirname, '..', 'public', 'screenshots', fileName);
    assert.ok(fs.existsSync(outputPath));
  } finally {
    axios.get = originalGet;

    if (originalPlaywrightModule) {
      require.cache[playwrightModuleId] = originalPlaywrightModule;
    } else {
      delete require.cache[playwrightModuleId];
    }

    await Promise.all(
      createdFiles.map(async (filePath) => {
        try {
          await fsPromises.unlink(filePath);
        } catch (error) {
          if (error?.code !== 'ENOENT') {
            throw error;
          }
        }
      }),
    );
  }
});

test('crawlUrl falls back to Playwright rendering for SPA shells', async () => {
  const originalGet = axios.get;
  const html = '<html><body><div id="root"></div><script src="/app.js"></script></body></html>';
  const playwrightModuleId = require.resolve('playwright');
  const originalPlaywrightModule = require.cache[playwrightModuleId];
  const originalProxy = process.env.CRAWL_HTTP_PROXY;
  process.env.CRAWL_HTTP_PROXY = 'http://proxy.internal:8080';

  axios.get = async () => ({
    status: 200,
    data: html,
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  });

  require.cache[playwrightModuleId] = {
    id: playwrightModuleId,
    filename: playwrightModuleId,
    loaded: true,
    exports: {
      chromium: {
        launch: async (options) => {
          assert.ok(options);
          assert.ok(options.proxy);
          assert.strictEqual(options.proxy.server, 'http://proxy.internal:8080');

          return {
            newContext: async () => ({
              newPage: async () => ({
                goto: async () => ({
                  headerValue: async () => 'text/html; charset=utf-8',
                  headers: async () => ({ 'content-type': 'text/html; charset=utf-8' }),
                }),
                content: async () => '<html><body><h1>Rendered Content</h1></body></html>',
                close: async () => {},
              }),
              close: async () => {},
            }),
            close: async () => {},
          };
        },
      },
    },
  };

  try {
    const result = await crawlUrl({
      url: 'https://spa.example',
      formats: ['html', 'links'],
    });

    assert.ok(result.formats.html.content.includes('Rendered Content'));
    assert.strictEqual(result.formats.links.count, 0);
  } finally {
    axios.get = originalGet;

    if (originalPlaywrightModule) {
      require.cache[playwrightModuleId] = originalPlaywrightModule;
    } else {
      delete require.cache[playwrightModuleId];
    }

    if (originalProxy !== undefined) {
      process.env.CRAWL_HTTP_PROXY = originalProxy;
    } else {
      delete process.env.CRAWL_HTTP_PROXY;
    }
  }
});

test('crawlUrl uses HTTP proxy configuration', async () => {
  const originalGet = axios.get;
  const originalProxy = process.env.CRAWL_HTTP_PROXY;
  process.env.CRAWL_HTTP_PROXY = 'http://user:pass@proxy.test:3128';
  let capturedConfig;

  axios.get = async (requestUrl, config) => {
    capturedConfig = config;

    return {
      status: 200,
      data: '<html><body><p>Proxy Content</p></body></html>',
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    };
  };

  try {
    await crawlUrl({
      url: 'https://proxied.example',
      formats: ['html'],
    });

    assert.ok(capturedConfig);
    assert.ok(capturedConfig.proxy);
    assert.deepStrictEqual(capturedConfig.proxy, {
      protocol: 'http',
      host: 'proxy.test',
      port: 3128,
      auth: {
        username: 'user',
        password: 'pass',
      },
    });
  } finally {
    axios.get = originalGet;

    if (originalProxy !== undefined) {
      process.env.CRAWL_HTTP_PROXY = originalProxy;
    } else {
      delete process.env.CRAWL_HTTP_PROXY;
    }
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
