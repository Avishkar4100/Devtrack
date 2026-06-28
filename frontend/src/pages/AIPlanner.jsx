import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import { useProjectStore } from '@/store/projectStore'
import { useWorkspaceStateStore } from '@/store/workspaceStateStore'
import { appLogger } from '@/lib/logger'
import toast from 'react-hot-toast'

const makeId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

const normalizeGeneratedItems = (rows = [], prefix) =>
  rows.map((row) => ({
    ...row,
    tempId: row.tempId || makeId(prefix),
    selected: row.selected !== false,
    assignee: row.assignee || '',
  }))

const validateBacklogItems = ({ epics, stories, tasks, subtasks }) => {
  const errors = []
  
  epics.forEach((item, idx) => {
    if (!item.title || !item.title.trim()) {
      errors.push(`Epic ${idx + 1} is missing a title`)
    }
  })
  
  stories.forEach((item, idx) => {
    if (!item.title || !item.title.trim()) {
      errors.push(`Story ${idx + 1} is missing a title`)
    }
  })
  
  tasks.forEach((item, idx) => {
    if (!item.title || !item.title.trim()) {
      errors.push(`Task ${idx + 1} is missing a title`)
    }
  })
  
  subtasks.forEach((item, idx) => {
    if (!item.title || !item.title.trim()) {
      errors.push(`Subtask ${idx + 1} is missing a title`)
    }
  })
  
  return errors
}

const DEFAULT_SUGGESTIONS = { epics: [], stories: [], tasks: [] }
const DEFAULT_PLANNING_PATHS = []
const DEFAULT_BACKLOG_DRAFT = { epics: [], stories: [], tasks: [], subtasks: [] }
const DEFAULT_SUGGEST_CONTEXT = {
  discoveredRequirementIds: [],
  fetchedChunks: 0,
  fetchedChunkPreview: [],
}
const DEFAULT_PLANNER_LOGS = []
const DEFAULT_PLANNER_CHAT = [
  {
    role: 'assistant',
    text: 'Upload SRS, press Suggest, pick context prompts, add your instruction, then generate editable backlog and confirm push to Jira.',
  },
]

const plannerTabButtonClass = (active) =>
  `px-4 py-1.5 text-[14px] font-semibold rounded-[10px] border transition-colors ${active ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-900/50 border-slate-700 text-slate-300'}`

const normalizeBacklogDraft = (draft = {}) => ({
  epics: Array.isArray(draft.epics) ? draft.epics : [],
  stories: Array.isArray(draft.stories) ? draft.stories : [],
  tasks: Array.isArray(draft.tasks) ? draft.tasks : [],
  subtasks: Array.isArray(draft.subtasks) ? draft.subtasks : [],
})

