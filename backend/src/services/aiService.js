const axios = require('axios');
const logger = require('../config/logger');
const { getActiveAIConfigPayload } = require('./aiConfigService');
const { resolveAiServiceBaseUrl } = require('../utils/aiServiceUrl');
const { recordAIUsage } = require('./aiUsageService');

const AI_SERVICE_URL = resolveAiServiceBaseUrl(process.env.AI_SERVICE_URL);
const AI_INGEST_TIMEOUT_MS = Number(process.env.AI_INGEST_TIMEOUT_MS || 0);

const aiClient = axios.create({
  baseURL: AI_SERVICE_URL,
  timeout: 120000, // 2 minutes for AI ops
  headers: { 'Content-Type': 'application/json' },
});

const summarizeText = (value, maxChars = 1200) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}...[truncated]`;
};

const buildUsageRequestSummary = (label, parts = []) => (
  [label, ...parts.filter(Boolean)].join(' | ')
);

const recordUsageIfPresent = async ({ operation, aiConfig, requestSummary, responseData, responseSummary, errorMessage = '' }) => {
  const meta = responseData?.meta;
  if (!meta || (meta.provider !== 'deepseek_api' && meta.provider !== 'deepseek_local' && meta.provider !== 'openrouter')) {
    return;
  }

  try {
    await recordAIUsage({
      provider: aiConfig?.provider || meta.provider,
      model: aiConfig?.deepseekModel || aiConfig?.openrouterModel || meta.model || '',
      operation,
      requestSummary,
      responseSummary,
      requestMeta: meta?.request || {},
      responseMeta: meta,
      latencyMs: meta?.latencyMs || 0,
      status: errorMessage ? 'error' : 'success',
      errorMessage,
    });
  } catch (err) {
    logger.warn(`AI usage log write failed for ${operation}: ${err.message}`);
  }
};

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

const isRetryableHttpStatus = (status) => [408, 425, 429, 500, 502, 503, 504].includes(Number(status));

const postWithRetry = async (url, payload, options = {}, maxAttempts = 2) => {
  let lastError;
  for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
    try {
      return await aiClient.post(url, payload, options);
    } catch (error) {
      lastError = error;
      const retryable = isServiceUnavailableError(error) || isRetryableHttpStatus(error?.response?.status);
      if (!retryable || attempt >= maxAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  throw lastError;
};

const checkHealth = async () => {
  try {
    const response = await aiClient.get('/health', { timeout: 15000 });
    return {
      online: true,
      data: response.data,
    };
  } catch (error) {
    try {
      const response = await aiClient.get('/', { timeout: 5000 });
      return {
        online: true,
        data: {
          status: 'healthy',
          fallback: true,
          root: response.data || null,
        },
      };
    } catch (_) {
      // fall through to offline handling below
    }

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
const generateStories = async ({ projectId, projectName, moduleName, documentId, additionalContext, budget, deadline, teamMembers }) => {
  try {
    const aiConfig = await getActiveAIConfigPayload();
    const requestSummary = buildUsageRequestSummary('generateStories', [
      `project=${projectName || projectId || 'unknown'}`,
      `module=${moduleName || 'unknown'}`,
      documentId ? `document=${documentId}` : '',
      additionalContext ? `context=${summarizeText(additionalContext, 300)}` : '',
    ]);
    const response = await aiClient.post('/stories/generate', {
      project_id: projectId,
      project_name: projectName,
      module_name: moduleName,
      document_id: documentId,
      additional_context: additionalContext,
      budget,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      team_members: Array.isArray(teamMembers) ? teamMembers : [],
      ai_config: aiConfig,
    }, { timeout: 0 });
    await recordUsageIfPresent({
      operation: 'generateStories',
      aiConfig,
      requestSummary,
      responseData: response.data,
      responseSummary: summarizeText(JSON.stringify(response.data?.epics || response.data?.stories || response.data || {}), 500),
    });
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

const previewGenerateStoriesPrompt = async ({ projectId, projectName, moduleName, documentId, additionalContext, budget, deadline, teamMembers }) => {
  try {
    const aiConfig = await getActiveAIConfigPayload();
    const response = await aiClient.post('/stories/generate-prompt-preview', {
      project_id: projectId,
      project_name: projectName,
      module_name: moduleName,
      document_id: documentId,
      additional_context: additionalContext,
      budget,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      team_members: Array.isArray(teamMembers) ? teamMembers : [],
      ai_config: aiConfig,
    }, { timeout: 0 });
    return response.data;
  } catch (error) {
    logger.error(`AI Service - previewGenerateStoriesPrompt error: ${error.message}`);
    if (error?.response?.data) {
      logger.error(`AI Service - previewGenerateStoriesPrompt response: ${JSON.stringify(error.response.data)}`);
    }

    if (isServiceUnavailableError(error)) {
      throw asServiceUnavailable('preview generate stories prompt', error);
    }

    throw error;
  }
};

/**
 * Analyze code against story acceptance criteria
 */
const analyzeCode = async ({ projectId, changedFiles, stories, commitSha, commitMessage }) => {
  try {
    const aiConfig = await getActiveAIConfigPayload();
    const requestSummary = buildUsageRequestSummary('analyzeCode', [
      `project=${projectId || 'unknown'}`,
      `commit=${commitSha || 'unknown'}`,
      `files=${Array.isArray(changedFiles) ? changedFiles.length : 0}`,
      commitMessage ? `message=${summarizeText(commitMessage, 200)}` : '',
    ]);
    const response = await aiClient.post('/github/analyze', {
      project_id: projectId,
      changed_files: changedFiles,
      stories,
      commit_sha: commitSha,
      commit_message: commitMessage,
      ai_config: aiConfig,
    });
    await recordUsageIfPresent({
      operation: 'analyzeCode',
      aiConfig,
      requestSummary,
      responseData: response.data,
      responseSummary: summarizeText(JSON.stringify(response.data?.results || response.data || {}), 500),
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
    const requestSummary = buildUsageRequestSummary('suggestStories', [
      `project=${projectName || projectId || 'unknown'}`,
      `module=${moduleName || 'unknown'}`,
      userInput ? `input=${summarizeText(userInput, 250)}` : '',
    ]);
    const response = await postWithRetry('/stories/suggest', {
      project_id: projectId,
      project_name: projectName,
      module_name: moduleName,
      user_input: userInput,
      context_graph: contextGraph,
      fetched_chunks: contextGraph?.fetchedChunks || [],
      project_state: contextGraph?.projectState || {},
      ai_config: aiConfig,
    }, {}, 2);
    await recordUsageIfPresent({
      operation: 'suggestStories',
      aiConfig,
      requestSummary,
      responseData: response.data,
      responseSummary: summarizeText(JSON.stringify(response.data?.suggestions || response.data || {}), 500),
    });
    return response.data;
  } catch (error) {
    logger.error(`AI Service - suggestStories error: ${error.message}`);
    if (error?.response?.data) {
      logger.error(`AI Service - suggestStories response: ${JSON.stringify(error.response.data)}`);
    }

    if (isServiceUnavailableError(error)) {
      throw asServiceUnavailable('suggest stories', error);
    }

    throw error;
  }
};

const discoverGaps = async ({ projectId, moduleName, userInput, requirementMap, projectState, completedJiraIds }) => {
  try {
    const aiConfig = await getActiveAIConfigPayload();
    const requestSummary = buildUsageRequestSummary('discoverGaps', [
      `project=${projectId || 'unknown'}`,
      `module=${moduleName || 'unknown'}`,
      userInput ? `input=${summarizeText(userInput, 250)}` : '',
    ]);
    const response = await postWithRetry('/stories/discover-gaps', {
      project_id: projectId,
      module_name: moduleName,
      user_input: userInput,
      requirement_map: requirementMap || { items: [] },
      project_state: projectState || {},
      completed_jira_ids: Array.isArray(completedJiraIds) ? completedJiraIds : [],
      ai_config: aiConfig,
    }, {}, 2);
    await recordUsageIfPresent({
      operation: 'discoverGaps',
      aiConfig,
      requestSummary,
      responseData: response.data,
      responseSummary: summarizeText(JSON.stringify(response.data?.requirement_ids || response.data || {}), 500),
    });
    return response.data;
  } catch (error) {
    logger.error(`AI Service - discoverGaps error: ${error.message}`);
    if (isServiceUnavailableError(error)) {
      throw asServiceUnavailable('discover gaps', error);
    }
    throw error;
  }
};

const getChunksByIds = async ({ projectId, requirementIds, topKPerId = 2 }) => {
  try {
    const response = await postWithRetry('/stories/chunks-by-ids', {
      project_id: projectId,
      requirement_ids: requirementIds || [],
      top_k_per_id: topKPerId,
    }, {}, 2);
    return response.data;
  } catch (error) {
    logger.error(`AI Service - getChunksByIds error: ${error.message}`);
    if (isServiceUnavailableError(error)) {
      throw asServiceUnavailable('retrieve targeted SRS chunks', error);
    }
    throw error;
  }
};

const testLLM = async ({ prompt, aiConfig }) => {
  try {
    const resolvedConfig = aiConfig || (await getActiveAIConfigPayload());
    const response = await postWithRetry('/stories/standup-summary', {
      prompt: String(prompt || '').trim(),
      ai_config: resolvedConfig,
    }, { timeout: 45000 }, 1);
    await recordUsageIfPresent({
      operation: 'testLLM',
      aiConfig: resolvedConfig,
      requestSummary: buildUsageRequestSummary('testLLM', [`prompt=${summarizeText(prompt, 400)}`]),
      responseData: response.data,
      responseSummary: summarizeText(response.data?.summary || response.data?.output || response.data || '', 500),
    });
    return response.data?.success
      ? response.data
      : { success: false, summary: '' };
  } catch (error) {
    logger.error(`AI Service - testLLM error: ${error.message}`);
    if (isServiceUnavailableError(error)) {
      throw asServiceUnavailable('test AI provider', error);
    }
    const detail = error?.response?.data?.detail || error?.response?.data?.message || error?.message;
    const err = new Error(`AI provider test failed: ${detail}`);
    err.statusCode = Number(error?.response?.status || 502);
    throw err;
  }
};

/**
 * Extract structured requirements from an SRS document.
 */
const extractRequirements = async ({ projectId, documentId, filePath, fileType }) => {
  try {
    const aiConfig = await getActiveAIConfigPayload();
    const requestSummary = buildUsageRequestSummary('extractRequirements', [
      `project=${projectId || 'unknown'}`,
      `document=${documentId || 'unknown'}`,
      `type=${fileType || 'unknown'}`,
    ]);
    const response = await aiClient.post('/stories/extract-requirements', {
      project_id: projectId,
      document_id: documentId,
      file_path: filePath,
      file_type: fileType,
      ai_config: aiConfig,
    }, { timeout: AI_INGEST_TIMEOUT_MS });
    await recordUsageIfPresent({
      operation: 'extractRequirements',
      aiConfig,
      requestSummary,
      responseData: response.data,
      responseSummary: summarizeText(JSON.stringify(response.data?.functional_requirements || response.data || {}), 500),
    });
    return response.data;
  } catch (error) {
    logger.error(`AI Service - extractRequirements error: ${error.message}`);
    if (error?.response?.data) {
      logger.error(`AI Service - extractRequirements response: ${JSON.stringify(error.response.data)}`);
    }

    if (isServiceUnavailableError(error)) {
      throw asServiceUnavailable('extract requirements', error);
    }

    const status = Number(error?.response?.status || 0);
    if (status >= 500) {
      logger.warn('AI requirement extraction failed with upstream 5xx. Returning fallback extraction result.');
      const fallback = getMockRequirementExtraction(fileType);
      return {
        ...fallback,
        mock: true,
        message: 'AI extraction service returned an internal error. Returning safe empty extraction so ingestion can continue.',
        upstreamStatus: status,
      };
    }

    throw error;
  }
};

const getMockSuggestions = (moduleName, projectName, userInput, contextGraph = {}) => {
  const moduleLabel = moduleName || 'Core Module';
  const projectLabel = projectName || 'Current Project';
  const phase = contextGraph?.phase || 'start';
  const actor = Array.isArray(contextGraph?.actors) && contextGraph.actors.length
    ? contextGraph.actors[0]
    : 'project users';

  return {
    success: true,
    suggestions: [
      {
        title: `Define ${moduleLabel} MVP scope for ${projectLabel}`,
        type: 'integration',
        priority: 'high',
        module: moduleLabel,
        reason: `Fallback suggestion (${phase} phase) generated when AI suggest service is unavailable.`,
      },
      {
        title: `Create user stories for ${actor} around ${moduleLabel}`,
        type: 'story',
        priority: 'high',
        module: moduleLabel,
        reason: userInput
          ? `Includes user prompt context: ${String(userInput).slice(0, 120)}`
          : 'Derived from baseline planning context graph.',
      },
      {
        title: `Map Jira sync checkpoints for ${moduleLabel}`,
        type: 'integration',
        priority: 'medium',
        module: moduleLabel,
        reason: 'Ensures backlog items are push-ready and traceable in Jira.',
      },
      {
        title: `Break implementation into reviewable sprint tasks`,
        type: 'improvement',
        priority: 'medium',
        module: moduleLabel,
        reason: 'Keeps delivery flow moving while AI suggest endpoint recovers.',
      },
    ],
  };
};

const getMockRequirementExtraction = (fileType) => ({
  success: true,
  functional_requirements: [],
  non_functional_requirements: [],
  modules: [],
  actors: [],
  parseMetadata: {
    detectedType: fileType || 'unknown',
    detectionMethod: 'fallback',
    wordCount: 0,
    validationPassed: false,
    warnings: ['Fallback extraction used due to upstream AI extraction error'],
  },
});

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

module.exports = {
  ingestDocument,
  generateStories,
  previewGenerateStoriesPrompt,
  analyzeCode,
  suggestStories,
  discoverGaps,
  getChunksByIds,
  extractRequirements,
  testLLM,
  checkHealth,
  getActiveAIConfigPayload,
};
