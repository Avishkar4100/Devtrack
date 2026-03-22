require('dotenv').config();
const express = require('express');
const http = require('http');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const rateLimit = require('express-rate-limit');
require('express-async-errors');

const connectDB = require('./src/config/db');
const { errorHandler, notFound } = require('./src/middleware/error');
const logger = require('./src/config/logger');

// Route imports
const authRoutes = require('./src/routes/auth');
const projectRoutes = require('./src/routes/projects');
const documentRoutes = require('./src/routes/documents');
const storyRoutes = require('./src/routes/stories');
const jiraRoutes = require('./src/routes/jira');
const githubRoutes = require('./src/routes/github');
const dashboardRoutes = require('./src/routes/dashboard');
const sprintRoutes = require('./src/routes/sprints');
const insightRoutes = require('./src/routes/insightRoutes');

// Connect to MongoDB
connectDB();

const app = express();
const server = http.createServer(app);

morgan.token('id', (req) => req.requestId || '-');

app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
});

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

// Make io accessible globally
app.set('io', io);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: 'Too many requests from this IP, please try again after 15 minutes',
});

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(compression());
app.use(mongoSanitize());
app.use(hpp());
app.use('/api', limiter);

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging
app.use(morgan(':id :method :url :status :response-time ms - :res[content-length]', {
  stream: {
    write: (message) => logger.info(message.trim()),
  },
}));

// Static files (uploaded documents)
app.use('/uploads', express.static('uploads'));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'DevTrack API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/jira', jiraRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/sprints', sprintRoutes);
app.use('/api/insights', insightRoutes);

// Socket.io connection handling
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);

  socket.on('join-project', (projectId) => {
    socket.join(`project:${projectId}`);
    logger.info(`Socket ${socket.id} joined project:${projectId}`);
  });

  socket.on('leave-project', (projectId) => {
    socket.leave(`project:${projectId}`);
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Error handling
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  logger.info(`🚀 DevTrack Backend running on port ${PORT} in ${process.env.NODE_ENV} mode`);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Rejection: ${reason?.stack || reason}`);
});

process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.stack || error.message}`);
});

module.exports = { app, server, io };
