const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const axios = require('axios');
const serpapi = require('serpapi');
const { crawlUrl } = require('../src/lib/crawlService');
const HttpError = require('../src/utils/httpError');
const searchServicePath = require.resolve('../src/lib/searchService');

function loadSearchWeb() {
  delete require.cache[searchServicePath];

  return require('../src/lib/searchService').searchWeb;
}

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
  const originalKey = process.env.SERPAPI_API_KEY;
  delete process.env.SERPAPI_API_KEY;

  const searchWeb = loadSearchWeb();

  try {
    await assert.rejects(
      () => searchWeb({ query: 'node', limit: 5 }),
      (error) => {
        assert.ok(error instanceof HttpError);
        assert.strictEqual(error.statusCode, 503);
        assert.strictEqual(error.body.message, 'Search is unavailable because SerpAPI key is missing.');

        return true;
      },
    );
  } finally {
    delete require.cache[searchServicePath];
  }

  if (originalKey !== undefined) {
    process.env.SERPAPI_API_KEY = originalKey;
  }
});

test('searchWeb returns normalized results when SerpAPI responds successfully', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(serpapi, 'getJson');
  const originalKey = process.env.SERPAPI_API_KEY;
  process.env.SERPAPI_API_KEY = 'test-key';

  Object.defineProperty(serpapi, 'getJson', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: (params, onSuccess, onError) => {
      assert.strictEqual(params.engine, 'google');
      assert.strictEqual(params.api_key, 'test-key');
      assert.strictEqual(params.q, 'example');
      assert.strictEqual(params.num, 3);

      process.nextTick(() => {
        onSuccess({
          organic_results: [
            {
              title: 'Example Page',
              snippet: 'A summary',
              link: 'https://example.com',
              position: 1,
              displayed_link: 'example.com',
              source: 'Example Source',
            },
          ],
          search_metadata: {
            status: 'Success',
          },
        });
      });
    },
  });

  try {
    const searchWeb = loadSearchWeb();
    const result = await searchWeb({ query: 'example', limit: 3 });

    assert.strictEqual(result.query, 'example');
    assert.strictEqual(result.limit, 3);
    assert.strictEqual(result.count, 1);
    assert.deepStrictEqual(result.results[0], {
      title: 'Example Page',
      description: 'A summary',
      url: 'https://example.com',
      metadata: {
        position: 1,
        displayed_url: 'example.com',
        source: 'Example Source',
      },
    });
    assert.strictEqual(result.warning, null);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(serpapi, 'getJson', originalDescriptor);
    } else {
      delete serpapi.getJson;
    }
    delete require.cache[searchServicePath];

    if (originalKey !== undefined) {
      process.env.SERPAPI_API_KEY = originalKey;
    } else {
      delete process.env.SERPAPI_API_KEY;
    }
  }
});
