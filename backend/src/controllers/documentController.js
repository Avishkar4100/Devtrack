const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Document = require('../models/Document');
const Project = require('../models/Project');
const AuditLog = require('../models/AuditLog');
const aiService = require('../services/aiService');

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ['.pdf', '.docx', '.doc', '.txt', '.md'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error('Only PDF, DOCX, DOC, TXT, MD files are allowed'), false);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 50 * 1024 * 1024 } });

// @desc    Get documents for a project
// @route   GET /api/documents/project/:projectId
// @access  Private
const getDocuments = async (req, res) => {
  const docs = await Document.find({ project: req.params.projectId, isActive: true })
    .populate('uploadedBy', 'name email avatar')
    .sort('-createdAt');

  res.status(200).json({ success: true, count: docs.length, data: docs });
};

// @desc    Upload SRS document
// @route   POST /api/documents/upload/:projectId
// @access  Private
const uploadDocument = async (req, res) => {
  const project = await Project.findById(req.params.projectId);
  if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded' });
  }

  const ext = path.extname(req.file.originalname).toLowerCase().slice(1);

  const doc = await Document.create({
    project: project._id,
    uploadedBy: req.user.id,
    name: req.body.name || req.file.originalname,
    originalName: req.file.originalname,
    fileType: ext === 'doc' ? 'docx' : ext,
    filePath: req.file.path,
    fileSize: req.file.size,
    status: 'uploaded',
    vectorNamespace: `${project._id}-${Date.now()}`,
  });

  await AuditLog.create({
    project: project._id,
    user: req.user.id,
    action: 'document_uploaded',
    entity: 'document',
    entityId: doc._id,
    details: { fileName: doc.originalName, fileSize: doc.fileSize },
    ipAddress: req.ip,
  });

  // Trigger ingestion asynchronously
  ingestDocument(doc, project, req).catch(console.error);

  res.status(201).json({ success: true, data: doc });
};

// Background ingestion
const ingestDocument = async (doc, project, req) => {
  try {
    await Document.findByIdAndUpdate(doc._id, { status: 'processing' });

    const result = await aiService.ingestDocument({
      documentId: doc._id.toString(),
      filePath: path.resolve(doc.filePath),
      fileType: doc.fileType,
      namespace: doc.vectorNamespace,
      projectId: project._id.toString(),
    });

    await Document.findByIdAndUpdate(doc._id, {
      status: 'processed',
      'ingestionStatus.chunks': result.chunks || 0,
      'ingestionStatus.embeddings': result.embeddings || 0,
      'ingestionStatus.processingTime': result.processingTime || 0,
    });

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`project:${project._id}`).emit('document:ingested', {
        documentId: doc._id,
        status: 'processed',
        chunks: result.chunks,
      });
    }

    await AuditLog.create({
      project: project._id,
      user: doc.uploadedBy,
      action: 'document_ingested',
      entity: 'document',
      entityId: doc._id,
      details: result,
    });
  } catch (error) {
    await Document.findByIdAndUpdate(doc._id, {
      status: 'failed',
      'ingestionStatus.errorMessage': error.message,
    });
  }
};

// @desc    Delete document
// @route   DELETE /api/documents/:id
// @access  Private
const deleteDocument = async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

  doc.isActive = false;
  await doc.save();

  res.status(200).json({ success: true, message: 'Document deleted' });
};

// @desc    Re-ingest document
// @route   POST /api/documents/:id/reingest
// @access  Private
const reingestDocument = async (req, res) => {
  const doc = await Document.findById(req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: 'Document not found' });

  const project = await Project.findById(doc.project);

  doc.status = 'uploaded';
  doc.version = (doc.version || 1) + 1;
  await doc.save();

  ingestDocument(doc, project, req).catch(console.error);

  res.status(200).json({ success: true, message: 'Re-ingestion triggered', data: doc });
};

module.exports = { upload, getDocuments, uploadDocument, deleteDocument, reingestDocument };
