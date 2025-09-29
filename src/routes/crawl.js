const { Router } = require('express');
const { crawlUrl, SUPPORTED_FORMATS } = require('../lib/crawlService');
const HttpError = require('../utils/httpError');
const { validationError } = require('../utils/validation');

const router = Router();

router.post('/crawl', async (req, res) => {
  const { url, formats } = req.body ?? {};
  const errors = {};

  if (url === undefined) {
    errors.url = ['The url field is required.'];
  } else if (typeof url !== 'string' || !isValidUrl(url)) {
    errors.url = ['The url field must be a valid URL.'];
  }

  if (formats !== undefined) {
    if (!Array.isArray(formats)) {
      errors.formats = ['The formats field must be an array.'];
    } else {
      formats.forEach((format, index) => {
        if (typeof format !== 'string' || !SUPPORTED_FORMATS.has(format)) {
          errors[`formats.${index}`] = [`The selected formats.${index} is invalid.`];
        }
      });
    }
  }

  if (Object.keys(errors).length > 0) {
    return validationError(res, errors);
  }

  try {
    const result = await crawlUrl({ url, formats });

    return res.json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.statusCode || 500).json(error.body || {
        status: 'error',
        message: 'Unexpected error occurred while crawling.',
      });
    }

    // eslint-disable-next-line no-console
    console.error(error);

    return res.status(502).json({
      status: 'error',
      message: 'Unexpected error occurred while crawling.',
    });
  }
});

function isValidUrl(value) {
  try {
    // eslint-disable-next-line no-new
    new URL(value);

    return true;
  } catch (error) {
    return false;
  }
}

module.exports = router;
