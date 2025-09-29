class HttpError extends Error {
  constructor(statusCode, body, message) {
    super(message || body?.message || 'HTTP Error');
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

module.exports = HttpError;
