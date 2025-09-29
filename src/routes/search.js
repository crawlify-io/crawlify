const { Router } = require('express');
const { searchWeb } = require('../lib/searchService');
const HttpError = require('../utils/httpError');
const { validationError } = require('../utils/validation');

const router = Router();

router.post('/search', async (req, res) => {
  const { query, limit } = req.body ?? {};
  const errors = {};

  if (query === undefined) {
    errors.query = ['The query field is required.'];
  } else if (typeof query !== 'string') {
    errors.query = ['The query field must be a string.'];
  } else if (query.trim().length < 2) {
    errors.query = ['The query field must be at least 2 characters.'];
  }

  if (limit !== undefined) {
    if (!Number.isInteger(limit)) {
      errors.limit = ['The limit field must be an integer.'];
    } else if (limit < 1) {
      errors.limit = ['The limit field must be at least 1.'];
    } else if (limit > 10) {
      errors.limit = ['The limit field may not be greater than 10.'];
    }
  }

  if (Object.keys(errors).length > 0) {
    return validationError(res, errors);
  }

  try {
    const response = await searchWeb({ query: query.trim(), limit: limit ?? 5 });

    return res.json(response);
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.statusCode || 500).json(error.body || {
        status: 'error',
        message: 'Unexpected error occurred while searching.',
      });
    }

    // eslint-disable-next-line no-console
    console.error(error);

    return res.status(502).json({
      status: 'error',
      message: 'Unexpected error occurred while searching.',
    });
  }
});

module.exports = router;
