/**
 * Enhanced Document Processing Service
 * Handles file upload, parsing, requirement extraction with detailed status tracking
 */

const axios = require('axios');
const logger = require('../config/logger');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

class DocumentService {
  /**
   * Ingest document: parse, chunk, embed, extract requirements
   */
  static async ingestDocument(documentId, filePath, fileType, namespace, projectId, io) {
    try {
      const startTime = Date.now();
      
      // Step 1: Parse and ingest into vector DB
      logger.info(`[Document ${documentId}] Starting ingestion...`);
      
      const ingestResponse = await axios.post(`${AI_SERVICE_URL}/documents/ingest`, {
        document_id: documentId,
        file_path: filePath,
        file_type: fileType,
        namespace,
        project_id: projectId,
      }, {
        timeout: 600000, // 10 minutes for large documents
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

      // Step 2: Extract requirements
      logger.info(`[Document ${documentId}] Starting requirement extraction...`);
      
      const extractResponse = await axios.post(
        `${AI_SERVICE_URL}/stories/extract-requirements`,
        {
          project_id: projectId,
          document_id: documentId,
          file_path: filePath,
          file_type: fileType,
          // ai_config can be optionally passed
        },
        {
          timeout: 600000,
        }
      );

      if (!extractResponse.data.success) {
        throw new Error('Requirement extraction failed on AI service');
      }

      const {
        functional_requirements,
        non_functional_requirements,
        modules,
        actors,
        parseMetadata: extractParseMetadata,
      } = extractResponse.data;

      logger.info(
        `[Document ${documentId}] Extraction complete: ${functional_requirements?.length || 0} functional, ` +
        `${non_functional_requirements?.length || 0} non-functional, ` +
        `${modules?.length || 0} modules, ${actors?.length || 0} actors`
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
          functional: functional_requirements || [],
          nonFunctional: non_functional_requirements || [],
          modules: modules || [],
          actors: actors || [],
          quality: {
            functionalCount: functional_requirements?.length || 0,
            nonFunctionalCount: non_functional_requirements?.length || 0,
            moduleCount: modules?.length || 0,
            actorCount: actors?.length || 0,
          },
        },
        totalTime,
      };

    } catch (error) {
      logger.error(
        `[Document ${documentId}] Ingestion failed: ${error.message}`,
        { stack: error.stack }
      );

      throw {
        success: false,
        error: error.message,
        stage: this._getErrorStage(error.message),
      };
    }
  }

  /**
   * Determine which stage of processing the error occurred in
   */
  static _getErrorStage(errorMessage) {
    if (!errorMessage) return 'unknown';
    
    const msg = errorMessage.toLowerCase();
    if (msg.includes('parse') || msg.includes('extract text')) return 'parsing';
    if (msg.includes('chunk') || msg.includes('embedding')) return 'chunking';
    if (msg.includes('requirement') || msg.includes('extraction')) return 'extraction';
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
