const axios = require('axios');
const logger = require('../config/logger');
const AIConfig = require('../models/AIConfig');

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
const AI_INGEST_TIMEOUT_MS = Number(process.env.AI_INGEST_TIMEOUT_MS || 600000);

const aiClient = axios.create({
  baseURL: AI_SERVICE_URL,
  timeout: 120000, // 2 minutes for AI ops
  headers: { 'Content-Type': 'application/json' },
});

const isServiceUnavailableError = (error) => {
  const transientCodes = ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNABORTED'];
  if (transientCodes.includes(error?.code)) return true;
  return !error?.response;
};

const asServiceUnavailable = (action, originalError) => {
  const err = new Error(`AI service is offline. Unable to ${action}. Start ai-service and try again.`);
  err.code = 'AI_SERVICE_UNAVAILABLE';
  err.statusCode = 503;
  err.cause = originalError;
  return err;
};

const getActiveAIConfigPayload = async () => {
  const cfg = await AIConfig.findOne({ isActive: true }).lean();
  if (!cfg) return null;

  return {
    provider: cfg.provider,
    openrouterKeyName: cfg.openrouterKeyName,
    openrouterModel: cfg.openrouterModel,
    deepseekUrl: cfg.deepseekUrl,
    deepseekModel: cfg.deepseekModel,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
  };
};

const checkHealth = async () => {
  try {
    const response = await aiClient.get('/health', { timeout: 2500 });
    return {
      online: true,
      data: response.data,
    };
  } catch (error) {
    if (isServiceUnavailableError(error)) {
      return {
        online: false,
        data: null,
      };
    }
    throw error;
  }
};

/**
 * Ingest a document into the vector store
 */
const ingestDocument = async ({ documentId, filePath, fileType, namespace, projectId }) => {
  try {
    const response = await aiClient.post('/documents/ingest', {
      document_id: documentId,
      file_path: filePath,
      file_type: fileType,
      namespace,
      project_id: projectId,
    }, { timeout: AI_INGEST_TIMEOUT_MS });
    return response.data;
  } catch (error) {
    logger.error(`AI Service - ingestDocument error: ${error.message}`);
    if (isServiceUnavailableError(error)) {
      throw asServiceUnavailable('ingest document', error);
    }
    throw error;
  }
};

/**
 * Generate stories from a module description using RAG
 */
const generateStories = async ({ projectId, projectName, moduleName, documentId, additionalContext, budget, deadline }) => {
  try {
    const aiConfig = await getActiveAIConfigPayload();
    const response = await aiClient.post('/stories/generate', {
      project_id: projectId,
      project_name: projectName,
      module_name: moduleName,
      document_id: documentId,
      additional_context: additionalContext,
      budget,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      ai_config: aiConfig,
    }, { timeout: 0 });
    return response.data;
  } catch (error) {
    logger.error(`AI Service - generateStories error: ${error.message}`);
    if (error?.response?.data) {
      logger.error(`AI Service - generateStories response: ${JSON.stringify(error.response.data)}`);
    }

    if (isServiceUnavailableError(error)) {
      throw asServiceUnavailable('generate stories', error);
    }

    const status = Number(error?.response?.status || 0);
    if (status >= 500) {
      logger.warn('AI generation failed with upstream 5xx. Returning fallback generated backlog.');
      const fallback = getMockStories(moduleName, projectName);
      return {
        ...fallback,
        mock: true,
        message: 'AI generation service returned an internal error. Showing fallback backlog so planning can continue.',
        upstreamStatus: status,
      };
    }

    throw error;
  }
};

/**
 * Analyze code against story acceptance criteria
 */
const analyzeCode = async ({ projectId, changedFiles, stories, commitSha, commitMessage }) => {
  try {
    const response = await aiClient.post('/github/analyze', {
      project_id: projectId,
      changed_files: changedFiles,
      stories,
      commit_sha: commitSha,
      commit_message: commitMessage,
    });
    return response.data;
  } catch (error) {
    logger.error(`AI Service - analyzeCode error: ${error.message}`);
    if (isServiceUnavailableError(error)) {
      throw asServiceUnavailable('analyze code', error);
    }
    throw error;
  }
};

/**
 * Generate next-step planner suggestions from vectorless project context graph
 */