const truncateLogValue = (value, maxChars = 1800) => {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'string' ? value : (() => {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  })()
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n...[truncated]`
}

const plannerLogTone = (kind = 'info', level = 'info') => {
  const palette = {
    system: { border: '#38bdf8', text: '#7dd3fc', glow: 'rgba(56, 189, 248, 0.18)' },
    request: { border: '#a78bfa', text: '#ddd6fe', glow: 'rgba(167, 139, 250, 0.18)' },
    response: { border: '#34d399', text: '#a7f3d0', glow: 'rgba(52, 211, 153, 0.18)' },
    ai: { border: '#f59e0b', text: '#fde68a', glow: 'rgba(245, 158, 11, 0.18)' },
    prompt: { border: '#c084fc', text: '#e9d5ff', glow: 'rgba(192, 132, 252, 0.18)' },
    error: { border: '#f87171', text: '#fecaca', glow: 'rgba(248, 113, 113, 0.18)' },
    status: { border: '#60a5fa', text: '#bfdbfe', glow: 'rgba(96, 165, 250, 0.18)' },
    map: { border: '#22c55e', text: '#86efac', glow: 'rgba(34, 197, 94, 0.18)' },
    upload: { border: '#f97316', text: '#fdba74', glow: 'rgba(249, 115, 22, 0.18)' },
  }

  if (level === 'error') return palette.error
  return palette[kind] || palette.system
}

export default function AIPlannerPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const {
    selectedProjectId,
    selectedJiraProjectKey,
    setSelectedJiraProjectKey,
    projects,
  } = useProjectStore()
  const plannerStorageKey = selectedProjectId || '__fallback__'
  const plannerHydrated = useWorkspaceStateStore((state) => state.hydrated)
  const persistedAIPlanner = useWorkspaceStateStore((state) => state.aiPlannerByProject[plannerStorageKey])
  const setAIPlannerState = useWorkspaceStateStore((state) => state.setAIPlannerState)
  const clearAIPlannerState = useWorkspaceStateStore((state) => state.clearAIPlannerState)

  const [planningPrompt, setPlanningPrompt] = useState('')
  const [srsFile, setSrsFile] = useState(null)
  const [mapFile, setMapFile] = useState(null)
  const [selectedSuggestionChips, setSelectedSuggestionChips] = useState([])
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [aiPlannerTab, setAiPlannerTab] = useState('planner')
  const [planningPaths, setPlanningPaths] = useState(DEFAULT_PLANNING_PATHS)
  const [selectedPlanningPaths, setSelectedPlanningPaths] = useState([])
  const [suggestContext, setSuggestContext] = useState(DEFAULT_SUGGEST_CONTEXT)
  const [backlogDraft, setBacklogDraft] = useState(DEFAULT_BACKLOG_DRAFT)
  const [promptPreview, setPromptPreview] = useState('')
  const [latestDocumentStatus, setLatestDocumentStatus] = useState(null)
  const [lastSrsLabel, setLastSrsLabel] = useState('')
  const [plannerResetAt, setPlannerResetAt] = useState(null)
  const [plannerChat, setPlannerChat] = useState(DEFAULT_PLANNER_CHAT)
  const [plannerLogs, setPlannerLogs] = useState(DEFAULT_PLANNER_LOGS)
  const [selectedItem, setSelectedItem] = useState(null)
  const [debugPanelOpen, setDebugPanelOpen] = useState(true)

  const filePickerRef = useRef(null)
  const mapPickerRef = useRef(null)
  const monitorInFlightRef = useRef(false)
  const plannerLoadedKeyRef = useRef('')
  const projectBootstrapAttemptedRef = useRef(false)

  useEffect(() => {
    if (!plannerHydrated) return
    if (plannerLoadedKeyRef.current === plannerStorageKey) return

    plannerLoadedKeyRef.current = plannerStorageKey
    const snapshot = persistedAIPlanner || {}

    setPlanningPrompt(snapshot.planningPrompt || '')
    setAiPlannerTab(snapshot.aiPlannerTab || 'planner')
    setSelectedSuggestionChips(Array.isArray(snapshot.selectedSuggestionChips) ? snapshot.selectedSuggestionChips : [])
    setSuggestionsOpen(Boolean(snapshot.suggestionsOpen))
    setPlanningPaths(Array.isArray(snapshot.planningPaths) ? snapshot.planningPaths : DEFAULT_PLANNING_PATHS)
    setSelectedPlanningPaths(Array.isArray(snapshot.selectedPlanningPaths) ? snapshot.selectedPlanningPaths : [])
    setSuggestContext(snapshot.suggestContext || DEFAULT_SUGGEST_CONTEXT)
    setBacklogDraft(snapshot.backlogDraft || DEFAULT_BACKLOG_DRAFT)
    setPromptPreview(snapshot.promptPreview || '')
    setLastSrsLabel(snapshot.lastSrsLabel || '')
    setPlannerResetAt(snapshot.plannerResetAt || null)
    setPlannerChat(Array.isArray(snapshot.plannerChat) && snapshot.plannerChat.length ? snapshot.plannerChat : DEFAULT_PLANNER_CHAT)
    setPlannerLogs(Array.isArray(snapshot.plannerLogs) ? snapshot.plannerLogs : DEFAULT_PLANNER_LOGS)
  }, [plannerHydrated, plannerStorageKey, persistedAIPlanner])

  useEffect(() => {
    if (!plannerHydrated) return
    if (plannerLoadedKeyRef.current !== plannerStorageKey) return

    setAIPlannerState(plannerStorageKey, {
      planningPrompt,
      aiPlannerTab,
      selectedSuggestionChips,
      suggestionsOpen,
      planningPaths,
      selectedPlanningPaths,
      suggestContext,
      backlogDraft,
      promptPreview,
      lastSrsLabel,
      plannerResetAt,
      plannerChat,
      plannerLogs,
    })
  }, [
    plannerHydrated,
    plannerStorageKey,
    planningPrompt,
    aiPlannerTab,
    selectedSuggestionChips,
    suggestionsOpen,
    planningPaths,
    selectedPlanningPaths,
    suggestContext,
    backlogDraft,
    promptPreview,
    lastSrsLabel,
    plannerResetAt,
    plannerChat,
    plannerLogs,
    setAIPlannerState,
  ])

  const { data: project } = useQuery({
    queryKey: ['ai-planner-project', selectedProjectId],
    enabled: !!selectedProjectId,
    queryFn: async () => (await api.get(`/projects/${selectedProjectId}`)).data.data,
  })

  useEffect(() => {
    if (project?.jiraProjectKey) {
      setSelectedJiraProjectKey(project.jiraProjectKey)
    }
  }, [project])

  const { data: documents = [] } = useQuery({
    queryKey: ['ai-planner-documents', selectedProjectId],
    enabled: !!selectedProjectId,
    queryFn: async () => (await api.get(`/documents/project/${selectedProjectId}`)).data.data || [],
    refetchOnWindowFocus: true,
  })

  const { data: backlogHistory = [], isFetching: isBacklogHistoryFetching } = useQuery({
    queryKey: ['ai-planner-backlog-history', selectedProjectId],
    enabled: !!selectedProjectId,
    queryFn: async () => (await api.get(`/stories/backlog-history/${selectedProjectId}`)).data.data || [],
  })

  const activeProject = useMemo(() => projects.find((p) => p._id === selectedProjectId) || null, [projects, selectedProjectId])
  const moduleName = useMemo(() => activeProject?.name || 'AI Planner', [activeProject])
  const selectedFileSummary = useMemo(() => {
    if (!srsFile) return 'No file selected'
    const kb = Math.max(1, Math.round(srsFile.size / 1024))
    return `${srsFile.name} (${kb} KB)`
  }, [srsFile])

  const selectedMapFileSummary = useMemo(() => {
    if (!mapFile) return 'No map file selected'
    const kb = Math.max(1, Math.round(mapFile.size / 1024))
    return `${mapFile.name} (${kb} KB)`
  }, [mapFile])

  const availableAssignees = useMemo(() => {
    const map = new Map()
    if (activeProject?.owner?._id) {
      map.set(activeProject.owner._id, {
        id: activeProject.owner._id,
        label: `${activeProject.owner.name || 'Owner'} (Owner)`,
      })
    }
    ;(activeProject?.members || []).forEach((m) => {
      if (!m?.user?._id) return
      const role = (m?.role || 'member').replace('_', ' ')
      map.set(m.user._id, {
        id: m.user._id,
        label: `${m.user.name || 'Member'} (${role})`,
      })
    })
    return [...map.values()]
  }, [activeProject])

  const normalizeDraftWithTeam = (draft = DEFAULT_BACKLOG_DRAFT) => {
    const assignees = availableAssignees || []
    const byLookup = new Map()
    assignees.forEach((assignee) => {
      byLookup.set(String(assignee.id).toLowerCase(), assignee.id)
      byLookup.set(String(assignee.label).toLowerCase(), assignee.id)
      byLookup.set(String(assignee.label).replace(/\s*\([^)]*\)\s*$/, '').toLowerCase(), assignee.id)
    })

    let cursor = 0
    const normalizeRows = (rows, prefix) => normalizeGeneratedItems(rows || [], prefix).map((row) => {
      const rawAssignee = String(row.assignee || '').trim().toLowerCase()
      const resolved = rawAssignee ? byLookup.get(rawAssignee) : ''
      const fallback = assignees.length ? assignees[cursor % assignees.length]?.id : ''
      cursor += 1
      return {
        ...row,
        assignee: resolved || fallback || '',
      }
    })

    const normalized = {
      epics: normalizeRows(draft.epics, 'epic'),
      stories: normalizeRows(draft.stories, 'story'),
      tasks: normalizeRows(draft.tasks, 'task'),
      subtasks: normalizeRows(draft.subtasks, 'subtask'),
    }

    const epicIds = new Set(normalized.epics.map((epic) => epic.tempId))
    const storyIds = new Set(normalized.stories.map((story) => story.tempId))
    const taskIds = new Set(normalized.tasks.map((task) => task.tempId))
    const allParentIds = new Set([...storyIds, ...taskIds]) // subtasks can be children of stories OR tasks
    const firstEpic = normalized.epics[0]?.tempId || ''
    const firstStory = normalized.stories[0]?.tempId || ''
    const firstTask = normalized.tasks[0]?.tempId || ''

    normalized.stories = normalized.stories.map((story) => ({
      ...story,
      epicTempId: epicIds.has(story.epicTempId) ? story.epicTempId : firstEpic,
    }))
    normalized.tasks = normalized.tasks.map((task) => ({
      ...task,
      epicTempId: epicIds.has(task.epicTempId) ? task.epicTempId : (
        normalized.stories.find((story) => story.tempId === task.parentTempId)?.epicTempId
        || normalized.tasks.find((row) => row.tempId === task.parentTempId)?.epicTempId
        || firstEpic
      ),
    }))
    normalized.subtasks = normalized.subtasks.map((subtask) => ({
      ...subtask,
      parentTempId: allParentIds.has(subtask.parentTempId) ? subtask.parentTempId : (subtask.parentTempId || firstStory),
      epicTempId: epicIds.has(subtask.epicTempId) ? subtask.epicTempId : (
        // Look up the epic from the parent (story or task)
        [...normalized.stories, ...normalized.tasks].find((item) => item.tempId === subtask.parentTempId)?.epicTempId || firstEpic
      ),
    }))

    return normalized
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  const copyText = async (value, label = 'text') => {
    const text = String(value || '').trim()
    if (!text) {
      toast.error(`Nothing to copy from ${label}`)
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied`)
    } catch {
      toast.error(`Could not copy ${label}`)
    }
  }

  const appendPlannerLog = (entry) => {
    const now = new Date().toISOString()
    const nextEntry = {
      id: makeId('log'),
      ts: now,
      kind: entry.kind || 'system',
      level: entry.level || 'info',
      step: entry.step || 'planner',
      title: entry.title || 'Planner event',
      summary: entry.summary || '',
      request: entry.request ?? null,
      response: entry.response ?? null,
      raw: entry.raw ?? null,
      prompt: entry.prompt ?? null,
      meta: entry.meta ?? null,
    }

    setPlannerLogs((prev) => [nextEntry, ...prev].slice(0, 120))
  }

  const resetPlannerWorkspace = () => {
    const now = new Date().toISOString()
    clearAIPlannerState(plannerStorageKey)
    setPlannerResetAt(now)
    setPlanningPrompt('')
    setSrsFile(null)
    setMapFile(null)
    setSelectedSuggestionChips([])
    setSuggestionsOpen(false)
    setPlanningPaths(DEFAULT_PLANNING_PATHS)
    setSelectedPlanningPaths([])
    setSuggestContext(DEFAULT_SUGGEST_CONTEXT)
    setBacklogDraft(DEFAULT_BACKLOG_DRAFT)
    setPromptPreview('')
    setLatestDocumentStatus(null)
    setLastSrsLabel('')
    setPlannerChat(DEFAULT_PLANNER_CHAT)
    setPlannerLogs(DEFAULT_PLANNER_LOGS)
    setSelectedItem(null)
    toast.success('AI Planner reset. Upload a fresh SRS to start a new planning session.')
    appendPlannerLog({
      kind: 'system',
      step: 'planner_reset',
      title: 'Planner reset',
      summary: 'Cleared cached SRS, requirement map, suggestions, timeline, and execution logs.',
      response: { resetAt: now },
    })
  }

  const resolveProjectId = async () => selectedProjectId || ''

  useEffect(() => {
    if (!plannerHydrated) return
    if (projectBootstrapAttemptedRef.current) return

    projectBootstrapAttemptedRef.current = true
    if (!selectedProjectId) {
      projectBootstrapAttemptedRef.current = false
    }
  }, [plannerHydrated, selectedProjectId, selectedJiraProjectKey, projects])

  const handleSrsFileChange = (e) => {
    const file = e.target.files?.[0] || null
    setSrsFile(file)
    if (file) {
      setLastSrsLabel(`${file.name} - selected`)
    }
  }

  const handleMapFileChange = (e) => {
    const file = e.target.files?.[0] || null
    if (file && !String(file.name || '').toLowerCase().endsWith('.json')) {
      toast.error('Select a .json map file only')
      setMapFile(null)
      return
    }
    setMapFile(file)
  }

  const monitorDocumentIngestion = async (documentId, documentName, projectIdOverride) => {
    const projectId = projectIdOverride || selectedProjectId
    if (!projectId || !documentId || monitorInFlightRef.current) return

    monitorInFlightRef.current = true
    try {
      const watchStart = Date.now()
      let parsingAlertShown = false
      let embeddingAlertShown = false

      for (let i = 0; i < 360; i += 1) {
        await wait(2500)
        const rows = (await api.get(`/documents/project/${projectId}`)).data.data || []
        const current = rows.find((d) => d._id === documentId)
        if (!current) continue

        setLatestDocumentStatus(current)

        if (current.status === 'processed') {
          setPlannerChat((prev) => [...prev, { role: 'assistant', text: `SRS ingestion completed for ${documentName || current.name}.` }])
          appendPlannerLog({
            kind: 'upload',
            step: 'srs_processed',
            title: 'SRS processing completed',
            summary: `${documentName || current.name} reached processed status.`,
            response: {
              documentId: current._id,
              name: current.name,
              status: current.status,
              ingestionStatus: current.ingestionStatus,
              requirementMap: current.requirementMap || null,
            },
          })
          toast.success('SRS embedding completed')
          qc.invalidateQueries({ queryKey: ['ai-planner-documents', projectId] })
          return
        }

        const elapsedMs = Date.now() - watchStart
        if (current.status === 'parsing' && elapsedMs > 60000 && !parsingAlertShown) {
          parsingAlertShown = true
          toast('SRS parsing is taking unusually long. This can happen with large files or heavy OCR. Please wait or re-upload a cleaner file.', {
            duration: 7000,
          })
        }

        if (current.status === 'embedding' && elapsedMs > 60000 && !embeddingAlertShown) {
          embeddingAlertShown = true
          toast('Embedding creation is taking longer than expected. This usually means large document chunking/vectorization is still running.', {
            duration: 7000,
          })
        }

        if (current.status === 'failed') {
          setPlannerChat((prev) => [...prev, { role: 'assistant', text: `SRS ingestion failed for ${documentName || current.name}.` }])
          const stage = current.ingestionStatus?.errorStage || 'unknown'
          const errorMessage = current.ingestionStatus?.errorMessage || 'SRS processing failed'
          appendPlannerLog({
            kind: 'error',
            level: 'error',
            step: 'srs_failed',
            title: 'SRS processing failed',
            summary: `${documentName || current.name} failed at ${stage}.`,
            response: {
              documentId: current._id,
              name: current.name,
              status: current.status,
              stage,
              errorMessage,
              ingestionStatus: current.ingestionStatus,
            },
          })
          toast.error(`SRS processing failed at ${stage}: ${errorMessage}`, { duration: 9000 })
          qc.invalidateQueries({ queryKey: ['ai-planner-documents', projectId] })
          return
        }
      }

      const latestRows = (await api.get(`/documents/project/${projectId}`)).data.data || []
      const latest = latestRows.find((d) => d._id === documentId)
      const status = latest?.status || 'unknown'
      const inProgress = ['uploaded', 'validating', 'parsing', 'embedding', 'processing']
      if (inProgress.includes(status)) {
        toast('SRS embedding is still running in background. Keep this page open and check again shortly.', {
          duration: 7000,
        })
      } else {
        toast.error(`SRS embedding timeout while status is '${status}'. Please retry upload or open document logs.`, {
          duration: 9000,
        })
      }
    } catch (error) {
      const detail = error?.response?.data?.message || error?.message || 'Failed while checking SRS processing status'
      toast.error(`SRS status polling failed: ${detail}`, { duration: 8000 })
    } finally {
      monitorInFlightRef.current = false
    }
  }

  const ensureSrsReadyForPlanning = () => {
    const status = latestDoc?.status
    if (!status) return true

    if (['uploaded', 'validating', 'parsing', 'embedding', 'uploading', 'processing'].includes(status)) {
      toast.error(`SRS is still ${status}. Wait for 'processed' before Suggest/Generate.`, { duration: 5000 })
      return false
    }

    if (status === 'failed') {
      const stage = latestDoc?.ingestionStatus?.errorStage || 'unknown'
      const message = latestDoc?.ingestionStatus?.errorMessage || 'SRS failed to process'
      toast.error(`SRS failed at ${stage}: ${message}`, { duration: 9000 })
      return false
    }

    return true
  }

  useEffect(() => {
    if (!documents.length) {
      setLatestDocumentStatus(null)
      return
    }

    if (plannerResetAt) {
      setLatestDocumentStatus(null)
      return
    }

    const topDoc = documents[0]
    setLatestDocumentStatus(topDoc)

    if ((topDoc.status === 'uploaded' || topDoc.status === 'embedding' || topDoc.status === 'processing') && !monitorInFlightRef.current) {
      monitorDocumentIngestion(topDoc._id, topDoc.name)
    }
  }, [documents, selectedProjectId, plannerResetAt])

  const uploadSrs = useMutation({
    onMutate: () => {
      if (srsFile) {
        setLatestDocumentStatus({ name: srsFile.name, status: 'uploading' })
        appendPlannerLog({
          kind: 'upload',
          step: 'upload_started',
          title: 'SRS upload started',
          summary: `Uploading ${srsFile.name} (${Math.max(1, Math.round(srsFile.size / 1024))} KB).`,
          request: {
            fileName: srsFile.name,
            fileSizeBytes: srsFile.size,
            fileType: srsFile.type,
          },
        })
      }
    },
    mutationFn: async () => {
      const resolvedProjectId = await resolveProjectId()

      if (!resolvedProjectId && !srsFile) {
        throw new Error('Choose an SRS file first')
      }
      if (!srsFile) {
        throw new Error('Choose an SRS file first')
      }
      if (!resolvedProjectId) {
        throw new Error('No workspace project available. Create or select a project, then try again.')
      }

      const formData = new FormData()
      formData.append('document', srsFile)
      const result = (await api.post(`/documents/upload/${resolvedProjectId}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })).data

      appendPlannerLog({
        kind: 'upload',
        step: 'upload_response',
        title: 'SRS upload API response',
        summary: 'Document created and background processing started.',
        response: {
          success: result?.success,
          data: result?.data || null,
        },
      })
      return { result, resolvedProjectId }
    },
    onSuccess: ({ result, resolvedProjectId }) => {
      qc.invalidateQueries({ queryKey: ['ai-planner-documents', resolvedProjectId] })
      const uploadedDoc = result?.data
      setPlannerResetAt(null)
      setLatestDocumentStatus(uploadedDoc || null)
      setLastSrsLabel(`${uploadedDoc?.name || 'document'} - ${uploadedDoc?.status || 'uploaded'}`)
      setPlannerChat((prev) => [...prev, { role: 'assistant', text: `SRS uploaded (${uploadedDoc?.name || 'document'}). Embedding started in background.` }])
      setSrsFile(null)
      toast.success('SRS uploaded. Embedding started.')
      appendPlannerLog({
        kind: 'upload',
        step: 'upload_success',
        title: 'SRS upload accepted',
        summary: `${uploadedDoc?.name || 'document'} uploaded; background embedding started.`,
        response: {
          documentId: uploadedDoc?._id || null,
          document: uploadedDoc || null,
        },
      })
      if (uploadedDoc?._id) {
        monitorDocumentIngestion(uploadedDoc._id, uploadedDoc.name, resolvedProjectId)
      }
    },
    onError: (error) => {
      appendPlannerLog({
        kind: 'error',
        level: 'error',
        step: 'upload_failed',
        title: 'SRS upload failed',
        summary: error?.message || 'Failed to upload SRS',
        response: error?.response?.data || null,
      })
      toast.error(error?.message || 'Failed to upload SRS')
    },
  })

  const generateRequirementMap = useMutation({
    mutationFn: async () => {
      const resolvedProjectId = await resolveProjectId()
      if (!resolvedProjectId) {
        throw new Error('No workspace project available. Create or select a project, then try again.')
      }
      appendPlannerLog({
        kind: 'map',
        step: 'map_request',
        title: 'Requirement map generation requested',
        summary: `Generating requirement map for project ${resolvedProjectId}.`,
        request: {
          projectId: resolvedProjectId,
        },
      })
      const response = await api.post(`/documents/project/${resolvedProjectId}/generate-map`, {}, {
        timeout: 0,
      })
      return { resolvedProjectId, result: response.data }
    },
    onSuccess: ({ resolvedProjectId, result }) => {
      const itemCount = result?.data?.requirementMap?.items?.length || 0
      toast.success(`Requirement map generated (${itemCount} items)`)
      setPlannerResetAt(null)
      setPlannerChat((prev) => [...prev, { role: 'assistant', text: `Requirement map generated with ${itemCount} entries.` }])
      appendPlannerLog({
        kind: 'map',
        step: 'map_response',
        title: 'Requirement map generated',
        summary: `Generated ${itemCount} requirement map items.`,
        response: {
          projectId: resolvedProjectId,
          requirementMap: result?.data?.requirementMap || null,
          extractionMeta: result?.data?.extractionMeta || null,
        },
      })
      qc.invalidateQueries({ queryKey: ['ai-planner-documents', resolvedProjectId] })
    },
    onError: (error) => {
      appendPlannerLog({
        kind: 'error',
        level: 'error',
        step: 'map_failed',
        title: 'Requirement map generation failed',
        summary: error?.response?.data?.message || error?.message || 'Failed to generate requirement map',
        response: error?.response?.data || null,
      })
      toast.error(error?.response?.data?.message || error?.message || 'Failed to generate requirement map')
    },
  })

  const uploadRequirementMap = useMutation({
    mutationFn: async () => {
      const resolvedProjectId = await resolveProjectId()
      if (!resolvedProjectId) {
        throw new Error('No workspace project available. Create or select a project, then try again.')
      }
      if (!mapFile) {
        throw new Error('Select a map JSON file first.')
      }

      const formData = new FormData()
      formData.append('map', mapFile)

      appendPlannerLog({
        kind: 'map',
        step: 'map_upload_request',
        title: 'Requirement map upload started',
        summary: `Uploading ${mapFile.name}.`,
        request: {
          fileName: mapFile.name,
          fileSizeBytes: mapFile.size,
        },
      })

      const response = await api.post(`/documents/project/${resolvedProjectId}/upload-map`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return { resolvedProjectId, result: response.data }
    },
    onSuccess: ({ resolvedProjectId, result }) => {
      const itemCount = result?.data?.requirementMap?.items?.length || 0
      toast.success(`Requirement map uploaded (${itemCount} items)`)
      setPlannerResetAt(null)
      setPlannerChat((prev) => [...prev, { role: 'assistant', text: `Requirement map uploaded from JSON with ${itemCount} entries.` }])
      setLatestDocumentStatus((prev) => (prev ? {
        ...prev,
        requirementMap: result?.data?.requirementMap || prev.requirementMap,
      } : prev))
      setMapFile(null)
      appendPlannerLog({
        kind: 'map',
        step: 'map_upload_response',
        title: 'Requirement map uploaded',
        summary: `Uploaded map with ${itemCount} items.`,
        response: {
          projectId: resolvedProjectId,
          requirementMap: result?.data?.requirementMap || null,
        },
      })
      qc.invalidateQueries({ queryKey: ['ai-planner-documents', resolvedProjectId] })
    },
    onError: (error) => {
      appendPlannerLog({
        kind: 'error',
        level: 'error',
        step: 'map_upload_failed',
        title: 'Requirement map upload failed',
        summary: error?.response?.data?.message || error?.message || 'Failed to upload requirement map',
        response: error?.response?.data || null,
      })
      toast.error(error?.response?.data?.message || error?.message || 'Failed to upload requirement map')
    },
  })

  const fetchSuggestions = useMutation({
    mutationFn: async () => {
      const resolvedProjectId = await resolveProjectId()
      if (!resolvedProjectId) throw new Error('No project available. Please create one first.')

      const inputText = planningPrompt.trim() || 'Suggest next planning prompts'
      const projectStateResponse = await api.get(`/stories/project-state/${resolvedProjectId}`)
      const projectState = projectStateResponse?.data?.data || {}

      const requestPayload = {
        projectId: resolvedProjectId,
        moduleName,
        userInput: inputText,
        projectState,
      }

      appLogger.info('AI Planner suggest request', {
        projectId: resolvedProjectId,
        moduleName,
        inputLength: inputText.length,
        projectStateKeys: Object.keys(projectState || {}).length,
      })

      appendPlannerLog({
        kind: 'request',
        step: 'suggest_request',
        title: 'Suggest request prepared',
        summary: `Sending project state and user instruction to /stories/suggest/${resolvedProjectId}.`,
        request: requestPayload,
        meta: {
          projectStateKeys: Object.keys(projectState || {}),
        },
      })

      const response = await api.post(`/stories/suggest/${resolvedProjectId}`, requestPayload, { timeout: 0 })
      return response.data.data || { paths: [] }
    },
    onSuccess: (data) => {
      const paths = Array.isArray(data?.paths) ? data.paths : []
      const planningWarnings = data?.planningMeta?.warnings || []
      const isLowConfidence = data?.planningMeta?.contextQuality === 'low'
      const nextSuggestContext = {
        discoveredRequirementIds: Array.isArray(data?.planningMeta?.discoveredRequirementIds)
          ? data.planningMeta.discoveredRequirementIds
          : [],
        fetchedChunks: Number(data?.planningMeta?.fetchedChunks || 0),
        fetchedChunkPreview: Array.isArray(data?.planningMeta?.fetchedChunkPreview)
          ? data.planningMeta.fetchedChunkPreview
          : [],
      }
      setPlanningPaths(paths)
      if (paths.length && selectedPlanningPaths.length === 0) {
        setSelectedPlanningPaths([paths[0]])
      }
      setSuggestContext(nextSuggestContext)
      const hasAny = paths.length > 0
      setSuggestionsOpen(hasAny)

      appLogger.info('AI Planner suggest response', {
        hasAny,
        paths: paths.length,
        message: data?.message || null,
        contextSummary: data?.contextSummary || null,
      })

      appendPlannerLog({
        kind: 'response',
        step: 'suggest_response',
        title: 'Suggest response received',
        summary: `Planning paths: ${paths.length}.`,
        response: {
          paths,
          suggestions: data?.suggestions || [],
          planningMeta: data?.planningMeta || null,
          meta: data?.meta || null,
          discoveryMeta: data?.discoveryMeta || null,
        },
      })

      if (!hasAny) {
        toast.error('No planning paths generated. Upload/process SRS or try a clearer prompt.')
      } else if (data?.message) {
        toast.success(data.message)
      }

      if (isLowConfidence) {
        toast('Suggestions generated with limited context (no processed SRS)', { icon: '⚠️' })
      }
      if (planningWarnings.length) {
        setPlannerChat((prev) => [
          ...prev,
          ...planningWarnings.map((warning) => ({ role: 'assistant', text: `Warning: ${warning}` })),
        ])
      }
    },
    onError: (error) => {
      appLogger.error('AI Planner suggest failed', {
        message: error?.response?.data?.message || error?.message,
        status: error?.response?.status,
        details: error?.response?.data || null,
      })
      appendPlannerLog({
        kind: 'error',
        level: 'error',
        step: 'suggest_failed',
        title: 'Suggest request failed',
        summary: error?.response?.data?.message || error?.message || 'Failed to fetch suggestions',
        response: error?.response?.data || null,
      })
      toast.error(error?.response?.data?.message || error?.message || 'Failed to fetch suggestions')
    },
  })

  const hasPlanningPaths = planningPaths.length > 0

  const togglePlanningPath = (path) => {
    setSelectedPlanningPaths((prev) => {
      const isSelected = prev.some((p) => p.id === path.id)
      const next = isSelected
        ? prev.filter((p) => p.id !== path.id)
        : [...prev, path]
      appendPlannerLog({
        kind: 'system',
        step: 'planning_path_toggled',
        title: isSelected ? 'Planning path deselected' : 'Planning path selected',
        summary: `${next.length} path(s) selected: ${next.map((p) => p.name || p.id).join(', ')}`,
        response: next,
      })
      return next
    })
  }

  const buildCombinedPlanningContext = () => {
    const chatContext = plannerChat
      .filter((m) => m.role === 'user')
      .map((m) => m.text)
      .join('\n')

    const selectedPathsJson = JSON.stringify(currentSelectedPaths, null, 2)
    const selectedRequirementContext = JSON.stringify(currentSelectedRequirements, null, 2)
    const selectedChunkRefs = currentSelectedChunkRefs
    const selectedSectionRefs = currentSelectedSectionRefs
    const structuredPlannerContext = JSON.stringify({
      planningPrompt,
      selectedSuggestionChips,
      planningPaths,
      selectedPlanningPaths: currentSelectedPaths,
      selectedRequirements: selectedRequirementContext,
      selectedChunkRefs,
      selectedSectionRefs,
      backlogDraft,
      latestDocumentStatus,
      lastSrsLabel,
    }, null, 2)

    return [
      chatContext,
      planningPrompt && `Planning Prompt:\n${planningPrompt}`,
      `Selected Paths JSON:\n${selectedPathsJson}`,
      `Selected Requirements JSON:\n${selectedRequirementContext}`,
      `Selected Chunk Refs JSON:\n${JSON.stringify(selectedChunkRefs, null, 2)}`,
      `Selected Section Refs JSON:\n${JSON.stringify(selectedSectionRefs, null, 2)}`,
      `Current Planner Context JSON:\n${structuredPlannerContext}`,
    ].filter(Boolean).join('\n\n')
  }

  const currentSelectedPaths = selectedPlanningPaths.length > 0 ? selectedPlanningPaths : (planningPaths.length > 0 ? [planningPaths[0]] : [])
  const currentRequirementGraphItems = Array.isArray(latestDocumentStatus?.requirementGraph?.items)
    ? latestDocumentStatus.requirementGraph.items
    : []
  // Aggregate requirements from all selected paths
  const currentSelectedRequirements = currentSelectedPaths
    .flatMap((path) => Array.isArray(path?.requirements) ? path.requirements : [])
    .filter((v, i, a) => a.indexOf(v) === i) // dedup
    .map((reqId) => {
      const graphItem = currentRequirementGraphItems.find((item) => String(item?.requirement_id || '').toUpperCase() === String(reqId || '').toUpperCase())
      return {
        requirement_id: reqId,
        planning_path_id: currentSelectedPaths.find((path) => Array.isArray(path?.requirements) && path.requirements.some((value) => String(value || '').toUpperCase() === String(reqId || '').toUpperCase()))?.id || '',
        title: graphItem?.title || reqId,
        module: graphItem?.module || '',
        type: graphItem?.type || '',
        dependencies: Array.isArray(graphItem?.dependencies) ? graphItem.dependencies : [],
        chunk_refs: Array.isArray(graphItem?.chunk_refs) ? graphItem.chunk_refs : [],
        section_refs: Array.isArray(graphItem?.section_refs) ? graphItem.section_refs : [],
      }
    })
  // Aggregate chunk and section refs from all selected paths and their requirements
  const currentSelectedChunkRefs = [
    ...currentSelectedPaths.flatMap((path) => Array.isArray(path?.chunk_refs) ? path.chunk_refs : []),
    ...currentSelectedRequirements.flatMap((item) => Array.isArray(item.chunk_refs) ? item.chunk_refs : []),
  ].filter((value, index, array) => array.indexOf(value) === index)

  const currentSelectedSectionRefs = [
    ...currentSelectedPaths.flatMap((path) => Array.isArray(path?.section_refs) ? path.section_refs : []),
    ...currentSelectedRequirements.flatMap((item) => Array.isArray(item.section_refs) ? item.section_refs : []),
  ].filter((value, index, array) => array.indexOf(value) === index)

  const previewBacklogPrompt = useMutation({
    mutationFn: async () => {
      const resolvedProjectId = await resolveProjectId()
      if (!resolvedProjectId) throw new Error('No project available. Please create one first.')

      const combinedContext = buildCombinedPlanningContext()
      appendPlannerLog({
        kind: 'prompt',
        step: 'preview_request',
        title: 'Backlog prompt preview requested',
        summary: `Preparing exact backlog prompt preview for project ${resolvedProjectId}.`,
        request: {
          moduleName,
          additionalContext: combinedContext,
          suggestContext,
          selectedPlanningPaths: currentSelectedPaths,
          selectedRequirements: currentSelectedRequirements,
          chunkRefs: currentSelectedChunkRefs,
          sectionRefs: currentSelectedSectionRefs,
        },
      })

      const response = await api.post(`/stories/generate-preview/${resolvedProjectId}`, {
        moduleName,
        additionalContext: combinedContext,
        suggestContext,
        selectedPlanningPaths: currentSelectedPaths,
        selectedRequirements: currentSelectedRequirements,
        chunkRefs: currentSelectedChunkRefs,
        sectionRefs: currentSelectedSectionRefs,
      }, {
        timeout: 0,
      })
      return { data: response.data.data, resolvedProjectId }
    },
    onSuccess: ({ data }) => {
      setPromptPreview(data?.promptPreview || '')
      const previewLength = String(data?.promptPreview || '').length
      setPlannerChat((prev) => [...prev, { role: 'assistant', text: `Backlog prompt preview ready (${previewLength} characters).` }])
      appendPlannerLog({
        kind: 'prompt',
        step: 'preview_response',
        title: 'Backlog prompt preview received',
        summary: `Exact prompt payload returned (${previewLength} characters).`,
        response: {
          promptPreview: data?.promptPreview || '',
          planningMeta: data?.planningMeta || null,
        },
      })
      toast.success('Prompt preview loaded')
    },
    onError: (error) => {
      appendPlannerLog({
        kind: 'error',
        level: 'error',
        step: 'preview_failed',
        title: 'Backlog prompt preview failed',
        summary: error?.message || 'Failed to load prompt preview',
        response: error?.response?.data || null,
      })
      toast.error(error?.message || 'Failed to load prompt preview')
    },
  })

  const generateBacklog = useMutation({
    mutationFn: async () => {
      const resolvedProjectId = await resolveProjectId()
      if (!resolvedProjectId) throw new Error('No project available. Please create one first.')
      const combinedContext = buildCombinedPlanningContext()
      appLogger.info('AI Planner generate backlog start', {
        projectId: resolvedProjectId,
        moduleName,
        selectedPathCount: currentSelectedPaths.length,
        selectedRequirementCount: currentSelectedRequirements.length,
        chunkRefCount: currentSelectedChunkRefs.length,
        sectionRefCount: currentSelectedSectionRefs.length,
        selectedPaths: currentSelectedPaths.map((path, index) => ({
          index,
          id: path?.id,
          name: path?.name,
          requirementCount: Array.isArray(path?.requirements) ? path.requirements.length : 0,
        })),
      })

      appendPlannerLog({
        kind: 'request',
        step: 'generate_preview_before_backlog',
        title: 'Preparing final backlog generation',
        summary: 'Fetching exact prompt preview before calling backlog generation.',
        request: {
          moduleName,
          additionalContext: combinedContext,
          suggestContext,
          selectedPlanningPaths: currentSelectedPaths,
          selectedRequirements: currentSelectedRequirements,
          chunkRefs: currentSelectedChunkRefs,
          sectionRefs: currentSelectedSectionRefs,
        },
      })

      let promptPreviewText = ''
      try {
        const previewResponse = await api.post(`/stories/generate-preview/${resolvedProjectId}`, {
          moduleName,
          additionalContext: combinedContext,
          suggestContext,
          selectedPlanningPaths: currentSelectedPaths,
          selectedRequirements: currentSelectedRequirements,
          chunkRefs: currentSelectedChunkRefs,
          sectionRefs: currentSelectedSectionRefs,
        }, {
          timeout: 0,
        })

        promptPreviewText = previewResponse?.data?.data?.promptPreview || ''
        appendPlannerLog({
          kind: 'prompt',
          step: 'generate_prompt_preview',
          title: 'Exact backlog prompt captured',
          summary: `Prompt preview captured (${String(promptPreviewText || '').length} characters).`,
          response: {
            promptPreview: promptPreviewText,
            planningMeta: previewResponse?.data?.data?.planningMeta || null,
          },
        })
      } catch (previewError) {
        appendPlannerLog({
          kind: 'error',
          level: 'error',
          step: 'generate_prompt_preview_failed',
          title: 'Prompt preview capture failed',
          summary: previewError?.response?.data?.message || previewError?.message || 'Prompt preview request failed',
          response: previewError?.response?.data || null,
        })
      }

      const response = await api.post(`/stories/generate/${resolvedProjectId}`, {
        moduleName,
        additionalContext: combinedContext,
        suggestContext,
        selectedPlanningPaths: currentSelectedPaths,
        selectedRequirements: currentSelectedRequirements,
        chunkRefs: currentSelectedChunkRefs,
        sectionRefs: currentSelectedSectionRefs,
      }, {
        timeout: 0,
      })
      appLogger.info('AI Planner generate backlog response', {
        projectId: resolvedProjectId,
        epics: response.data?.data?.epics?.length || 0,
        stories: response.data?.data?.stories?.length || 0,
        tasks: response.data?.data?.tasks?.length || 0,
        subtasks: response.data?.data?.subtasks?.length || 0,
      })
      return { data: response.data.data, resolvedProjectId, promptPreviewText }
    },
    onSuccess: ({ data, resolvedProjectId, promptPreviewText }) => {
      const normalized = normalizeDraftWithTeam(data || DEFAULT_BACKLOG_DRAFT)

      // Set backlog draft state BEFORE switching tabs
      setBacklogDraft(normalized)
      qc.invalidateQueries({ queryKey: ['ai-planner-backlog-history', resolvedProjectId] })

      const planningWarnings = data?.planningMeta?.warnings || []
      const isLowConfidence = data?.planningMeta?.contextQuality === 'low'

      appendPlannerLog({
        kind: 'response',
        step: 'generate_response',
        title: 'Final backlog generation response',
        summary: `Received ${normalized.epics.length} epics, ${normalized.stories.length} stories, ${normalized.tasks.length} tasks, ${normalized.subtasks.length} subtasks.`,
        prompt: promptPreviewText || promptPreview || '',
        response: {
          selectedPlanningPaths: currentSelectedPaths || [],
          selectedRequirements: currentSelectedRequirements,
          chunkRefs: currentSelectedChunkRefs,
          sectionRefs: currentSelectedSectionRefs,
          backlog: data || null,
          meta: data?.meta || null,
          planningMeta: data?.planningMeta || null,
          normalizedBacklog: normalized,
        },
      })

      setPlannerChat((prev) => {
        const next = [...prev, { role: 'assistant', text: `Backlog generated with ${normalized.epics.length} epics, ${normalized.stories.length} stories, ${normalized.tasks.length} tasks. It was saved to backlog history; review on Backlog tab, then save to DB or push to Jira.` }]
        planningWarnings.forEach((warning) => {
          next.push({ role: 'assistant', text: `Warning: ${warning}` })
        })
        return next
      })

      if (isLowConfidence) {
        toast('Generated with limited context (no processed SRS)', { icon: '⚠️' })
      }
      toast.success('Backlog generated successfully')
      
      // Auto-switch to backlog tab so user sees the generated content
      setAiPlannerTab('backlog')
    },
    onError: (error) => {
      appendPlannerLog({
        kind: 'error',
        level: 'error',
        step: 'generate_failed',
        title: 'Backlog generation failed',
        summary: error?.message || 'Failed to generate backlog',
        response: error?.response?.data || null,
      })
      toast.error(error?.message || 'Failed to generate backlog')
    },
  })

  const llmActionLocked = fetchSuggestions.isPending || generateBacklog.isPending || generateRequirementMap.isPending
    || previewBacklogPrompt.isPending

  const buildSelectedBacklogPayload = () => {
    const hasEpics = (backlogDraft.epics || []).length > 0
    const hasStories = (backlogDraft.stories || []).length > 0
    const hasTasks = (backlogDraft.tasks || []).length > 0

    if (!hasEpics || !hasStories || !hasTasks) {
      throw new Error('Backlog must have epics, stories, and tasks. Generate a backlog first.')
    }

    const selectedEpics = (backlogDraft.epics || []).filter((e) => e.selected !== false)
    if (selectedEpics.length < 1) {
      throw new Error('Select at least one epic')
    }

    const selectedEpicTempIds = new Set(selectedEpics.map((e) => e.tempId))
    const selectedStories = (backlogDraft.stories || []).filter((s) =>
      s.selected !== false && selectedEpicTempIds.has(s.epicTempId)
    )
    const selectedStoryTempIds = new Set(selectedStories.map((s) => s.tempId))
    const selectedTasks = (backlogDraft.tasks || []).filter((t) =>
      t.selected !== false && selectedEpicTempIds.has(t.epicTempId)
    )
    const selectedSubtasks = (backlogDraft.subtasks || []).filter((st) =>
      st.selected !== false && selectedEpicTempIds.has(st.epicTempId) && (
        selectedStoryTempIds.has(st.parentTempId) || selectedTasks.some((task) => task.tempId === st.parentTempId)
      )
    )

    if (!selectedEpics.length && !selectedStories.length && !selectedTasks.length && !selectedSubtasks.length) {
      throw new Error('Select at least one generated item')
    }

    const validationErrors = validateBacklogItems({
      epics: selectedEpics,
      stories: selectedStories,
      tasks: selectedTasks,
      subtasks: selectedSubtasks,
    })
    if (validationErrors.length > 0) {
      const error = new Error(`Please fix the following issues:\n${validationErrors.join('\n')}`)
      error.validationErrors = validationErrors
      throw error
    }

    return {
      epics: selectedEpics,
      stories: selectedStories,
      tasks: selectedTasks,
      subtasks: selectedSubtasks,
    }
  }

  const saveBacklogToDb = useMutation({
    mutationFn: async () => {
      const resolvedProjectId = await resolveProjectId()
      if (!resolvedProjectId) {
        throw new Error('No workspace project available. Create or select a project, then try again.')
      }

      const selectedPayload = buildSelectedBacklogPayload()

      appendPlannerLog({
        kind: 'request',
        step: 'save_backlog_request',
        title: 'Save backlog requested',
        summary: 'Submitting selected backlog draft to local database.',
        request: {
          ...selectedPayload,
        },
      })

      const saveResponse = await api.post(`/stories/save/${resolvedProjectId}`, selectedPayload)
      const saved = saveResponse?.data?.data || {}
      qc.invalidateQueries({ queryKey: ['workspace-stories', resolvedProjectId] })
      qc.invalidateQueries({ queryKey: ['workspace-epics', resolvedProjectId] })

      appendPlannerLog({
        kind: 'response',
        step: 'save_backlog_response',
        title: 'Backlog saved to database',
        summary: 'Selected backlog persisted locally.',
        response: saved,
      })

      return { resolvedProjectId, saved }
    },
    onSuccess: ({ saved }) => {
      const total = (saved.epics?.length || 0) + (saved.stories?.length || 0) + (saved.tasks?.length || 0) + (saved.subtasks?.length || 0)
      toast.success(`Backlog saved to DB (${total} items)`)
      setPlannerChat((prev) => [...prev, { role: 'assistant', text: `Backlog saved to database with ${total} items.` }])
    },
    onError: (error) => {
      if (error?.validationErrors) {
        toast.error(`Validation failed:\n${error.validationErrors.join('\n')}`, { duration: 5000 })
        appLogger.error('Backlog validation errors:', error.validationErrors)
        return
      }
      const validationErrors = error?.response?.data?.errors
      if (validationErrors && Array.isArray(validationErrors)) {
        toast.error(`Validation failed:\n${validationErrors.join('\n')}`, { duration: 5000 })
        appLogger.error('Backlog validation errors:', validationErrors)
        return
      }
      toast.error(error?.message || 'Failed to save backlog', { duration: 4000 })
    },
  })

  const confirmAndPush = useMutation({
    mutationFn: async () => {
      const resolvedProjectId = await resolveProjectId()
      if (!resolvedProjectId) {
        throw new Error('No workspace project available. Create or select a project, then try again.')
      }

      const latest = latestDocumentStatus || documents[0] || null
      const hasProcessedSrs = latest?.status === 'processed'
      if (!hasProcessedSrs) {
        const proceed = window.confirm(
          'Latest SRS is not processed. Push will continue with low-confidence backlog context. Do you want to proceed?'
        )
        if (!proceed) {
          throw new Error('Push cancelled. Process SRS first or confirm low-confidence push.')
        }
      }

      const jiraKey = selectedJiraProjectKey || project?.jiraProjectKey
      if (!jiraKey) {
        throw new Error('Select Jira project in sidebar first')
      }

      const selectedPayload = buildSelectedBacklogPayload()

      appendPlannerLog({
        kind: 'request',
        step: 'save_push_request',
        title: 'Save and push requested',
        summary: 'Submitting selected backlog draft to save and Jira push.',
        request: {
          ...selectedPayload,
          jiraKey,
        },
      })

      const saveResponse = await api.post(`/stories/save/${resolvedProjectId}`, selectedPayload)
      const saved = saveResponse?.data?.data || {}

      const epicIds = saved.epicIds || (saved.epics || []).map((e) => e._id)
      const storyIds = saved.storyIds || [
        ...(saved.stories || []).map((s) => s._id),
        ...(saved.tasks || []).map((s) => s._id),
        ...(saved.subtasks || []).map((s) => s._id),
      ]

      await api.post(`/jira/connect/${resolvedProjectId}`, { jiraProjectKey: jiraKey })

      await api.post(`/jira/push/${resolvedProjectId}`, {
        epicIds,
        storyIds,
      })

      appendPlannerLog({
        kind: 'response',
        step: 'save_push_response',
        title: 'Backlog saved and pushed',
        summary: 'Backlog persisted and synced to Jira.',
        response: {
          epicCount: epicIds.length,
          storyCount: storyIds.length,
          jiraProjectKey: jiraKey,
        },
      })
    },
    onSuccess: () => {
      toast.success('Backlog saved and pushed to Jira')
      setPlannerChat((prev) => [...prev, { role: 'assistant', text: 'Confirmed and pushed to Jira. Backlog is now synced.' }])
      setBacklogDraft(DEFAULT_BACKLOG_DRAFT)
      setAiPlannerTab('planner')
    },
    onError: (error) => {
      // Check for client-side validation errors
      if (error?.validationErrors) {
        const errorList = error.validationErrors.join('\n')
        toast.error(`Validation failed:\n${errorList}`, { duration: 5000 })
        appLogger.error('Backlog validation errors:', error.validationErrors)
      } else {
        // Check for server-side validation errors
        const validationErrors = error?.response?.data?.errors
        if (validationErrors && Array.isArray(validationErrors)) {
          const errorList = validationErrors.join('\n')
          toast.error(`Validation failed:\n${errorList}`, { duration: 5000 })
          appLogger.error('Backlog validation errors:', validationErrors)
        } else {
          toast.error(error?.message || 'Failed to confirm and push', { duration: 4000 })
        }
      }
    },
  })

  const updateByTempId = (collection, tempId, field, value) => {
    setBacklogDraft((prev) => ({
      ...prev,
      [collection]: prev[collection].map((item) => item.tempId === tempId ? { ...item, [field]: value } : item),
    }))
  }

  const toggleSelected = (collection, tempId, checked) => {
    updateByTempId(collection, tempId, 'selected', checked)
  }

  const removeByTempId = (collection, tempId) => {
    setBacklogDraft((prev) => {
      const next = { ...prev }

      if (collection === 'epics') {
        next.epics = prev.epics.filter((e) => e.tempId !== tempId)
        const removedStoryTempIds = [
          ...prev.stories.filter((s) => s.epicTempId === tempId).map((s) => s.tempId),
          ...prev.tasks.filter((t) => t.epicTempId === tempId).map((t) => t.tempId),
        ]
        next.stories = prev.stories.filter((s) => s.epicTempId !== tempId)
        next.tasks = prev.tasks.filter((t) => t.epicTempId !== tempId)
        next.subtasks = prev.subtasks.filter((st) => !removedStoryTempIds.includes(st.parentTempId))
        return next
      }

      if (collection === 'stories' || collection === 'tasks') {
        next[collection] = prev[collection].filter((row) => row.tempId !== tempId)
        next.subtasks = prev.subtasks.filter((st) => st.parentTempId !== tempId)
        return next
      }

      next[collection] = prev[collection].filter((row) => row.tempId !== tempId)
      return next
    })
  }

  const removeSuggestionChip = (value) => {
    setSelectedSuggestionChips((prev) => prev.filter((item) => item !== value))
  }

  const addSuggestionChip = (value) => {
    if (!value || selectedSuggestionChips.includes(value)) return
    setSelectedSuggestionChips((prev) => [...prev, value])
  }

  const latestDoc = plannerResetAt ? null : (latestDocumentStatus || documents[0] || null)
  const hasRequirementMap = useMemo(() => Boolean(latestDoc?.requirementMap?.items?.length), [latestDoc])

  const getCollectionFromType = (type) => {
    if (type === 'epic') return 'epics'
    if (type === 'story') return 'stories'
    if (type === 'task') return 'tasks'
    return 'subtasks'
  }

  const createBacklogItem = (type, parentTempId = '') => {
    const base = {
      tempId: makeId(type),
      type,
      title: `New ${type}`,
      description: '',
      priority: 'medium',
      assignee: '',
      sprint: 'backlog',
      storyPoints: 0,
      selected: true,
    }

    if (type === 'story') {
      return { ...base, epicTempId: parentTempId }
    }
    if (type === 'task') {
      const parentEpic = backlogDraft.epics.find((e) => e.tempId === parentTempId)
      const parentStory = backlogDraft.stories.find((s) => s.tempId === parentTempId)
      const parentTask = backlogDraft.tasks.find((t) => t.tempId === parentTempId)
      return {
        ...base,
        epicTempId: parentEpic?.tempId || parentStory?.epicTempId || parentTask?.epicTempId || parentTempId || '',
      }
    }
    if (type === 'subtask') {
      const parentEpic = backlogDraft.epics.find((e) => e.tempId === parentTempId)
      const parentTask = backlogDraft.tasks.find((t) => t.tempId === parentTempId)
      const parentStory = backlogDraft.stories.find((s) => s.tempId === parentTempId)
      return {
        ...base,
        parentTempId,
        epicTempId: parentEpic?.tempId || parentTask?.epicTempId || parentStory?.epicTempId || '',
      }
    }
    return base
  }

  const addBacklogItem = (type, parentTempId = '') => {
    const collection = getCollectionFromType(type)
    const item = createBacklogItem(type, parentTempId)
    setBacklogDraft((prev) => ({
      ...prev,
      [collection]: [...(prev[collection] || []), item],
    }))
    setSelectedItem({ type, tempId: item.tempId })
  }

  const useBacklogHistoryEntry = (entry) => {
    const normalized = normalizeDraftWithTeam(normalizeBacklogDraft(entry?.payload || {}))
    setBacklogDraft(normalized)
    setSelectedItem(normalized.epics[0] ? { type: 'epic', tempId: normalized.epics[0].tempId } : null)
    setAiPlannerTab('backlog')
    setPlannerChat((prev) => [...prev, { role: 'assistant', text: `Loaded backlog history: ${entry?.title || 'generated backlog'}.` }])
    toast.success('Backlog history loaded')
  }

  const selectedBacklogItem = useMemo(() => {
    if (!selectedItem) return null
    const collection = getCollectionFromType(selectedItem.type)
    return (backlogDraft[collection] || []).find((row) => row.tempId === selectedItem.tempId) || null
  }, [selectedItem, backlogDraft])

  const storiesByEpic = useMemo(() => {
    const map = new Map()
    
    const stories = Array.isArray(backlogDraft?.stories) ? backlogDraft.stories : []

    stories.forEach((story) => {
      const key = story.epicTempId || 'ungrouped'
      const arr = map.get(key) || []
      arr.push(story)
      map.set(key, arr)
    })

    return map
  }, [backlogDraft?.stories, backlogDraft?.tasks])

  const tasksByEpic = useMemo(() => {
    const map = new Map()
    const tasks = Array.isArray(backlogDraft?.tasks) ? backlogDraft.tasks : []

    tasks.forEach((task) => {
      const key = task.epicTempId || 'ungrouped'
      const rows = map.get(key) || []
      rows.push(task)
      map.set(key, rows)
    })

    return map
  }, [backlogDraft?.tasks])

  const subtasksByParent = useMemo(() => {
    const map = new Map()
    const subtasks = Array.isArray(backlogDraft?.subtasks) ? backlogDraft.subtasks : []

    subtasks.forEach((subtask) => {
      const key = subtask.parentTempId || 'ungrouped'
      const rows = map.get(key) || []
      rows.push(subtask)
      map.set(key, rows)
    })

    return map
  }, [backlogDraft?.subtasks])

  const srsStatusLabel = latestDoc
    ? `${latestDoc.name} - ${latestDoc.status}`
    : lastSrsLabel || (srsFile
      ? `${srsFile.name} - ready to upload`
      : 'Not uploaded')

  const getTimelineTone = (msg) => {
    const text = String(msg?.text || '').toLowerCase()
    const isError = /(failed|error|timeout|warning|warn|cancelled|rejected|invalid)/.test(text)

    if (isError) {
      return {
        line: '#ef4444',
        text: '#fca5a5',
        glow: 'rgba(239, 68, 68, 0.28)',
      }
    }

    if (msg?.role === 'user') {
      return {
        line: '#22c55e',
        text: '#86efac',
        glow: 'rgba(34, 197, 94, 0.2)',
      }
    }

    return {
      line: '#22c55e',
      text: '#4ade80',
      glow: 'rgba(34, 197, 94, 0.25)',
    }
  }

  return (
    <div className="p-5 max-w-[1250px] mx-auto">
      <h1 className="text-[40px] font-bold leading-none mb-4" style={{ color: 'var(--text-primary)' }}>AI Planner</h1>

      <div className="flex items-center gap-2 mb-3">
        <button
          className={plannerTabButtonClass(aiPlannerTab === 'planner')}
          onClick={() => setAiPlannerTab('planner')}
        >
          Planner
        </button>
        <button
          className={plannerTabButtonClass(aiPlannerTab === 'backlog')}
          onClick={() => setAiPlannerTab('backlog')}
        >
          Backlog
        </button>
      </div>

      {aiPlannerTab === 'planner' ? (
        <div className="grid lg:grid-cols-[1.08fr_0.92fr] gap-3">
          <div className="card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[30px] font-bold">SRS Ingestion</h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Upload - Process - Suggest - Generate</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-[12px] font-bold border ${latestDoc?.status === 'processed' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' : 'bg-amber-500/15 text-amber-300 border-amber-400/30'}`}>
                  {(latestDoc?.status || 'not uploaded').toUpperCase()}
                </span>
                <button
                  type="button"
                  className="btn-secondary btn-sm inline-flex items-center gap-2"
                  onClick={resetPlannerWorkspace}
                  title="Reset AI Planner"
                  aria-label="Reset AI Planner"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
                    <path
                      d="M4 12a8 8 0 1 1 2.34 5.66"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M4 7v5h5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Reset
                </button>
              </div>
            </div>

            <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>Current SRS: {srsStatusLabel}</p>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Requirement map:{' '}
              <span className={`ml-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${hasRequirementMap ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' : 'bg-slate-500/15 text-slate-300 border-slate-400/30'}`}>
                {hasRequirementMap ? 'MAP TICK' : 'MAP NOT'}
              </span>
            </p>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <input
                ref={filePickerRef}
                type="file"
                accept=".pdf,.doc,.docx,.txt,.md"
                className="hidden"
                onChange={handleSrsFileChange}
              />
              <input
                ref={mapPickerRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleMapFileChange}
              />
              <button className="btn-secondary" onClick={() => filePickerRef.current?.click()}>Upload SRS</button>
              <button className="btn-primary" onClick={() => uploadSrs.mutate()} disabled={!srsFile || uploadSrs.isPending}>
                {uploadSrs.isPending ? 'Uploading...' : 'Process SRS'}
              </button>
              <button className="btn-secondary" onClick={() => generateRequirementMap.mutate()} disabled={llmActionLocked}>
                {generateRequirementMap.isPending
                  ? 'Generating Map...'
                  : 'Create Requirement Map'}
              </button>
              <button className="btn-secondary" onClick={() => mapPickerRef.current?.click()}>
                Select Map .json
              </button>
              <button className="btn-secondary" onClick={() => uploadRequirementMap.mutate()} disabled={!mapFile || uploadRequirementMap.isPending}>
                {uploadRequirementMap.isPending ? 'Uploading Map...' : 'Upload Map'}
              </button>
            </div>

            <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>Selected file: {selectedFileSummary}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Map file: {selectedMapFileSummary}</p>

            <div className="mt-3">
              <label className="block text-sm font-semibold mb-1">Planning Prompt</label>
              <textarea
                className="input min-h-[110px]"
                value={planningPrompt}
                onChange={(e) => setPlanningPrompt(e.target.value)}
                placeholder="Describe planning direction"
              />
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              <button
                className="btn-primary"
                onClick={() => {
                  if (!ensureSrsReadyForPlanning()) return
                  if (planningPrompt.trim()) {
                    setPlannerChat((prev) => [...prev, { role: 'user', text: planningPrompt.trim() }])
                  }
                  fetchSuggestions.mutate()
                }}
                disabled={llmActionLocked}
              >
                {fetchSuggestions.isPending
                  ? 'Suggesting...'
                  : 'Suggest'}
              </button>
              <button
                className="btn-secondary"
                onClick={() => {
                  if (!ensureSrsReadyForPlanning()) return
                  previewBacklogPrompt.mutate()
                }}
                disabled={llmActionLocked}
              >
                {previewBacklogPrompt.isPending
                  ? 'Loading Prompt...'
                  : 'Preview Backlog Prompt'}
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  if (!ensureSrsReadyForPlanning()) return
                  generateBacklog.mutate()
                }}
                disabled={llmActionLocked}
              >
                {generateBacklog.isPending
                  ? 'Generating...'
                  : 'Generate Backlog'}
              </button>
            </div>
          </div>

          <div className="card p-4">
            <h3 className="text-[30px] font-bold">Planning Paths</h3>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Suggest now returns navigation paths. Select multiple paths to generate a complete backlog that combines all selected requirements.</p>

            <div className="mt-3 space-y-2">
              {planningPaths.map((path) => {
                const isSelected = selectedPlanningPaths.some((p) => p.id === path.id)
                return (
                  <button
                    key={path.id}
                    className="w-full text-left rounded-xl border px-3 py-3 transition-colors"
                    style={{
                      borderColor: isSelected ? 'rgba(96,165,250,0.8)' : 'var(--border-input)',
                      background: isSelected ? 'rgba(30,41,59,0.88)' : 'var(--bg-input)',
                    }}
                    onClick={() => togglePlanningPath(path)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => togglePlanningPath(path)}
                          className="w-4 h-4 rounded"
                          style={{
                            accentColor: '#60a5fa',
                          }}
                        />
                        <div>
                          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{path.name || path.id}</p>
                          <p className="text-[11px] uppercase tracking-wide mt-1" style={{ color: 'var(--text-muted)' }}>
                            {path.priority || 'medium'} priority
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] px-2 py-1 rounded-full border" style={{ borderColor: isSelected ? '#38bdf8' : 'rgba(148,163,184,0.35)', color: isSelected ? '#7dd3fc' : '#94a3b8' }}>
                        {path.requirements?.length || 0} reqs
                      </span>
                    </div>
                    <p className="text-xs mt-2" style={{ color: 'var(--text-secondary)' }}>{path.reason || 'No reason provided.'}</p>
                    {path.dependency_notes && (
                      <p className="text-[11px] mt-2" style={{ color: '#fca5a5' }}>Dependencies: {path.dependency_notes}</p>
                    )}
                    {Array.isArray(path.requirements) && path.requirements.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {path.requirements.map((reqId) => (
                          <span key={`${path.id}-${reqId}`} className="text-[11px] px-2 py-0.5 rounded-full border" style={{ borderColor: 'rgba(99,102,241,0.35)', color: '#c7d2fe', background: 'rgba(99,102,241,0.16)' }}>
                            {reqId}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                )
              })}
              {!hasPlanningPaths && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Click Suggest to generate planning paths.</p>}
              {selectedPlanningPaths.length > 0 && (
                <p className="text-[12px] mt-3 px-3 py-2 rounded-lg" style={{ color: '#fde68a', background: 'rgba(245,158,11,0.15)', borderLeft: '2px solid #f59e0b' }}>
                  ✓ {selectedPlanningPaths.length} path(s) selected • {currentSelectedRequirements.length} requirement(s) • Generate will combine all
                </p>
              )}
            </div>

            {currentSelectedPaths.length > 0 && currentSelectedPaths[0] && (
              <div className="mt-3 rounded-md border px-3 py-2" style={{ borderColor: 'var(--border-input)', background: 'var(--bg-input)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Selected Paths ({currentSelectedPaths.length})</p>
                <div className="mt-2 space-y-2">
                  {currentSelectedPaths.map((path) => (
                    <div key={path.id} className="text-sm">
                      <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{path.name || path.id}</p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{path.reason || 'No reason provided.'}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {planningPaths.length === 0 && selectedPlanningPaths.length === 0 && (
              <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>No planning paths loaded yet.</p>
            )}

            <div className="mt-3">
              <p className="text-sm font-semibold">Selected Suggestion Chips</p>
              {!selectedSuggestionChips.length ? (
                <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>No chips selected.</p>
              ) : (
                <div className="flex flex-wrap gap-2 mt-2">
                  {selectedSuggestionChips.map((chip) => (
                    <button key={chip} className="px-2 py-1 text-xs rounded-full border" style={{ borderColor: 'rgba(99,102,241,0.35)', color: '#c7d2fe', background: 'rgba(99,102,241,0.18)' }} onClick={() => removeSuggestionChip(chip)}>
                      {chip} x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {(suggestContext.discoveredRequirementIds.length > 0 || suggestContext.fetchedChunks > 0) && (
              <div className="mt-3 rounded-md border px-3 py-2" style={{ borderColor: 'var(--border-input)', background: 'var(--bg-input)' }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Selected Retrieval Context</p>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => copyText(
                      [
                        `Requirement IDs: ${suggestContext.discoveredRequirementIds.length ? suggestContext.discoveredRequirementIds.join(', ') : 'none'}`,
                        `Fetched chunks: ${suggestContext.fetchedChunks || 0}`,
                        ...(suggestContext.fetchedChunkPreview || []).map((chunk, index) => `Chunk ${index + 1}: ${chunk}`),
                      ].join('\n'),
                      'retrieval context',
                    )}
                  >
                    Copy All
                  </button>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Requirement IDs: {suggestContext.discoveredRequirementIds.length ? suggestContext.discoveredRequirementIds.join(', ') : 'none'}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Fetched chunks: {suggestContext.fetchedChunks || 0}
                </p>
                {suggestContext.fetchedChunkPreview?.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {suggestContext.fetchedChunkPreview.map((chunk, index) => (
                      <div key={`${index}-${String(chunk || '').slice(0, 16)}`} className="rounded-md border px-2 py-2" style={{ borderColor: 'rgba(148,163,184,0.22)', background: 'rgba(15,23,42,0.6)' }}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Chunk {index + 1}</p>
                          <button className="btn-secondary btn-sm" onClick={() => copyText(chunk, `chunk ${index + 1}`)}>Copy</button>
                        </div>
                        <p className="text-xs mt-1 break-words" style={{ color: 'var(--text-secondary)' }}>{chunk}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>No chunk preview returned yet.</p>
                )}
              </div>
            )}

            <div className="mt-3 rounded-md border px-3 py-2" style={{ borderColor: 'var(--border-input)', background: 'var(--bg-input)' }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Generate Backlog Prompt Preview</p>
                <div className="flex gap-2">
                  <button className="btn-secondary btn-sm" onClick={() => copyText(promptPreview, 'prompt preview')} disabled={!promptPreview}>
                    Copy Prompt
                  </button>
                  <button className="btn-secondary btn-sm" onClick={() => previewBacklogPrompt.mutate()} disabled={llmActionLocked}>
                    {previewBacklogPrompt.isPending ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                This is the exact prompt payload returned by the backend for the current planner inputs.
              </p>
              <textarea
                className="input min-h-[240px] mt-2 font-mono text-xs leading-5"
                value={promptPreview || 'Click Preview Backlog Prompt to load the exact prompt.'}
                readOnly
              />
            </div>

            <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
              <h4 className="text-[20px] font-bold">Planner Timeline</h4>
              <div
                className="mt-2 space-y-2 max-h-[320px] overflow-auto rounded-md border p-2"
                style={{
                  borderColor: '#0f172a',
                  background: '#020617',
                  boxShadow: 'inset 0 0 0 1px rgba(34, 197, 94, 0.08)',
                }}
              >
                {plannerChat.map((msg, idx) => {
                  const tone = getTimelineTone(msg)
                  return (
                    <div
                      key={`${msg.role}-${idx}`}
                      className="rounded-md border px-3 py-2 text-sm"
                      style={{
                        borderColor: tone.line,
                        background: 'rgba(2, 6, 23, 0.92)',
                        color: tone.text,
                        boxShadow: `0 0 0 1px ${tone.glow}`,
                        fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                      }}
                    >
                      <span className="font-semibold mr-2" style={{ color: tone.line }}>
                        {msg.role === 'assistant' ? '[AI]' : '[YOU]'}:
                      </span>
                      {msg.text}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h4 className="text-[20px] font-bold">Developer Debug Panel</h4>
                  <button className="btn-secondary btn-sm" onClick={() => setDebugPanelOpen((value) => !value)}>
                    {debugPanelOpen ? 'Collapse' : 'Expand'}
                  </button>
                </div>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => setPlannerLogs([])}
                  disabled={!plannerLogs.length}
                >
                  Clear Logs
                </button>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                Raw request, response, prompt preview, AI meta, prompt payload, chunk traces, selected path, and status data for every planner step.
              </p>
              {debugPanelOpen && (
              <div
                className="mt-3 space-y-3 max-h-[420px] overflow-auto rounded-md border p-3"
                style={{
                  borderColor: '#111827',
                  background: '#020617',
                  boxShadow: 'inset 0 0 0 1px rgba(148, 163, 184, 0.08)',
                }}
              >
                {!plannerLogs.length && (
                  <p className="text-xs" style={{ color: '#64748b', fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace" }}>
                    No execution logs yet. Upload an SRS or run Suggest / Generate to see raw traces.
                  </p>
                )}

                {plannerLogs.map((log) => {
                  const tone = plannerLogTone(log.kind, log.level)
                  const logBody = {
                    request: log.request,
                    response: log.response,
                    raw: log.raw,
                    prompt: log.prompt,
                    meta: log.meta,
                  }

                  return (
                    <div
                      key={log.id}
                      className="rounded-md border px-3 py-2"
                      style={{
                        borderColor: tone.border,
                        background: 'rgba(2, 6, 23, 0.96)',
                        color: tone.text,
                        boxShadow: `0 0 0 1px ${tone.glow}`,
                        fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                      }}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide">
                        <span style={{ color: tone.border }}>
                          {log.kind} • {log.step}
                        </span>
                        <span style={{ color: '#64748b' }}>{log.ts}</span>
                      </div>
                      <p className="mt-1 text-sm font-semibold" style={{ color: tone.text }}>
                        {log.title}
                      </p>
                      {log.summary && (
                        <p className="mt-1 text-xs" style={{ color: '#cbd5e1' }}>
                          {log.summary}
                        </p>
                      )}
                      <pre className="mt-2 text-[11px] leading-5 whitespace-pre-wrap break-words overflow-x-auto" style={{ color: '#e2e8f0' }}>
                        {truncateLogValue(logBody, 16000) || '{}'}
                      </pre>
                    </div>
                  )
                })}
              </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="card p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-[20px] font-bold">Backlog History</h3>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Every generated backlog is saved here. Load one to review, save to DB, or push to Jira.
                </p>
              </div>
              {isBacklogHistoryFetching && (
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Refreshing...</span>
              )}
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {backlogHistory.map((entry) => {
                const payload = normalizeBacklogDraft(entry.payload || {})
                const itemCount = payload.epics.length + payload.stories.length + payload.tasks.length + payload.subtasks.length
                return (
                  <button
                    key={entry._id}
                    type="button"
                    className="shrink-0 w-[260px] rounded-md border px-3 py-2 text-left"
                    style={{ borderColor: 'var(--border-input)', background: 'var(--bg-input)' }}
                    onClick={() => useBacklogHistoryEntry(entry)}
                  >
                    <p className="text-sm font-semibold line-clamp-1" style={{ color: 'var(--text-primary)' }}>{entry.title}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{itemCount} items</p>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''}</p>
                  </button>
                )
              })}
              {!backlogHistory.length && (
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No generated backlog history yet.</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => saveBacklogToDb.mutate()} disabled={saveBacklogToDb.isPending || !backlogDraft.epics.length}>
              {saveBacklogToDb.isPending ? 'Saving...' : 'Save to DB'}
            </button>
            <button className="btn-primary" onClick={() => confirmAndPush.mutate()} disabled={confirmAndPush.isPending || !backlogDraft.epics.length || !selectedJiraProjectKey}>
              {confirmAndPush.isPending ? 'Pushing...' : 'Save and Push to Jira'}
            </button>
            <button className="btn-secondary" onClick={() => addBacklogItem('epic')}>+ Add Epic</button>
          </div>

          <div className="grid lg:grid-cols-[1.08fr_0.92fr] gap-3">
            <div className="card p-3">
              <div className="space-y-2 max-h-[70vh] overflow-auto pr-1">
                {backlogDraft.epics.map((epic) => (
                  <div key={epic.tempId} className="rounded-xl border p-2" style={{ borderColor: 'var(--border-input)', background: 'var(--bg-input)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <button className="text-left font-semibold text-[15px] flex-1" style={{ color: 'var(--text-primary)' }} onClick={() => setSelectedItem({ type: 'epic', tempId: epic.tempId })}>
                        EPIC: {epic.title}
                      </button>
                      <div className="flex items-center gap-2">
                        <button className="btn-secondary btn-sm" onClick={() => addBacklogItem('story', epic.tempId)}>+ Story</button>
                        <button className="btn-secondary btn-sm" onClick={() => addBacklogItem('task', epic.tempId)}>+ Task</button>
                        <button className="btn-danger btn-sm" onClick={() => removeByTempId('epics', epic.tempId)}>Delete</button>
                      </div>
                    </div>

                    <div className="ml-4 mt-3 space-y-3">
                      <div className="space-y-2">
                        <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Stories</p>
                        {(storiesByEpic.get(epic.tempId) || []).map((story) => (
                          <div key={story.tempId} className="rounded-lg border p-2" style={{ borderColor: 'var(--border-input)', background: 'var(--bg-card)' }}>
                            <div className="flex items-center justify-between gap-2">
                              <button className="text-left text-[14px] font-medium flex-1" style={{ color: 'var(--text-primary)' }} onClick={() => setSelectedItem({ type: 'story', tempId: story.tempId })}>
                                STORY: {story.title}
                              </button>
                              <div className="flex items-center gap-2">
                                <button className="btn-secondary btn-sm" onClick={() => addBacklogItem('subtask', story.tempId)}>+ Subtask</button>
                                <button className="btn-danger btn-sm" onClick={() => removeByTempId('stories', story.tempId)}>Delete</button>
                              </div>
                            </div>

                            {(subtasksByParent.get(story.tempId) || []).map((st) => (
                              <div key={st.tempId} className="ml-4 mt-2 rounded-lg border p-2" style={{ borderColor: 'var(--border-input)', background: 'var(--bg-card)' }}>
                                <div className="flex items-center justify-between gap-2">
                                  <button className="text-left text-[13px] font-medium flex-1" style={{ color: 'var(--text-primary)' }} onClick={() => setSelectedItem({ type: 'subtask', tempId: st.tempId })}>
                                    SUBTASK: {st.title}
                                  </button>
                                  <button className="btn-danger btn-sm" onClick={() => removeByTempId('subtasks', st.tempId)}>Delete</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                        {!storiesByEpic.get(epic.tempId)?.length && (
                          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No stories yet.</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Tasks</p>
                        {(tasksByEpic.get(epic.tempId) || []).map((task) => (
                          <div key={task.tempId} className="rounded-lg border p-2" style={{ borderColor: 'rgba(148,163,184,0.2)', background: 'rgba(15,23,42,0.65)' }}>
                            <div className="flex items-center justify-between gap-2">
                              <button className="text-left text-[13px] font-medium flex-1" style={{ color: 'var(--text-primary)' }} onClick={() => setSelectedItem({ type: 'task', tempId: task.tempId })}>
                                TASK: {task.title}
                              </button>
                              <div className="flex items-center gap-2">
                                <button className="btn-secondary btn-sm" onClick={() => addBacklogItem('subtask', task.tempId)}>+ Subtask</button>
                                <button className="btn-danger btn-sm" onClick={() => removeByTempId('tasks', task.tempId)}>Delete</button>
                              </div>
                            </div>

                            {(subtasksByParent.get(task.tempId) || []).map((st) => (
                              <div key={st.tempId} className="ml-4 mt-2 rounded-lg border p-2" style={{ borderColor: 'var(--border-input)', background: 'var(--bg-card)' }}>
                                <div className="flex items-center justify-between gap-2">
                                  <button className="text-left text-[13px] font-medium flex-1" style={{ color: 'var(--text-primary)' }} onClick={() => setSelectedItem({ type: 'subtask', tempId: st.tempId })}>
                                    SUBTASK: {st.title}
                                  </button>
                                  <button className="btn-danger btn-sm" onClick={() => removeByTempId('subtasks', st.tempId)}>Delete</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                        {!tasksByEpic.get(epic.tempId)?.length && (
                          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No tasks yet.</p>
                        )}
                      </div>

                      {(subtasksByParent.get(epic.tempId) || []).length > 0 && (
                        <div className="space-y-2">
                          <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Epic-Level Subtasks</p>
                          {(subtasksByParent.get(epic.tempId) || []).map((st) => (
                            <div key={st.tempId} className="rounded-lg border p-2" style={{ borderColor: 'var(--border-input)', background: 'rgba(15,23,42,0.65)' }}>
                              <div className="flex items-center justify-between gap-2">
                                <button className="text-left text-[13px] font-medium flex-1" style={{ color: 'var(--text-primary)' }} onClick={() => setSelectedItem({ type: 'subtask', tempId: st.tempId })}>
                                  SUBTASK: {st.title}
                                </button>
                                <button className="btn-danger btn-sm" onClick={() => removeByTempId('subtasks', st.tempId)}>Delete</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {!backlogDraft.epics.length && <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Generate backlog first to see hierarchy.</p>}
              </div>
            </div>

            <div className="card p-4">
              <h3 className="text-[30px] font-bold">Item Details</h3>
              {!selectedBacklogItem ? (
                <p className="text-sm mt-3" style={{ color: 'var(--text-secondary)' }}>Select a backlog item from tree.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  <input
                    className="input"
                    value={selectedBacklogItem.title || ''}
                    onChange={(e) => updateByTempId(getCollectionFromType(selectedBacklogItem.type), selectedBacklogItem.tempId, 'title', e.target.value)}
                    placeholder="Title"
                  />
                  <textarea
                    className="input min-h-[100px]"
                    value={selectedBacklogItem.description || ''}
                    onChange={(e) => updateByTempId(getCollectionFromType(selectedBacklogItem.type), selectedBacklogItem.tempId, 'description', e.target.value)}
                    placeholder="Description"
                  />
                  <select
                    className="input"
                    value={selectedBacklogItem.assignee || ''}
                    onChange={(e) => updateByTempId(getCollectionFromType(selectedBacklogItem.type), selectedBacklogItem.tempId, 'assignee', e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {availableAssignees.map((assignee) => (
                      <option key={assignee.id} value={assignee.id}>{assignee.label}</option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="input"
                      value={selectedBacklogItem.priority || 'medium'}
                      onChange={(e) => updateByTempId(getCollectionFromType(selectedBacklogItem.type), selectedBacklogItem.tempId, 'priority', e.target.value)}
                    >
                      <option value="high">high</option>
                      <option value="medium">medium</option>
                      <option value="low">low</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      className="input"
                      value={selectedBacklogItem.storyPoints || 0}
                      onChange={(e) => updateByTempId(getCollectionFromType(selectedBacklogItem.type), selectedBacklogItem.tempId, 'storyPoints', Number(e.target.value) || 0)}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                    <input
                      type="checkbox"
                      checked={selectedBacklogItem.selected !== false}
                      onChange={(e) => toggleSelected(getCollectionFromType(selectedBacklogItem.type), selectedBacklogItem.tempId, e.target.checked)}
                    />
                    Include this item in save/push
                  </label>

                  {Array.isArray(selectedBacklogItem.acceptanceCriteria) && selectedBacklogItem.acceptanceCriteria.length > 0 && (
                    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border-input)', background: 'rgba(15,23,42,0.65)' }}>
                      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Acceptance Criteria</p>
                      <div className="mt-2 space-y-1">
                        {selectedBacklogItem.acceptanceCriteria.map((criterion, idx) => (
                          <p key={`${selectedBacklogItem.tempId}-ac-${idx}`} className="text-sm" style={{ color: 'var(--text-primary)' }}>
                            - {typeof criterion === 'string' ? criterion : criterion?.criterion}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  {(selectedBacklogItem.epicTempId || selectedBacklogItem.parentTempId) && (
                    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border-input)', background: 'rgba(15,23,42,0.65)' }}>
                      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Hierarchy</p>
                      <p className="text-sm mt-1" style={{ color: 'var(--text-primary)' }}>
                        Epic: {selectedBacklogItem.epicTempId || 'none'}
                      </p>
                      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                        Parent: {selectedBacklogItem.parentTempId || 'none'}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
