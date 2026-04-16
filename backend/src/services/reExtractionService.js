/**
 * Document Re-extraction Service
 * Handles intelligent re-extraction of requirements from documents
 * with strategy selection and version tracking
 */

const Document = require('../models/Document');
const Requirement = require('../models/Requirement');
const AuditLog = require('../models/AuditLog');
const logger = require('../config/logger');
const { getActiveAIConfigPayload } = require('./aiConfigService');
const { resolveAiServiceBaseUrl } = require('../utils/aiServiceUrl');

const AI_SERVICE_URL = resolveAiServiceBaseUrl(process.env.AI_SERVICE_URL);

const toIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') {
      return value.toHexString();
    }
    if (value._id && value._id !== value) {
      return toIdString(value._id);
    }
    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
      const text = value.toString();
      return text === '[object Object]' ? '' : text;
    }
  }
  return '';
};

class ReExtractionService {
  /**
   * Available extraction strategies
   */
  static STRATEGIES = {
    STANDARD: 'standard',           // Standard extraction with default prompt
    DETAIL_FOCUSED: 'detail_focused', // Focuses on detailed requirement descriptions
    MODULE_FIRST: 'module_first',    // Extracts modules first, then requirements per module
    ACTOR_DRIVEN: 'actor_driven',    // Organizes by actors/users first
    CONSTRAINT_HEAVY: 'constraint_heavy', // Emphasizes non-functional requirements
  };

  /**
   * Re-extract requirements with optional strategy
   */
  static async reExtractRequirements(
    documentId,
    strategy = this.STRATEGIES.STANDARD,
    projectId = null,
    io = null
  ) {
    try {
      const startTime = Date.now();

      // Fetch document
      const document = await Document.findById(documentId).populate('project');
      if (!document) {
        throw new Error('Document not found');
      }

      // Verify document is in extractable state
      if (document.status === 'failed' && !document.ingestionStatus?.errorStage?.includes('extraction')) {
        throw new Error('Document failed to parse. Run re-ingestion instead.');
      }

      const resolvedProjectId = projectId || toIdString(document.project);
      if (!resolvedProjectId) {
        throw new Error('Document is linked to an invalid project record.');
      }

      logger.info(
        `Starting re-extraction for document ${documentId} using strategy: ${strategy}`
      );

      // Emit starting event
      if (io) {
        io.to(`project:${resolvedProjectId}`).emit('document:re-extraction-start', {
          documentId,
          strategy,
        });
      }

      // Call AI service for extraction
      const extractionResult = await this._callExtractionAPI(
        document.filePath,
        document.fileType,
        strategy,
        resolvedProjectId
      );

      // Validate extracted content
      const validation = this._validateExtraction(extractionResult);
      if (!validation.isValid) {
        logger.warn(
          `Re-extraction validation warnings for ${documentId}: ${validation.warnings.join(', ')}`
        );
      }

      // Update document with new extraction
      const extractionVersion = (document.extractedRequirements?.extractionVersion || 0) + 1;

      const updateData = {
        'extractedRequirements.functional': extractionResult.functional_requirements || [],
        'extractedRequirements.nonFunctional': extractionResult.non_functional_requirements || [],
        'extractedRequirements.modules': extractionResult.modules || [],
        'extractedRequirements.actors': extractionResult.actors || [],
        'extractedRequirements.extractedAt': new Date(),
        'extractedRequirements.extractionVersion': extractionVersion,
        'extractedRequirements.lastStrategy': strategy,
        'extractedRequirements.quality.functionalCount': extractionResult.functional_requirements?.length || 0,
        'extractedRequirements.quality.nonFunctionalCount': extractionResult.non_functional_requirements?.length || 0,
        'extractedRequirements.quality.moduleCount': extractionResult.modules?.length || 0,
        'extractedRequirements.quality.actorCount': extractionResult.actors?.length || 0,
        'extractedRequirements.validationWarnings': validation.warnings,
        'extractedRequirements.validationScore': validation.score,
      };

      const updatedDocument = await Document.findByIdAndUpdate(
        documentId,
        updateData,
        { new: true }
      ).populate('project');

      // Update Requirement record
      await Requirement.findOneAndUpdate(
        { document: documentId },
        {
          document: documentId,
          project: resolvedProjectId,
          functional: extractionResult.functional_requirements || [],
          nonFunctional: extractionResult.non_functional_requirements || [],
          modules: extractionResult.modules || [],
          actors: extractionResult.actors || [],
          source: 'srs_re-extract',
          extractionVersion,
          lastStrategy: strategy,
        },
        { upsert: true, new: true }
      );

      const processingTime = Date.now() - startTime;

      // Emit success event
      if (io) {
        io.to(`project:${resolvedProjectId}`).emit('document:re-extraction-complete', {
          documentId,
          strategy,
          version: extractionVersion,
          functionalCount: extractionResult.functional_requirements?.length || 0,
          nonFunctionalCount: extractionResult.non_functional_requirements?.length || 0,
          moduleCount: extractionResult.modules?.length || 0,
          actorCount: extractionResult.actors?.length || 0,
          validationScore: validation.score,
          processingTime,
        });
      }

      // Create audit log
      await AuditLog.create({
        project: resolvedProjectId,
        action: 'document_re-extracted',
        entity: 'document',
        entityId: documentId,
        details: {
          strategy,
          extractionVersion,
          functionalCount: extractionResult.functional_requirements?.length || 0,
          nonFunctionalCount: extractionResult.non_functional_requirements?.length || 0,
          moduleCount: extractionResult.modules?.length || 0,
          actorCount: extractionResult.actors?.length || 0,
          validationScore: validation.score,
          validationWarnings: validation.warnings,
          processingTime,
        },
      });

      logger.info(
        `Re-extraction complete for ${documentId} (v${extractionVersion}): ` +
        `${extractionResult.functional_requirements?.length || 0} functional, ` +
        `${extractionResult.non_functional_requirements?.length || 0} non-functional, ` +
        `score=${validation.score}`
      );

      return {
        success: true,
        documentId,
        extractionVersion,
        results: {
          functional: extractionResult.functional_requirements || [],
          nonFunctional: extractionResult.non_functional_requirements || [],
          modules: extractionResult.modules || [],
          actors: extractionResult.actors || [],
        },
        validation,
        processingTime,
      };
    } catch (error) {
      logger.error(`Re-extraction failed for ${documentId}: ${error.message}`, {
        stack: error.stack,
      });

      // Emit error event
      const fallbackProjectId = toIdString(projectId);
      if (io && fallbackProjectId) {
        io.to(`project:${fallbackProjectId}`).emit('document:re-extraction-failed', {
          documentId,
          error: error.message,
        });
      }

      throw error;
    }
  }

