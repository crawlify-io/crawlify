function validationError(res, errors) {
  return res.status(422).json({
    message: 'The given data was invalid.',
    errors,
  });
}

module.exports = { validationError };
