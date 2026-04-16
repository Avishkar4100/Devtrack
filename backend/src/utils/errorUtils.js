const NULL_ID_DEREF_PATTERN = /Cannot read properties of null \(reading '_id'\)/i;

const SERVICE_UNAVAILABLE_PATTERNS = [
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /ETIMEDOUT/i,
  /ECONNABORTED/i,
  /socket hang up/i,
  /network error/i,
  /service is offline/i,
];

const TIMEOUT_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /ETIMEDOUT/i,
  /ECONNABORTED/i,
];

const toText = (value) => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
};

const trimMessage = (message, maxLen = 260) => {
  const text = toText(message);
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
};

const sanitizeTechnicalMessage = (message) => {
  const text = trimMessage(message);
  if (!text) return '';

  if (NULL_ID_DEREF_PATTERN.test(text)) {
    return 'A related record is missing (owner, member, or project link). Please refresh and clean invalid project references.';
  }

  if (SERVICE_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'A required service is currently unreachable. Please retry in a moment.';
  }

  if (TIMEOUT_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'The request timed out while waiting for another service. Please retry.';
  }

  return text
    .replace(/^AI suggest failed:\s*/i, '')
    .replace(/^AI requirement extraction failed:\s*/i, '')
    .replace(/^AI service error:\s*/i, '')
    .trim();
};

const getClientErrorMessage = (error, fallbackMessage = 'Request failed') => {
  if (!error) return fallbackMessage;

  const direct = toText(error.publicMessage || error.clientMessage);
  if (direct) return sanitizeTechnicalMessage(direct);

  const responseData = error.response?.data;

  if (Array.isArray(responseData?.errors) && responseData.errors.length > 0) {
    const first = responseData.errors
      .map((item) => toText(item))
      .filter(Boolean)
      .join(', ');
    if (first) return sanitizeTechnicalMessage(first);
  }

  const detail = toText(responseData?.detail);
  if (detail) return sanitizeTechnicalMessage(detail);

  const responseMessage = toText(responseData?.message);
  if (responseMessage) return sanitizeTechnicalMessage(responseMessage);

  const errMessage = toText(error.message);
  if (errMessage) return sanitizeTechnicalMessage(errMessage);

  return fallbackMessage;
};

const getPublicErrorMessage = (error, statusCode, fallbackMessage = 'Internal server error') => {
  const candidate = getClientErrorMessage(error, fallbackMessage);

  if (statusCode < 500) {
    return candidate || fallbackMessage;
  }

  if (error?.code && String(error.code).startsWith('AI_')) {
    return candidate || fallbackMessage;
  }

  if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
    return candidate || fallbackMessage;
  }

  if (NULL_ID_DEREF_PATTERN.test(candidate)) {
    return 'A related record is missing (owner, member, or project link). Please refresh and clean invalid project references.';
  }

  if (SERVICE_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(candidate))) {
    return 'A required service is currently unreachable. Please retry in a moment.';
  }

  if (TIMEOUT_PATTERNS.some((pattern) => pattern.test(candidate))) {
    return 'The request timed out while waiting for another service. Please retry.';
  }

  return 'Internal server error. Please try again.';
};

module.exports = {
  getClientErrorMessage,
  getPublicErrorMessage,
};
