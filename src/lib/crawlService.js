const axios = require('axios');
const cheerio = require('cheerio');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');
const { loadEnv } = require('../config/loadEnv');
const HttpError = require('../utils/httpError');

loadEnv();

const USER_AGENT = 'CrawlifyBot/1.0';
const SUPPORTED_FORMATS = new Set(['html', 'markdown', 'summary', 'links']);
const MARKDOWN_ERROR_MESSAGE = 'Failed to convert HTML to Markdown.';
const SUMMARY_RATE_LIMIT_MESSAGE = 'Summary is temporarily rate limited. Please try again soon.';

const HTML2MARKDOWN_PATH = path.resolve(__dirname, '../../bin/html2markdown');

async function crawlUrl({ url, formats }) {
  if (!Array.isArray(formats) || formats.length === 0) {
    formats = ['html'];
  }

  const normalizedFormats = formats.filter((format, index) =>
    SUPPORTED_FORMATS.has(format) && formats.indexOf(format) === index,
  );

  let response;

  try {
    response = await axios.get(url, {
      timeout: 20_000,
      headers: {
        'User-Agent': USER_AGENT,
      },
      responseType: 'text',
      validateStatus: () => true,
    });
  } catch (error) {
    throw new HttpError(502, {
      status: 'error',
      message: 'Unable to fetch the requested URL.',
    });
  }

  if (response.status < 200 || response.status >= 300) {
    throw new HttpError(response.status || 502, {
      status: 'error',
      message: 'Unable to fetch the requested URL.',
    });
  }

  let htmlContent = typeof response.data === 'string' ? response.data : '';
  let contentType = response.headers?.['content-type'] || null;
  const initialPlainText = extractPlainText(htmlContent);

  if (shouldRenderWithPlaywright({ html: htmlContent, plainText: initialPlainText, contentType })) {
    try {
      const rendered = await renderPageWithPlaywright(url);

      if (rendered?.html) {
        htmlContent = rendered.html;
        contentType = rendered.contentType || contentType || 'text/html; charset=utf-8';
      }
    } catch (error) {
      // Ignore Playwright rendering failures and fall back to the original HTML response.
    }
  }
  const formatsPayload = {};

  const wantsHtml = normalizedFormats.includes('html');
  const wantsMarkdown = normalizedFormats.includes('markdown');
  const wantsSummary = normalizedFormats.includes('summary');
  const wantsLinks = normalizedFormats.includes('links');

  if (wantsHtml) {
    formatsPayload.html = {
      content: htmlContent,
      content_type: contentType,
    };
  }

  let markdownContent = null;
  let markdownFailed = false;

  if (wantsMarkdown || wantsSummary) {
    try {
      markdownContent = await convertHtmlToMarkdown(htmlContent);
    } catch (error) {
      markdownFailed = true;
    }
  }

  if (wantsMarkdown) {
    if (!markdownFailed && markdownContent !== null) {
      formatsPayload.markdown = {
        content: markdownContent,
        content_type: 'text/markdown; charset=utf-8',
      };
    } else {
      formatsPayload.markdown = {
        status: 'error',
        message: MARKDOWN_ERROR_MESSAGE,
      };
    }
  }

  const plainTextContent = extractPlainText(htmlContent);

  if (wantsSummary) {
    const summarySource = plainTextContent !== '' ? plainTextContent : markdownContent || '';
    // eslint-disable-next-line no-await-in-loop
    formatsPayload.summary = await buildSummary(url, summarySource);
  }

  if (wantsLinks) {
    const links = extractLinks(htmlContent, url);
    formatsPayload.links = {
      items: links,
      count: links.length,
    };
  }

  return {
    id: `crawl_${uuidv4()}`,
    status: 'completed',
    url,
    fetched_at: new Date().toISOString(),
    formats: formatsPayload,
  };
}

function extractPlainText(html) {
  try {
    const $ = cheerio.load(html);
    const text = $('body').text();

    return text.replace(/\s+/g, ' ').trim();
  } catch (error) {
    return '';
  }
}

async function buildSummary(url, content) {
  const trimmed = content.trim();

  if (trimmed === '') {
    return {
      status: 'error',
      message: 'Summary is unavailable for empty content.',
    };
  }

  const apiKey = process.env.OPENROUTER_API_KEY ?? '';

  if (apiKey.trim() === '') {
    return {
      status: 'error',
      message: 'Summary is unavailable because OpenRouter API key is missing.',
    };
  }

  const payload = {
    model: 'google/gemini-2.5-flash-lite',
    messages: [
      {
        role: 'system',
        content: 'You summarize webpage content into concise English responses no longer than two sentences.',
      },
      {
        role: 'user',
        content: `Summarize the following content from ${url} in no more than two sentences:\n\n${trimmed.slice(0, 4000)}`,
      },
    ],
  };

  try {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
      timeout: 20_000,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      throw createSummaryError(response);
    }

    const summary = extractSummaryContent(response.data);

    if (!summary || summary.trim() === '') {
      throw new Error('Empty summary received from OpenRouter.');
    }

    return {
      content: summary.trim(),
      content_type: 'text/plain; charset=utf-8',
    };
  } catch (error) {
    if (error instanceof HttpError) {
      return error.body;
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;

      if (status === 429) {
        return {
          status: 'error',
          message: SUMMARY_RATE_LIMIT_MESSAGE,
        };
      }

      const message = extractProviderMessage(error.response?.data) || 'Failed to generate summary.';

      return {
        status: 'error',
        message,
      };
    }

    return {
      status: 'error',
      message: 'Failed to generate summary.',
    };
  }
}

