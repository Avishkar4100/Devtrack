const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Document = require('../models/Document');
const Requirement = require('../models/Requirement');
const Project = require('../models/Project');
const AuditLog = require('../models/AuditLog');
const DocumentService = require('../services/documentService');
const ReExtractionService = require('../services/reExtractionService');
const { emitPendingSnapshot } = require('./manualBridgeController');
const logger = require('../config/logger');
const { getClientErrorMessage } = require('../utils/errorUtils');

const IN_PROGRESS_DOCUMENT_STATUSES = ['uploaded', 'validating', 'parsing', 'embedding', 'extracting'];
const DEFAULT_STALE_INGESTION_MS = 45 * 60 * 1000;

const getHttpStatus = (error, fallback = 500) => {
  if (error?.name === 'ValidationError' || error?.name === 'CastError') return 400;
  const parsed = Number(error?.statusCode || error?.response?.status || fallback);
  if (!Number.isFinite(parsed) || parsed < 400 || parsed > 599) return fallback;
  return parsed;
};

const markStaleIngestionAsFailed = async (projectId) => {
  const staleMs = Number(process.env.DOCUMENT_INGESTION_STALE_MS || DEFAULT_STALE_INGESTION_MS);
  const cutoff = new Date(Date.now() - Math.max(60 * 1000, staleMs));

  const staleDocs = await Document.find({
    project: projectId,
    isActive: true,
    status: { $in: IN_PROGRESS_DOCUMENT_STATUSES },
    updatedAt: { $lt: cutoff },
  }).select('_id status updatedAt');

  if (!staleDocs.length) return 0;

  const staleIds = staleDocs.map((doc) => doc._id);
  await Document.updateMany(
    { _id: { $in: staleIds } },
    {
      $set: {
        status: 'failed',
        'ingestionStatus.errorStage': 'stale_in_progress',
        'ingestionStatus.errorMessage': 'Ingestion was interrupted during processing (service restart or timeout). Please re-ingest or re-upload the document.',
      },
    }
  );

  logger.warn(`Marked stale ingestion documents as failed for project ${projectId}: ${staleIds.length}`);
  return staleIds.length;
};

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

const mapJsonFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.json' || file.mimetype === 'application/json') cb(null, true);
  else cb(new Error('Only JSON map files are allowed'), false);
};

const mapUpload = multer({ storage, fileFilter: mapJsonFileFilter, limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * Get documents for a project with quality information
 */
const getDocuments = async (req, res) => {
  try {
    await markStaleIngestionAsFailed(req.params.projectId);

    const docs = await Document.find({ project: req.params.projectId, isActive: true })
      .populate('uploadedBy', 'name email avatar')
      .sort('-createdAt');

    // Enrich with quality reports
    const enrichedDocs = docs.map(doc => {
      const docObj = doc.toObject();
      if (doc.status === 'processed') {
        docObj.qualityReport = DocumentService.getDocumentQualityReport(doc);
      }
      return docObj;
    });

    res.status(200).json({ success: true, count: enrichedDocs.length, data: enrichedDocs });
  } catch (error) {
    logger.error(`Get documents error: ${error.message}`);
    res.status(getHttpStatus(error)).json({
      success: false,
      message: getClientErrorMessage(error, 'Unable to fetch documents for this project'),
    });
  }
};

/**
 * Upload SRS document and trigger async ingestion
 */
const uploadDocument = async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

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

    logger.info(`Document uploaded: ${doc._id} (${doc.originalName})`);

    // Trigger ingestion asynchronously
    const io = req.app.get('io');
    ingestDocument(doc, project, io).catch(error => {
      logger.error(`Async ingestion error for ${doc._id}: ${error.message}`);
    });

    res.status(201).json({ success: true, data: doc });
  } catch (error) {
    logger.error(`Upload document error: ${error.message}`);
    res.status(getHttpStatus(error)).json({
      success: false,
      message: getClientErrorMessage(error, 'Unable to upload this document'),
    });
  }
};

/**
 * Background ingestion with intermediate status tracking
 */