  /**
   * Call AI service extraction with strategy-specific parameters
   */
  static async _callExtractionAPI(filePath, fileType, strategy, projectId) {
    try {
      const aiConfig = await getActiveAIConfigPayload();
      const payload = {
        project_id: projectId,
        file_path: filePath,
        file_type: fileType,
        ai_config: aiConfig,
      };

      // Add strategy-specific instructions
      const strategyInstructions = this._getStrategyInstructions(strategy);
      if (strategyInstructions) {
        payload.strategy = strategy;
        payload.instructions = strategyInstructions;
      }

      const response = await axios.post(
        `${AI_SERVICE_URL}/stories/extract-requirements`,
        payload,
        { timeout: 0 }
      );

      if (!response.data.success) {
        throw new Error('AI service extraction failed');
      }

      return response.data;
    } catch (error) {
      throw new Error(`AI service error: ${error.message}`);
    }
  }

  /**
   * Get strategy-specific instructions for LLM
   */
  static _getStrategyInstructions(strategy) {
    const instructions = {
      [this.STRATEGIES.DETAIL_FOCUSED]: `
        Focus on extracting extremely detailed and comprehensive requirements.
        For each requirement, ensure it includes: what it does, why it matters, 
        acceptance criteria, and any constraints or dependencies.
      `,
      [this.STRATEGIES.MODULE_FIRST]: `
        First identify and organize all system modules/components.
        Then extract requirements grouped by which module they belong to.
        Ensure every requirement is mapped to a module.
      `,
      [this.STRATEGIES.ACTOR_DRIVEN]: `
        Start by identifying all actors and user roles.
        Then extract requirements from each actor's perspective.
        Organize requirements by the actors who use them.
      `,
      [this.STRATEGIES.CONSTRAINT_HEAVY]: `
        Prioritize non-functional requirements and constraints.
        Focus on performance, security, reliability, usability, and compliance needs.
        Extract at least as many non-functional requirements as functional ones.
      `,
    };

    return instructions[strategy] || null;
  }