async function convertHtmlToMarkdown(html) {
  const binaryPath = HTML2MARKDOWN_PATH;

  if (!isExecutable(binaryPath)) {
    throw new Error('html2markdown binary missing or not executable');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 10_000);

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    child.on('error', (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      if (settled) {
        return;
      }

      settled = true;

      if (timedOut) {
        reject(new Error('html2markdown conversion timed out'));
        return;
      }

      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        reject(new Error(stderr || MARKDOWN_ERROR_MESSAGE));
        return;
      }

      const output = Buffer.concat(stdoutChunks).toString('utf8').replace(/[\r\n]+$/, '');
      resolve(output);
    });

    child.stdin.on('error', () => {
      // Swallow errors resulting from the process terminating early.
    });

    child.stdin.end(html);
  });
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch (error) {
    return false;
  }
}

function createSummaryError(response) {
  const status = response?.status ?? 502;

  if (status === 429) {
    return new HttpError(status, {
      status: 'error',
      message: SUMMARY_RATE_LIMIT_MESSAGE,
    });
  }

  const providerMessage = extractProviderMessage(response?.data);

  return new HttpError(status, {
    status: 'error',
    message: providerMessage ? `Failed to generate summary: ${providerMessage}` : 'Failed to generate summary.',
  });
}

function extractProviderMessage(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const metadataRaw = data?.error?.metadata?.raw;
  const message = data?.error?.message;

  return typeof metadataRaw === 'string'
    ? metadataRaw
    : typeof message === 'string'
      ? message
      : null;
}

function extractSummaryContent(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  const message = choice?.message;

  if (!message) {
    return null;
  }

  if (typeof message === 'string') {
    return message;
  }

  const content = message.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const fragments = content
      .filter((fragment) => fragment && typeof fragment === 'object' && fragment.type === 'text' && typeof fragment.text === 'string')
      .map((fragment) => fragment.text);

    if (fragments.length > 0) {
      return fragments.join('\n\n');
    }
  }

  if (typeof message === 'object') {
    const fallbackFragments = Object.values(message)
      .filter((fragment) => fragment && typeof fragment === 'object' && fragment.type === 'text' && typeof fragment.text === 'string')
      .map((fragment) => fragment.text);

    if (fallbackFragments.length > 0) {
      return fallbackFragments.join('\n\n');
    }
  }

  return null;
}

function extractLinks(html, baseUrl) {
  const trimmed = html?.trim();

  if (!trimmed) {
    return [];
  }

  let $;

  try {
    $ = cheerio.load(html);
  } catch (error) {
    return [];
  }

  const links = [];
  const seen = new Set();

  $('a[href]').each((_, element) => {
    const href = ($(element).attr('href') || '').trim();

    if (!href || href.startsWith('#')) {
      return;
    }

    if (/^(javascript|mailto|tel|data):/i.test(href)) {
      return;
    }

    const resolved = resolveLink(href, baseUrl);

    if (!resolved || seen.has(resolved)) {
      return;
    }

    const text = $(element).text().replace(/\s+/g, ' ').trim();

    links.push({
      url: resolved,
      text: text !== '' ? text : null,
    });

    seen.add(resolved);
  });

  return links;
}

function resolveLink(href, baseUrl) {
  try {
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href)) {
      return href;
    }

    const base = new URL(baseUrl);

    if (!base.protocol || !base.hostname) {
      return null;
    }

    if (href.startsWith('//')) {
      return `${base.protocol}${href}`;
    }

    const resolved = new URL(href, base);

    return resolved.toString();
  } catch (error) {
    return null;
  }
}

async function renderPageWithPlaywright(url) {
  let chromium;

  try {
    ({ chromium } = require('playwright'));
  } catch (error) {
    return null;
  }

  if (!chromium || typeof chromium.launch !== 'function') {
    return null;
  }

  let browser;
  let context;
  let page;

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      userAgent: USER_AGENT,
    });
    page = await context.newPage();

    let response;

    try {
      response = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 20_000,
      });
    } catch (error) {
      if (error?.name === 'TimeoutError') {
        response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 10_000,
        });
      } else {
        throw error;
      }
    }

    const html = await page.content();
    let contentType = null;

    if (response) {
      try {
        if (typeof response.headerValue === 'function') {
          contentType = await response.headerValue('content-type');
        } else if (typeof response.headers === 'function') {
          const headers = await response.headers();
          contentType = headers?.['content-type'] || headers?.['Content-Type'] || null;
        }
      } catch (error) {
        // Ignore header extraction issues.
      }
    }

    return { html, contentType };
  } catch (error) {
    return null;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (error) {
        // Swallow cleanup errors.
      }
    }

    if (context) {
      try {
        await context.close();
      } catch (error) {
        // Swallow cleanup errors.
      }
    }

    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        // Swallow cleanup errors.
      }
    }
  }
}

function shouldRenderWithPlaywright({ html, plainText, contentType }) {
  const trimmedHtml = html?.trim();

  if (!trimmedHtml) {
    return true;
  }

  if (contentType && !/html/i.test(contentType)) {
    return false;
  }

  const textLength = plainText?.length ?? 0;

  if (textLength > 120) {
    return false;
  }

  const patterns = [
    /id="root"/i,
    /id="app"/i,
    /id="__next"/i,
    /data-reactroot/i,
    /ng-version/i,
    /<script[^>]+type="module"/i,
  ];

  if (patterns.some((pattern) => pattern.test(trimmedHtml))) {
    return true;
  }

  const scriptCount = (trimmedHtml.match(/<script\b/gi) || []).length;

  return textLength < 20 && scriptCount > 0;
}

module.exports = {
  crawlUrl,
  SUPPORTED_FORMATS,
};