const ingestDocument = async (doc, project, io) => {
  try {
    // Status: validating
    await Document.findByIdAndUpdate(doc._id, { status: 'validating' });
    if (io) {
      io.to(`project:${project._id}`).emit('document:status', {
        documentId: doc._id,
        status: 'validating',
      });
    }

    // Status: parsing
    await Document.findByIdAndUpdate(doc._id, { status: 'parsing' });
    if (io) {
      io.to(`project:${project._id}`).emit('document:status', {
        documentId: doc._id,
        status: 'parsing',
      });
    }

    // Call enhanced document service
    const result = await DocumentService.ingestDocument(
      doc._id.toString(),
      path.resolve(doc.filePath),
      doc.fileType,
      doc.vectorNamespace,
      project._id.toString(),
      io
    );

    // Update document with ingestion metadata
    const updateData = {
      status: 'processed',
      'ingestionStatus.chunks': result.ingestionStatus.chunks,
      'ingestionStatus.embeddings': result.ingestionStatus.embeddings,
      'ingestionStatus.processingTime': result.ingestionStatus.processingTime,
      'ingestionStatus.detectedFileType': result.ingestionStatus.detectedFileType,
      'ingestionStatus.detectionMethod': result.ingestionStatus.detectionMethod,
      'ingestionStatus.textLength': result.ingestionStatus.textLength,
      'ingestionStatus.wordCount': result.ingestionStatus.wordCount,
      'ingestionStatus.validationPassed': result.ingestionStatus.validationPassed,
      'ingestionStatus.warnings': result.ingestionStatus.warnings,
    };

    if (Array.isArray(result.requirementGraph)) {
      updateData.requirementGraph = {
        items: result.requirementGraph,
        source: 'ingestion',
        generatedAt: new Date(),
        version: 1,
      };
    }

    // Store extracted requirements
    if (result.extractedRequirements) {
      updateData['extractedRequirements.functional'] = result.extractedRequirements.functional;
      updateData['extractedRequirements.nonFunctional'] = result.extractedRequirements.nonFunctional;
      updateData['extractedRequirements.modules'] = result.extractedRequirements.modules;
      updateData['extractedRequirements.actors'] = result.extractedRequirements.actors;
      updateData['extractedRequirements.extractedAt'] = new Date();
      updateData['extractedRequirements.quality.functionalCount'] = result.extractedRequirements.quality.functionalCount;
      updateData['extractedRequirements.quality.nonFunctionalCount'] = result.extractedRequirements.quality.nonFunctionalCount;
      updateData['extractedRequirements.quality.moduleCount'] = result.extractedRequirements.quality.moduleCount;
      updateData['extractedRequirements.quality.actorCount'] = result.extractedRequirements.quality.actorCount;
    }

    const updatedDoc = await Document.findByIdAndUpdate(doc._id, updateData, { new: true });

    // Update/create Requirement record
    if (result.extractedRequirements) {
      await Requirement.findOneAndUpdate(
        { project: project._id },
        {
          project: project._id,
          document: doc._id,
          functional: result.extractedRequirements.functional || [],
          nonFunctional: result.extractedRequirements.nonFunctional || [],
          modules: result.extractedRequirements.modules || [],
          actors: result.extractedRequirements.actors || [],
          source: 'srs_extract',
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    // Emit success event
    const qualityReport = DocumentService.getDocumentQualityReport(updatedDoc);
    if (io) {
      io.to(`project:${project._id}`).emit('document:ingested', {
        documentId: doc._id,
        status: 'processed',
        chunks: result.ingestionStatus.chunks,
        qualityScore: qualityReport.qualityScore,
        isHighQuality: qualityReport.isHighQuality,
      });
    }

    await AuditLog.create({
      project: project._id,
      user: doc.uploadedBy,
      action: 'document_ingested',
      entity: 'document',
      entityId: doc._id,
      details: {
        chunks: result.ingestionStatus.chunks,
        embeddings: result.ingestionStatus.embeddings,
        processingTime: result.totalTime,
        wordCount: result.ingestionStatus.wordCount,
        qualityScore: qualityReport.qualityScore,
      },
    });

    logger.info(
      `Document ingestion successful: ${doc._id} ` +
      `(${result.ingestionStatus.chunks} chunks, quality=${qualityReport.qualityScore})`
    );

  } catch (error) {
    logger.error(`Document ingestion failed: ${doc._id} - ${error.message}`, {
      stage: error.stage,
      stack: error.stack,
    });

    const errorUpdate = {
      status: 'failed',
      'ingestionStatus.errorMessage': error.error || error.message,
      'ingestionStatus.errorStage': error.stage || 'unknown',
    };

    await Document.findByIdAndUpdate(doc._id, errorUpdate);

    if (io) {
      io.to(`project:${project._id}`).emit('document:failed', {
        documentId: doc._id,
        error: error.error || error.message,
        stage: error.stage || 'unknown',
      });
    }

    await AuditLog.create({
      project: project._id,
      user: doc.uploadedBy,
      action: 'document_ingestion_failed',
      entity: 'document',
      entityId: doc._id,
      details: {
        error: error.error || error.message,
        stage: error.stage,
      },
    });
  }
};

/**
 * Delete document (soft delete)
 */
const deleteDocument = async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    doc.isActive = false;
    await doc.save();

    logger.info(`Document soft-deleted: ${doc._id}`);
    res.status(200).json({ success: true, message: 'Document deleted', data: doc });
  } catch (error) {
    logger.error(`Delete document error: ${error.message}`);
    res.status(getHttpStatus(error)).json({
      success: false,
      message: getClientErrorMessage(error, 'Unable to delete this document'),
    });
  }
};

/**
 * Re-ingest document with version bump
 */
const reingestDocument = async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    const project = await Project.findById(doc.project);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    doc.status = 'uploaded';
    doc.version = (doc.version || 1) + 1;
    doc.ingestionStatus = {}; // Clear previous ingestion status
    await doc.save();

    logger.info(`Document re-ingestion triggered: ${doc._id} (version ${doc.version})`);

    const io = null; // Re-ingest doesn't have io context from request
    ingestDocument(doc, project, null).catch(error => {
      logger.error(`Async re-ingestion error for ${doc._id}: ${error.message}`);
    });

    res.status(200).json({ success: true, message: 'Re-ingestion triggered', data: doc });
  } catch (error) {
    logger.error(`Re-ingest document error: ${error.message}`);
    res.status(getHttpStatus(error)).json({
      success: false,
      message: getClientErrorMessage(error, 'Unable to re-ingest this document'),
    });
  }
};