  /**
   * Validate extracted requirements quality
   */
  static _validateExtraction(extraction) {
    const warnings = [];
    let score = 100;

    const functional = extraction.functional_requirements || [];
    const nonFunctional = extraction.non_functional_requirements || [];
    const modules = extraction.modules || [];
    const actors = extraction.actors || [];

    // Check minimum requirements
    if (functional.length === 0) {
      warnings.push('No functional requirements extracted');
      score -= 30;
    } else if (functional.length < 3) {
      warnings.push('Very few functional requirements (< 3)');
      score -= 15;
    }

    if (nonFunctional.length === 0) {
      warnings.push('No non-functional requirements extracted');
      score -= 20;
    }

    if (modules.length === 0) {
      warnings.push('No modules identified');
      score -= 25;
    } else if (modules.length < 2) {
      warnings.push('Very few modules identified (< 2)');
      score -= 10;
    }

    if (actors.length === 0) {
      warnings.push('No actors/users identified');
      score -= 15;
    }

    // Check balance
    if (functional.length > 0 && nonFunctional.length > 0) {
      const ratio = nonFunctional.length / functional.length;
      if (ratio < 0.2) {
        warnings.push('Non-functional requirements underrepresented');
        score -= 5;
      }
    }

    // Ensure score stays within bounds
    score = Math.max(0, Math.min(100, score));

    return {
      isValid: warnings.length === 0,
      warnings,
      score,
      qualityLevel: score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low',
    };
  }

  /**
   * Get re-extraction history for a document
   */
  static async getExtractionHistory(documentId, limit = 10) {
    try {
      const document = await Document.findById(documentId);
      if (!document) {
        throw new Error('Document not found');
      }

      // Query audit logs for extraction events
      const auditLogs = await AuditLog.find({
        entity: 'document',
        entityId: documentId,
        action: { $in: ['document_ingested', 'document_re-extracted'] },
      })
        .sort({ createdAt: -1 })
        .limit(limit);

      return auditLogs.map(log => ({
        timestamp: log.createdAt,
        action: log.action,
        version: log.details?.extractionVersion,
        strategy: log.details?.lastStrategy,
        functionalCount: log.details?.functionalCount,
        nonFunctionalCount: log.details?.nonFunctionalCount,
        moduleCount: log.details?.moduleCount,
        actorCount: log.details?.actorCount,
        validationScore: log.details?.validationScore,
        processingTime: log.details?.processingTime,
      }));
    } catch (error) {
      logger.error(`Error getting extraction history: ${error.message}`);
      throw error;
    }
  }

  /**
   * Compare extraction results between versions
   */
  static async compareExtractions(documentId, version1, version2) {
    try {
      const history = await this.getExtractionHistory(documentId, 20);

      const ex1 = history.find(h => h.version === version1);
      const ex2 = history.find(h => h.version === version2);

      if (!ex1 || !ex2) {
        throw new Error('One or both versions not found');
      }

      return {
        version1: ex1,
        version2: ex2,
        deltas: {
          functionalDelta:
            (ex2.functionalCount || 0) - (ex1.functionalCount || 0),
          nonFunctionalDelta:
            (ex2.nonFunctionalCount || 0) - (ex1.nonFunctionalCount || 0),
          moduleDelta: (ex2.moduleCount || 0) - (ex1.moduleCount || 0),
          actorDelta: (ex2.actorCount || 0) - (ex1.actorCount || 0),
          scoreDelta: (ex2.validationScore || 0) - (ex1.validationScore || 0),
        },
      };
    } catch (error) {
      logger.error(`Error comparing extractions: ${error.message}`);
      throw error;
    }
  }
}

module.exports = ReExtractionService;
