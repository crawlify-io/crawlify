const express = require('express');
const routes = require('./routes');

function createApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  app.use('/api/v1', routes);

  // Handle unknown routes similar to Express default but with JSON.
  app.use((req, res) => {
    res.status(404).json({
      status: 'error',
      message: 'Not Found',
    });
  });

  // Centralized error handler to return JSON responses.
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid JSON payload.',
      });
    }

    // Unexpected errors bubble here.
    // eslint-disable-next-line no-console
    console.error(err);

    res.status(500).json({
      status: 'error',
      message: 'Internal server error.',
    });
  });

  return app;
}

module.exports = { createApp };