/**
 * Get document quality report
 */
const getDocumentQuality = async (req, res) => {
  try {
    const doc = await Document.findById(req.params.id).populate('uploadedBy', 'name email');
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    if (doc.status !== 'processed') {
      return res.status(400).json({
        success: false,
        message: 'Document not yet processed',
        status: doc.status,
      });
    }

    const qualityReport = DocumentService.getDocumentQualityReport(doc);
    res.status(200).json({ success: true, data: qualityReport });
  } catch (error) {
    logger.error(`Get document quality error: ${error.message}`);
    res.status(getHttpStatus(error)).json({
      success: false,
      message: getClientErrorMessage(error, 'Unable to fetch document quality report'),
    });
  }
};

/**
 * Re-extract requirements from document with optional strategy
 */
const reExtractDocument = async (req, res) => {
  try {
    const { strategy = 'standard' } = req.body;

    // Validate strategy
    if (!Object.values(ReExtractionService.STRATEGIES).includes(strategy)) {
      return res.status(400).json({
        success: false,
        message: `Invalid strategy. Available: ${Object.values(ReExtractionService.STRATEGIES).join(', ')}`,
      });
    }

    const doc = await Document.findById(req.params.id).populate('project');
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    if (!doc.project?._id) {
      return res.status(409).json({
        success: false,
        message: 'Document is linked to an invalid project. Re-upload or relink the document, then retry extraction.',
      });
    }

    if (doc.status === 'uploaded' || doc.status === 'validating' || doc.status === 'parsing') {
      return res.status(400).json({
        success: false,
        message: 'Document not yet ingested. Use re-ingestion instead.',
        status: doc.status,
      });
    }

    const io = req.app.get('io');
    const projectId = doc.project._id.toString();
    
    logger.info(`Re-extraction triggered for document ${doc._id} with strategy: ${strategy}`);

    // Trigger re-extraction asynchronously
    ReExtractionService.reExtractRequirements(
      doc._id.toString(),
      strategy,
      projectId,
      io
    ).catch(error => {
      logger.error(`Async re-extraction error for ${doc._id}: ${error.message}`);
      if (io) {
        io.to(`project:${projectId}`).emit('document:re-extraction-failed', {
          documentId: doc._id,
          error: getClientErrorMessage(error, 'Re-extraction failed'),
        });
      }
    });

    res.status(202).json({
      success: true,
      message: 'Re-extraction triggered',
      data: {
        documentId: doc._id,
        strategy,
        message: 'Re-extraction in progress. Check document:re-extraction-complete event.',
      },
    });
  } catch (error) {
    logger.error(`Re-extract document error: ${error.message}`);
    res.status(getHttpStatus(error)).json({
      success: false,
      message: getClientErrorMessage(error, 'Unable to trigger re-extraction'),
    });
  }
};

