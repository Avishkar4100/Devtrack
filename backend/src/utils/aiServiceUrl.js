const DEFAULT_AI_SERVICE_URL = 'http://127.0.0.1:8000';

const resolveAiServiceBaseUrl = (rawUrl = '') => {
  const candidate = String(rawUrl || '').trim() || DEFAULT_AI_SERVICE_URL;

  try {
    const parsed = new URL(candidate);
    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1';
    }
    return parsed.toString().replace(/\/$/, '');
  } catch (_) {
    return candidate.replace(/^http:\/\/localhost(?::8000)?/i, DEFAULT_AI_SERVICE_URL).replace(/\/$/, '');
  }
};

module.exports = {
  DEFAULT_AI_SERVICE_URL,
  resolveAiServiceBaseUrl,
};