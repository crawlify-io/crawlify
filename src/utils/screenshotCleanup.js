const fsPromises = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let scheduledTimer = null;

function initializeScreenshotCleanup(options = {}) {
  if (scheduledTimer) {
    return;
  }

  const directory = options.directory ?? path.resolve(__dirname, '../../public/screenshots');
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  const runCleanup = async () => {
    try {
      await pruneExpiredScreenshots(directory, ttlMs);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to clean screenshots directory:', error);
    }
  };

  runCleanup();

  scheduledTimer = setInterval(runCleanup, Math.max(intervalMs, 30_000));

  if (typeof scheduledTimer.unref === 'function') {
    scheduledTimer.unref();
  }
}

async function pruneExpiredScreenshots(directory, ttlMs) {
  let entries;

  try {
    entries = await fsPromises.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }

    throw error;
  }

  const now = Date.now();

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.endsWith('.png')) {
        return;
      }

      const filePath = path.join(directory, entry.name);
      let stats;

      try {
        stats = await fsPromises.stat(filePath);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return;
        }

        throw error;
      }

      if (now - stats.mtimeMs < ttlMs) {
        return;
      }

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

module.exports = {
  initializeScreenshotCleanup,
  pruneExpiredScreenshots,
};
