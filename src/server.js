const { createApp } = require('./app');
const { initializeScreenshotCleanup } = require('./utils/screenshotCleanup');

const port = parseInt(process.env.PORT ?? '3000', 10);
const app = createApp();

initializeScreenshotCleanup();

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API server is running on port ${port}`);
});
