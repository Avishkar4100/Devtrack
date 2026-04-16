/**
 * Enhanced Document Processing Service
 * Handles file upload, parsing, requirement extraction with detailed status tracking
 */

const axios = require('axios');
const logger = require('../config/logger');
const { getActiveAIConfigPayload } = require('./aiConfigService');
const Requirement = require('../models/Requirement');
const Document = require('../models/Document');
const { resolveAiServiceBaseUrl } = require('../utils/aiServiceUrl');

const AI_SERVICE_URL = resolveAiServiceBaseUrl(process.env.AI_SERVICE_URL);

class DocumentService {
  static async _extractRequirementsViaAI({ projectId, documentId, filePath, fileType }) {
    const aiConfig = await getActiveAIConfigPayload();

    const response = await axios.post(
      `${AI_SERVICE_URL}/stories/extract-requirements`,
      {
        project_id: projectId,
        document_id: documentId,
        file_path: filePath,
        file_type: fileType,
        ai_config: aiConfig,
      },
      {
        timeout: 0,
      }
    );

    if (!response?.data?.success) {
      throw new Error('Requirement extraction failed on AI service while generating requirement map');
    }

    const functional = response.data.functional_requirements || [];
    const nonFunctional = response.data.non_functional_requirements || [];
    const modules = response.data.modules || [];
    const actors = response.data.actors || [];

    await Requirement.findOneAndUpdate(
      { project: projectId },
      {
        project: projectId,
        document: documentId,
        functional,
        nonFunctional,
        modules,
        actors,
        source: 'srs_extract',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return { functional, nonFunctional, modules, actors };
  }

  static _extractReqIdAndTitle(line = '', fallbackPrefix = 'FR') {
    const text = String(line || '').trim();
    const idMatch = text.match(/\b((?:FR|NFR)(?:-[A-Z0-9]+)*-\d{1,4})\b/i);
    const id = idMatch ? idMatch[1].toUpperCase() : null;
    let title = text;
    if (id) {
      title = text.replace(idMatch[0], '').replace(/^[:\-\s]+/, '').trim();
    }
    if (!title) title = text || `${fallbackPrefix} requirement`;
    return { id, title };
  }

  static _buildMapItemsFromRequirement(requirementDoc) {
    const modules = Array.isArray(requirementDoc?.modules) ? requirementDoc.modules : [];
    const primaryModule = modules[0] || 'General';
    const items = [];

    const functional = Array.isArray(requirementDoc?.functional) ? requirementDoc.functional : [];
    functional.forEach((line, idx) => {
      const { id, title } = DocumentService._extractReqIdAndTitle(line, 'FR');
      items.push({
        id: id || `FR-GEN-${String(idx + 1).padStart(3, '0')}`,
        title,
        module: primaryModule,
        status: 'draft',
      });
    });

    const nonFunctional = Array.isArray(requirementDoc?.nonFunctional) ? requirementDoc.nonFunctional : [];
    nonFunctional.forEach((line, idx) => {
      const { id, title } = DocumentService._extractReqIdAndTitle(line, 'NFR');
      items.push({
        id: id || `NFR-GEN-${String(idx + 1).padStart(3, '0')}`,
        title,
        module: primaryModule,
        status: 'draft',
      });
    });

    const seen = new Set();
    return items.filter((item) => {
      const key = `${item.id}|${item.title}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  static parseRequirementMapMarkdown(markdownText = '') {
    const lines = String(markdownText || '').split(/\r?\n/);
    const items = [];

    for (const line of lines) {
      const row = line.trim();
      if (!row || row.startsWith('#')) continue;

      // Supported formats:
      // - FR-AUTH-001 | User Login | Auth | draft
      // - FR-AUTH-001: User Login
      const pipeParts = row.replace(/^[-*]\s*/, '').split('|').map((p) => p.trim());
      if (pipeParts.length >= 2 && /^(FR|NFR)-/i.test(pipeParts[0])) {
        items.push({
          id: pipeParts[0].toUpperCase(),
          title: pipeParts[1] || 'Untitled requirement',
          module: pipeParts[2] || 'General',
          status: pipeParts[3] || 'draft',
        });
        continue;
      }

      const m = row.match(/^(?:[-*]\s*)?((?:FR|NFR)(?:-[A-Z0-9]+)*-\d{1,4})\s*[:\-]\s*(.+)$/i);
      if (m) {
        items.push({
          id: m[1].toUpperCase(),
          title: m[2].trim(),
          module: 'General',
          status: 'draft',
        });
      }
    }

    return items;
  }

  static parseRequirementMapJson(jsonText = '') {
    let parsed;
    try {
      parsed = JSON.parse(String(jsonText || '').trim());
    } catch (error) {
      throw new Error('Invalid JSON file for requirement map');
    }

    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.items)
        ? parsed.items
        : [];

    const normalized = rows
      .filter((row) => row && typeof row === 'object')
      .map((row, idx) => {
        const id = String(row.id || '').trim().toUpperCase();
        const title = String(row.title || '').trim();
        const module = String(row.module || 'General').trim() || 'General';
        const status = String(row.status || 'draft').trim() || 'draft';

        return {
          id: id || `FR-GEN-${String(idx + 1).padStart(3, '0')}`,
          title,
          module,
          status,
        };
      })
      .filter((row) => row.title);

    if (!normalized.length) {
      throw new Error('JSON map must contain non-empty items with at least title fields');
    }

    const seen = new Set();
    return normalized.filter((item) => {
      const key = `${item.id}|${item.title}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  static async generateRequirementMap(projectId, { source = 'generated', forceExtract = false } = {}) {
    const latestDoc = await Document.findOne({ project: projectId, isActive: true }).sort({ updatedAt: -1 });
    if (!latestDoc) {
      throw new Error('No active document found for this project');
    }

    let requirement = await Requirement.findOne({ project: projectId }).lean();

    if (!requirement && latestDoc.requirementMap?.items?.length) {
      const items = Array.isArray(latestDoc.requirementMap.items) ? latestDoc.requirementMap.items : [];
      requirement = {
        project: projectId,
        functional: items
          .filter((item) => String(item?.id || '').toUpperCase().startsWith('FR'))
          .map((item) => `${item.id}: ${item.title}`),
        nonFunctional: items
          .filter((item) => String(item?.id || '').toUpperCase().startsWith('NFR'))
          .map((item) => `${item.id}: ${item.title}`),
        modules: [...new Set(items.map((item) => item.module).filter(Boolean))],
        actors: [],
      };
    }

    // If no extracted requirements exist yet, force an AI extraction now.
    const hasAnyRequirements =
      requirement &&
      ((Array.isArray(requirement.functional) && requirement.functional.length > 0) ||
        (Array.isArray(requirement.nonFunctional) && requirement.nonFunctional.length > 0));

    if (forceExtract || !hasAnyRequirements) {
      await DocumentService._extractRequirementsViaAI({
        projectId,
        documentId: latestDoc._id.toString(),
        filePath: latestDoc.filePath,
        fileType: latestDoc.fileType,
      });
      requirement = await Requirement.findOne({ project: projectId }).lean();
    }

    const items = DocumentService._buildMapItemsFromRequirement(requirement);
    const requirementMap = {
      items,
      source,
      generatedAt: new Date(),
      version: 1,
    };

    if (latestDoc) {
      latestDoc.requirementMap = requirementMap;
      await latestDoc.save();
    }

    return {
      projectId,
      documentId: latestDoc?._id || null,
      requirementMap,
    };
  }

  /**
   * Ingest document: parse, chunk, and embed only.
   */
  static async ingestDocument(documentId, filePath, fileType, namespace, projectId, io) {
    try {
      const startTime = Date.now();
      
      // Step 1: Parse and ingest into vector DB
      logger.info(`[Document ${documentId}] Starting ingestion...`);

      if (io) {
        io.to(`project:${projectId}`).emit('document:status', {
          documentId,
          status: 'embedding',
        });
      }
      await Document.findByIdAndUpdate(documentId, { status: 'embedding' });
      
      const ingestResponse = await axios.post(`${AI_SERVICE_URL}/documents/ingest`, {
        document_id: documentId,
        file_path: filePath,
        file_type: fileType,
        namespace,
        project_id: projectId,
      }, {
        timeout: 0,
      });

      if (!ingestResponse.data.success) {
        throw new Error('Ingestion failed on AI service');
      }

      const {
        chunks,
        embeddings,
        processingTime,
        parseMetadata,
      } = ingestResponse.data;

      logger.info(
        `[Document ${documentId}] Ingestion complete: ${chunks} chunks, ${embeddings} embeddings, ` +
        `${parseMetadata?.wordCount || 0} words, ${parseMetadata?.textLength || 0} chars`
      );

      const totalTime = Date.now() - startTime;

      // Return comprehensive status
      return {
        success: true,
        ingestionStatus: {
          chunks: chunks || 0,
          embeddings: embeddings || 0,
          processingTime: processingTime || 0,
          detectedFileType: parseMetadata?.detectedType,
          detectionMethod: parseMetadata?.detectionMethod,
          textLength: parseMetadata?.textLength || 0,
          wordCount: parseMetadata?.wordCount || 0,
          validationPassed: parseMetadata?.validationPassed || false,
          warnings: parseMetadata?.warnings || [],
        },
        extractedRequirements: {
          functional: [],
          nonFunctional: [],
          modules: [],
          actors: [],
          quality: {
            functionalCount: 0,
            nonFunctionalCount: 0,
            moduleCount: 0,
            actorCount: 0,
          },
        },
        totalTime,
      };

    } catch (error) {
      const upstreamDetail = error?.response?.data?.detail || error?.response?.data?.message || '';
      const combinedMessage = upstreamDetail || error.message;
      logger.error(
        `[Document ${documentId}] Ingestion failed: ${combinedMessage}`,
        { stack: error.stack }
      );

      throw {
        success: false,
        error: combinedMessage,
        stage: this._getErrorStage(combinedMessage),
      };
    }
  }

  /**
   * Determine which stage of processing the error occurred in
   */
  static _getErrorStage(errorMessage) {
    if (!errorMessage) return 'unknown';
    
    const msg = errorMessage.toLowerCase();
    if (msg.includes('status code 502') || msg.includes('embedding service error')) return 'embedding';
    if (msg.includes('parse') || msg.includes('extract text')) return 'parsing';
    if (msg.includes('chunk') || msg.includes('embedding')) return 'embedding';
    if (msg.includes('ingest')) return 'ingestion';
    
    return 'unknown';
  }

  /**
   * Validate document quality before processing
   */
  static validateDocumentQuality(document) {
    const issues = [];

    if (!document.ingestionStatus?.wordCount) {
      issues.push('No text extracted from document');
    } else if (document.ingestionStatus.wordCount < 50) {
      issues.push(`Document too short (${document.ingestionStatus.wordCount} words, minimum 50)`);
    }

    if (!document.extractedRequirements?.functional?.length) {
      issues.push('No functional requirements extracted');
    }

    if (!document.extractedRequirements?.modules?.length) {
      issues.push('No modules identified');
    }

    return {
      isValid: issues.length === 0,
      issues,
      qualityScore: DocumentService._calculateQualityScore(document),
    };
  }

  /**
   * Calculate quality score based on extracted content
   */
  static _calculateQualityScore(document) {
    const req = document.extractedRequirements;
    const ing = document.ingestionStatus;

    let score = 0;
    
    // Text extraction quality (0-20 points)
    if (ing?.wordCount > 100) score += 20;
    else if (ing?.wordCount > 50) score += 10;

    // Requirements extraction (0-30 points)
    const functionalCount = req?.quality?.functionalCount || 0;
    const nonFunctionalCount = req?.quality?.nonFunctionalCount || 0;
    if (functionalCount > 5 && nonFunctionalCount > 2) score += 30;
    else if (functionalCount > 0 && nonFunctionalCount > 0) score += 20;
    else if (functionalCount > 0) score += 10;

    // Module extraction (0-25 points)
    const moduleCount = req?.quality?.moduleCount || 0;
    if (moduleCount > 5) score += 25;
    else if (moduleCount > 2) score += 15;
    else if (moduleCount > 0) score += 8;

    // Actors/Users (0-15 points)
    const actorCount = req?.quality?.actorCount || 0;
    if (actorCount > 0) score += 15;

    // Parsing warnings (-5 points per warning, min 0)
    const warnings = ing?.warnings?.length || 0;
    score = Math.max(0, score - (warnings * 5));

    // Normalize to 0-100
    return Math.min(100, score);
  }

  /**
   * Get document with all extracted content and quality metrics
   */
  static getDocumentQualityReport(document) {
    const quality = this.validateDocumentQuality(document);
    
    return {
      documentId: document._id,
      name: document.name,
      status: document.status,
      qualityScore: quality.qualityScore,
      isHighQuality: quality.qualityScore >= 70,
      issues: quality.issues,
      ingestionMetrics: {
        chunks: document.ingestionStatus?.chunks || 0,
        embeddings: document.ingestionStatus?.embeddings || 0,
        wordCount: document.ingestionStatus?.wordCount || 0,
        textLength: document.ingestionStatus?.textLength || 0,
        processingTime: document.ingestionStatus?.processingTime || 0,
      },
      extractionMetrics: {
        functional: document.extractedRequirements?.quality?.functionalCount || 0,
        nonFunctional: document.extractedRequirements?.quality?.nonFunctionalCount || 0,
        modules: document.extractedRequirements?.quality?.moduleCount || 0,
        actors: document.extractedRequirements?.quality?.actorCount || 0,
      },
      parseMetadata: {
        detectedType: document.ingestionStatus?.detectedFileType,
        detectionMethod: document.ingestionStatus?.detectionMethod,
        validationPassed: document.ingestionStatus?.validationPassed,
        warnings: document.ingestionStatus?.warnings || [],
      },
    };
  }
}

module.exports = DocumentService;