const suggestStories = async ({ projectId, projectName, moduleName, userInput, contextGraph }) => {
  try {
    const aiConfig = await getActiveAIConfigPayload();
    const response = await aiClient.post('/stories/suggest', {
      project_id: projectId,
      project_name: projectName,
      module_name: moduleName,
      user_input: userInput,
      context_graph: contextGraph,
      ai_config: aiConfig,
    });
    return response.data;
  } catch (error) {
    logger.error(`AI Service - suggestStories error: ${error.message}`);
    const isServiceDown = isServiceUnavailableError(error);
    if (isServiceDown) {
      const err = new Error('AI suggestion service is unavailable. Start ai-service and try Suggest again.');
      err.code = 'AI_SERVICE_UNAVAILABLE';
      err.statusCode = 503;
      throw err;
    }

    const upstreamStatus = Number(error?.response?.status || 500);
    const upstreamDetail = error?.response?.data?.detail;
    const upstreamMessage = error?.response?.data?.message;
    const message = upstreamDetail || upstreamMessage || error.message || 'AI suggestion request failed.';
    const err = new Error(`AI suggest failed: ${message}`);
    err.code = 'AI_SUGGEST_FAILED';
    err.statusCode = upstreamStatus;
    err.cause = error;
    throw err;
  }
};

/**
 * Extract structured requirements from an SRS document.
 */
const extractRequirements = async ({ projectId, documentId, filePath, fileType }) => {
  try {
    const aiConfig = await getActiveAIConfigPayload();
    const response = await aiClient.post('/stories/extract-requirements', {
      project_id: projectId,
      document_id: documentId,
      file_path: filePath,
      file_type: fileType,
      ai_config: aiConfig,
    }, { timeout: AI_INGEST_TIMEOUT_MS });
    return response.data;
  } catch (error) {
    logger.error(`AI Service - extractRequirements error: ${error.message}`);
    if (isServiceUnavailableError(error)) {
      throw asServiceUnavailable('extract requirements', error);
    }

    const upstreamStatus = Number(error?.response?.status || 500);
    const upstreamDetail = error?.response?.data?.detail;
    const upstreamMessage = error?.response?.data?.message;
    const message = upstreamDetail || upstreamMessage || error.message || 'Requirement extraction failed.';
    const err = new Error(`AI requirement extraction failed: ${message}`);
    err.code = 'AI_REQUIREMENT_EXTRACTION_FAILED';
    err.statusCode = upstreamStatus;
    err.cause = error;
    throw err;
  }
};

/**
 * Mock stories for when AI service is unavailable
 */
const getMockStories = (moduleName, projectName) => {
  const epicTitle = `${moduleName} Module`;
  const tempId = 'epic-1';

  return {
    epics: [
      {
        tempId,
        title: epicTitle,
        description: `This epic covers all functionality related to the ${moduleName} module for ${projectName}.`,
        sprint: 'S1',
        priority: 'high',
      },
    ],
    stories: [
      {
        epicTempId: tempId,
        type: 'story',
        title: `As a user, I can access the ${moduleName} dashboard`,
        description: `User-facing dashboard for the ${moduleName} module.`,
        acceptanceCriteria: [
          `${moduleName} dashboard is accessible from the main navigation`,
          'Data loads within 2 seconds',
          'Responsive layout works on mobile and desktop',
        ],
        sprint: 'S1',
        priority: 'high',
        storyPoints: 5,
      },
      {
        epicTempId: tempId,
        type: 'story',
        title: `As a user, I can create a new ${moduleName} entry`,
        description: `Form to create new entries in the ${moduleName} module.`,
        acceptanceCriteria: [
          'All required fields are validated',
          'Success notification shown on create',
          'Data persisted to database',
        ],
        sprint: 'S1',
        priority: 'high',
        storyPoints: 3,
      },
      {
        epicTempId: tempId,
        type: 'story',
        title: `As a user, I can edit and delete ${moduleName} entries`,
        description: `Edit and delete functionality for ${moduleName} module.`,
        acceptanceCriteria: [
          'Confirmation dialog shown before delete',
          'Edit form pre-populated with existing data',
          'Changes saved and reflected immediately',
        ],
        sprint: 'S2',
        priority: 'medium',
        storyPoints: 3,
      },
    ],
    tasks: [
      {
        epicTempId: tempId,
        type: 'task',
        title: `Implement ${moduleName} REST API endpoints (CRUD)`,
        description: `Backend API: GET, POST, PUT, DELETE for ${moduleName}`,
        acceptanceCriteria: [
          'All endpoints return proper HTTP status codes',
          'Input validation middleware applied',
          'Swagger/OpenAPI documentation added',
        ],
        sprint: 'S1',
        priority: 'high',
        storyPoints: 5,
      },
      {
        epicTempId: tempId,
        type: 'task',
        title: `Create ${moduleName} Mongoose model and schema`,
        description: `MongoDB schema with validation for ${moduleName}`,
        acceptanceCriteria: ['Schema includes all required fields', 'Indexes defined for query performance'],
        sprint: 'S1',
        priority: 'high',
        storyPoints: 2,
      },
    ],
    mock: true,
    message: 'AI service not available — generated placeholder stories. Configure AI service for real RAG-based generation.',
  };
};

module.exports = { ingestDocument, generateStories, analyzeCode, suggestStories, extractRequirements, checkHealth };
