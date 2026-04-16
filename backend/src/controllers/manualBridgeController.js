const axios = require('axios');
const logger = require('../config/logger');
const { getClientErrorMessage } = require('../utils/errorUtils');
const { resolveAiServiceBaseUrl } = require('../utils/aiServiceUrl');

const AI_SERVICE_URL = resolveAiServiceBaseUrl(process.env.AI_SERVICE_URL);
const bridgeClient = axios.create({
  baseURL: AI_SERVICE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

const parseLimit = (value, fallback = 200) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(num)));
};

const safeArray = (value) => (Array.isArray(value) ? value : []);

const emitPendingSnapshot = async (io) => {
  if (!io) return;
  try {
    const { data } = await bridgeClient.get('/manual-bridge/requests', {
      params: { status: 'pending', limit: 200 },
    });
    const pending = safeArray(data?.data);
    io.emit('PENDING_LLM_CALL', {
      pendingCount: pending.length,
      requests: pending,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.warn(`manual bridge pending snapshot emit failed: ${error.message}`);
  }
};

const listRequests = async (req, res) => {
  try {
    const status = req.query?.status;
    const limit = parseLimit(req.query?.limit, 200);

    const { data } = await bridgeClient.get('/manual-bridge/requests', {
      params: { status, limit },
    });

    return res.status(200).json({
      success: true,
      data: safeArray(data?.data),
      serviceHealthy: true,
    });
  } catch (error) {
    logger.warn(`manual bridge list fallback: ${error.message}`);
    return res.status(200).json({
      success: true,
      data: [],
      serviceHealthy: false,
      message: 'Manual bridge temporarily unavailable',
    });
  }
};

const getStats = async (req, res) => {
  try {
    const { data } = await bridgeClient.get('/manual-bridge/stats');
    return res.status(200).json({
      success: true,
      data: data?.data || {},
      serviceHealthy: true,
    });
  } catch (error) {
    logger.warn(`manual bridge stats fallback: ${error.message}`);
    return res.status(200).json({
      success: true,
      data: {
        total: 0,
        pending: 0,
        resolved: 0,
        rejected: 0,
        timed_out: 0,
      },
      serviceHealthy: false,
      message: 'Manual bridge temporarily unavailable',
    });
  }
};

const resolveRequest = async (req, res) => {
  try {
    const requestId = String(req.params?.requestId || '').trim();
    const responseText = String(req.body?.responseText || '').trim();
    if (!requestId) {
      return res.status(400).json({ success: false, message: 'requestId is required' });
    }
    if (!responseText) {
      return res.status(400).json({ success: false, message: 'responseText is required' });
    }

    const { data } = await bridgeClient.post(`/manual-bridge/requests/${requestId}/resolve`, {
      responseText,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('LLM_RESPONSE_RECEIVED', {
        requestId,
        status: 'resolved',
        updatedAt: new Date().toISOString(),
      });
    }
    await emitPendingSnapshot(io);

    return res.status(200).json({ success: true, data: data?.data || null });
  } catch (error) {
    return res.status(502).json({
      success: false,
      message: getClientErrorMessage(error, 'Manual bridge resolve failed'),
    });
  }
};

const rejectRequest = async (req, res) => {
  try {
    const requestId = String(req.params?.requestId || '').trim();
    const rejection = String(req.body?.error || 'Rejected from UI').trim();
    if (!requestId) {
      return res.status(400).json({ success: false, message: 'requestId is required' });
    }

    const { data } = await bridgeClient.post(`/manual-bridge/requests/${requestId}/reject`, {
      error: rejection,
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('LLM_RESPONSE_RECEIVED', {
        requestId,
        status: 'rejected',
        updatedAt: new Date().toISOString(),
      });
    }
    await emitPendingSnapshot(io);

    return res.status(200).json({ success: true, data: data?.data || null });
  } catch (error) {
    return res.status(502).json({
      success: false,
      message: getClientErrorMessage(error, 'Manual bridge reject failed'),
    });
  }
};

module.exports = {
  listRequests,
  getStats,
  resolveRequest,
  rejectRequest,
  emitPendingSnapshot,
};
