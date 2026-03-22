const mongoose = require('mongoose');
const logger = require('./logger');

const isSrvLookupError = (error) => {
  const msg = `${error?.message || ''} ${error?.cause?.message || ''}`.toLowerCase();
  return msg.includes('querysrv econnrefused') || msg.includes('querysrv');
};

const getDirectFallbackUri = () => {
  const directUri = process.env.MONGO_URI_DIRECT || process.env.MONGO_URI_FALLBACK;
  return directUri && directUri.trim().length ? directUri.trim() : null;
};

const connectWithUri = async (uri) => mongoose.connect(uri, {
  serverSelectionTimeoutMS: 10000,
});

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    logger.error('❌ MONGO_URI is missing in environment variables.');
    process.exit(1);
    return;
  }

  try {
    const conn = await connectWithUri(mongoUri);
    logger.info(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    if (mongoUri.startsWith('mongodb+srv://') && isSrvLookupError(error)) {
      const fallbackUri = getDirectFallbackUri();
      if (fallbackUri) {
        try {
          logger.warn('⚠️ SRV DNS lookup failed. Trying MONGO_URI_DIRECT fallback...');
          const conn = await connectWithUri(fallbackUri);
          logger.info(`✅ MongoDB Connected via direct URI fallback: ${conn.connection.host}`);
          return;
        } catch (fallbackError) {
          logger.error(`❌ MongoDB fallback connection failed: ${fallbackError.message}`);
        }
      } else {
        logger.error('❌ SRV DNS lookup failed and MONGO_URI_DIRECT is not configured.');
        logger.error('Set MONGO_URI_DIRECT to Atlas direct mongodb:// URI and restart backend.');
      }
    }

    logger.error(`❌ MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected.');
});

module.exports = connectDB;