/**
 * Get extraction history for a document
 */
const getExtractionHistory = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const history = await ReExtractionService.getExtractionHistory(
      req.params.id,
      Math.min(parseInt(limit, 10) || 10, 50)
    );

    if (history.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No extraction history found',
      });
    }

    res.status(200).json({
      success: true,
      count: history.length,
      data: history,
    });
  } catch (error) {
    logger.error(`Get extraction history error: ${error.message}`);
    res.status(getHttpStatus(error)).json({
      success: false,
      message: getClientErrorMessage(error, 'Unable to fetch extraction history'),
    });
  }
};

/**
 * Compare two extraction versions
 */
const compareExtractions = async (req, res) => {
  try {
    const { version1, version2 } = req.query;

    if (!version1 || !version2) {
      return res.status(400).json({
        success: false,
        message: 'version1 and version2 query parameters required',
      });
    }

    const comparison = await ReExtractionService.compareExtractions(
      req.params.id,
      parseInt(version1, 10),
      parseInt(version2, 10)
    );

    res.status(200).json({
      success: true,
      data: comparison,
    });
  } catch (error) {
    logger.error(`Compare extractions error: ${error.message}`);
    res.status(getHttpStatus(error)).json({
      success: false,
      message: getClientErrorMessage(error, 'Unable to compare extraction versions'),
    });
  }
};

/**
 * Generate minified requirement map from Requirement records and persist on latest document.
 */
const generateRequirementMap = async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const result = await DocumentService.generateRequirementMap(project._id.toString(), {
      source: 'generated',
    });

    const io = req.app.get('io');
    await emitPendingSnapshot(io);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error(`Generate requirement map error: ${error.message}`);
    res.status(getHttpStatus(error)).json({
      success: false,
      message: getClientErrorMessage(error, 'Unable to generate requirement map'),
    });
  }
};

/**
 * Upload requirement map JSON and persist as minified map on latest active document.
 */
const uploadRequirementMap = async (req, res) => {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const latestDoc = await Document.findOne({ project: project._id, isActive: true }).sort({ updatedAt: -1 });
    if (!latestDoc) {
      return res.status(404).json({ success: false, message: 'No active document found for this project' });
    }

    if (!req.file?.path) {
      return res.status(400).json({ success: false, message: 'Upload a .json map file' });
    }

    const jsonText = fs.readFileSync(req.file.path, 'utf-8');
    const items = DocumentService.parseRequirementMapJson(jsonText);

    latestDoc.requirementMap = {
      items,
      source: 'uploaded_json',
      generatedAt: new Date(),
      version: (latestDoc.requirementMap?.version || 0) + 1,
    };
    await latestDoc.save();

    res.status(200).json({
      success: true,
      data: {
        projectId: project._id,
        documentId: latestDoc._id,
        requirementMap: latestDoc.requirementMap,
      },
    });
  } catch (error) {
    logger.error(`Upload requirement map error: ${error.message}`);
    res.status(getHttpStatus(error)).json({
      success: false,
      message: getClientErrorMessage(error, 'Unable to upload requirement map'),
    });
  }
};

module.exports = {
  upload,
  mapUpload,
  getDocuments,
  uploadDocument,
  deleteDocument,
  reingestDocument,
  getDocumentQuality,
  generateRequirementMap,
  uploadRequirementMap,
  reExtractDocument,
  getExtractionHistory,
  compareExtractions,
};
