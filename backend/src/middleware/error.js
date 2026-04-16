
const logger = require('../config/logger');
const { getPublicErrorMessage } = require('../utils/errorUtils');

const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || (res.statusCode === 200 ? 500 : res.statusCode);
  let message = getPublicErrorMessage(err, statusCode, 'Internal server error. Please try again.');
  let validationErrors = null;

  if (err.name === 'CastError') {
    message = `Resource not found. Invalid ID: ${err.value}`;
    statusCode = 404;
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    message = `Duplicate value for field: ${field}. Please use another value.`;
    statusCode = 400;
  }

  if (err.name === 'ValidationError') {
    validationErrors = Object.values(err.errors).map((val) => val.message);
    message = validationErrors.join(', ');
    statusCode = 400;
  }

  if (err.name === 'JsonWebTokenError') {
    message = 'Invalid token.';
    statusCode = 401;
  }

  if (err.name === 'TokenExpiredError') {
    message = 'Token has expired.';
    statusCode = 401;
  }

  if (statusCode >= 500) {
    logger.error(`[${statusCode}] requestId=${req.requestId || '-'} ${err.stack || err.message}`);
  }

  const payload = {
    success: false,
    message,
    requestId: req.requestId,
  };

  if (validationErrors && validationErrors.length > 0) {
    payload.errors = validationErrors;
  }

  if (process.env.NODE_ENV === 'development') {
    payload.stack = err.stack;
    payload.code = err.code;
  }

  res.status(statusCode).json(payload);
};

module.exports = { notFound, errorHandler };
