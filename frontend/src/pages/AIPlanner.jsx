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
const DEFAULT_BACKLOG_DRAFT = { epics: [], stories: [], tasks: [], subtasks: [] }
const DEFAULT_PLANNER_CHAT = [
  {
    role: 'assistant',
    text: 'Upload SRS, press Suggest, pick context prompts, add your instruction, then generate editable backlog and confirm push to Jira.',
  },
]

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

  const [chatInput, setChatInput] = useState('')
  const [planningPrompt, setPlanningPrompt] = useState('')
  const [srsFile, setSrsFile] = useState(null)
  const [selectedSuggestionChips, setSelectedSuggestionChips] = useState([])
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [aiPlannerTab, setAiPlannerTab] = useState('planner')
  const [suggestions, setSuggestions] = useState(DEFAULT_SUGGESTIONS)
  const [backlogDraft, setBacklogDraft] = useState(DEFAULT_BACKLOG_DRAFT)
  const [latestDocumentStatus, setLatestDocumentStatus] = useState(null)
  const [lastSrsLabel, setLastSrsLabel] = useState('')
  const [plannerChat, setPlannerChat] = useState(DEFAULT_PLANNER_CHAT)
  const [selectedItem, setSelectedItem] = useState(null)

  const filePickerRef = useRef(null)
  const monitorInFlightRef = useRef(false)
  const plannerLoadedKeyRef = useRef('')

  useEffect(() => {
    if (!plannerHydrated) return
    if (plannerLoadedKeyRef.current === plannerStorageKey) return

    plannerLoadedKeyRef.current = plannerStorageKey
    const snapshot = persistedAIPlanner || {}

    setChatInput(snapshot.chatInput || '')
    setPlanningPrompt(snapshot.planningPrompt || '')
    setAiPlannerTab(snapshot.aiPlannerTab || 'planner')
    setSelectedSuggestionChips(Array.isArray(snapshot.selectedSuggestionChips) ? snapshot.selectedSuggestionChips : [])
    setSuggestionsOpen(Boolean(snapshot.suggestionsOpen))
    setSuggestions(snapshot.suggestions || DEFAULT_SUGGESTIONS)
    setBacklogDraft(snapshot.backlogDraft || DEFAULT_BACKLOG_DRAFT)
    setLastSrsLabel(snapshot.lastSrsLabel || '')
    setPlannerChat(Array.isArray(snapshot.plannerChat) && snapshot.plannerChat.length ? snapshot.plannerChat : DEFAULT_PLANNER_CHAT)
  }, [plannerHydrated, plannerStorageKey, persistedAIPlanner])

  useEffect(() => {
    if (!plannerHydrated) return
    if (plannerLoadedKeyRef.current !== plannerStorageKey) return

    setAIPlannerState(plannerStorageKey, {
      chatInput,
      planningPrompt,
      aiPlannerTab,
      selectedSuggestionChips,
      suggestionsOpen,
      suggestions,
      backlogDraft,
      lastSrsLabel,
      plannerChat,
    })
  }, [
    plannerHydrated,
    plannerStorageKey,
    chatInput,
    planningPrompt,
    aiPlannerTab,
    selectedSuggestionChips,
    suggestionsOpen,
    suggestions,
    backlogDraft,
    lastSrsLabel,
    plannerChat,
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

  const activeProject = useMemo(() => projects.find((p) => p._id === selectedProjectId) || null, [projects, selectedProjectId])
  const moduleName = useMemo(() => activeProject?.name || 'AI Planner', [activeProject])
  const selectedFileSummary = useMemo(() => {
    if (!srsFile) return 'No file selected'
    const kb = Math.max(1, Math.round(srsFile.size / 1024))
    return `${srsFile.name} (${kb} KB)`
  }, [srsFile])

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

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  const resolveProjectId = async () => {
    if (selectedProjectId) return selectedProjectId
    const remoteProjects = (await api.get('/projects')).data.data || []
    return remoteProjects[0]?._id || ''
  }

  const handleSrsFileChange = (e) => {
    const file = e.target.files?.[0] || null
    setSrsFile(file)
    if (file) {
      setLastSrsLabel(`${file.name} - selected`)
    }
  }

  const monitorDocumentIngestion = async (documentId, documentName, projectIdOverride) => {
    const projectId = projectIdOverride || selectedProjectId
    if (!projectId || !documentId || monitorInFlightRef.current) return

    monitorInFlightRef.current = true
    try {
      for (let i = 0; i < 80; i += 1) {
        await wait(2500)
        const rows = (await api.get(`/documents/project/${projectId}`)).data.data || []
        const current = rows.find((d) => d._id === documentId)
        if (!current) continue

        setLatestDocumentStatus(current)

        if (current.status === 'processed') {
          setPlannerChat((prev) => [...prev, { role: 'assistant', text: `SRS ingestion completed for ${documentName || current.name}.` }])
          toast.success('SRS processing completed')
          qc.invalidateQueries({ queryKey: ['ai-planner-documents', projectId] })
          return
        }

        if (current.status === 'failed') {
          setPlannerChat((prev) => [...prev, { role: 'assistant', text: `SRS ingestion failed for ${documentName || current.name}.` }])
          toast.error(current.ingestionStatus?.errorMessage || 'SRS processing failed')
          qc.invalidateQueries({ queryKey: ['ai-planner-documents', projectId] })
          return
        }
      }
      toast.error('SRS processing is still running. Please check again in a moment.')
    } catch (error) {
      toast.error(error?.message || 'Failed while checking SRS processing status')
    } finally {
      monitorInFlightRef.current = false
    }
  }

  useEffect(() => {
    if (!documents.length) {
      setLatestDocumentStatus(null)
      return
    }

    const topDoc = documents[0]
    setLatestDocumentStatus(topDoc)

    if ((topDoc.status === 'uploaded' || topDoc.status === 'processing') && !monitorInFlightRef.current) {
      monitorDocumentIngestion(topDoc._id, topDoc.name)
    }
  }, [documents, selectedProjectId])

  const connectJira = useMutation({
    mutationFn: async () => {
      if (!selectedProjectId || !selectedJiraProjectKey) {
        throw new Error('Select project and Jira project in sidebar first')
      }
      return (await api.post(`/jira/connect/${selectedProjectId}`, { jiraProjectKey: selectedJiraProjectKey })).data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-planner-project', selectedProjectId] })
      toast.success('Jira project connected')
    },
    onError: (error) => toast.error(error?.message || 'Failed to connect Jira project'),
  })

  const uploadSrs = useMutation({
    onMutate: () => {
      if (srsFile) {
        setLatestDocumentStatus({ name: srsFile.name, status: 'uploading' })
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
        throw new Error('No local project found. Please select a local project from sidebar.')
      }

      const formData = new FormData()
      formData.append('document', srsFile)
      const result = (await api.post(`/documents/upload/${resolvedProjectId}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })).data

      return { result, resolvedProjectId }
    },
    onSuccess: ({ result, resolvedProjectId }) => {
      qc.invalidateQueries({ queryKey: ['ai-planner-documents', resolvedProjectId] })
      const uploadedDoc = result?.data
      setLatestDocumentStatus(uploadedDoc || null)
      setLastSrsLabel(`${uploadedDoc?.name || 'document'} - ${uploadedDoc?.status || 'uploaded'}`)
      setPlannerChat((prev) => [...prev, { role: 'assistant', text: `SRS uploaded (${uploadedDoc?.name || 'document'}). Processing started in background.` }])
      setSrsFile(null)
      toast.success('SRS uploaded')
      if (uploadedDoc?._id) {
        monitorDocumentIngestion(uploadedDoc._id, uploadedDoc.name, resolvedProjectId)
      }
    },
    onError: (error) => toast.error(error?.message || 'Failed to upload SRS'),
  })

  const fetchSuggestions = useMutation({
    mutationFn: async () => {
      const resolvedProjectId = await resolveProjectId()
      if (!resolvedProjectId) throw new Error('No project available. Please create one first.')

      const inputText = chatInput.trim() || planningPrompt.trim() || 'Suggest next planning prompts'
      appLogger.info('AI Planner suggest request', {
        projectId: resolvedProjectId,
        moduleName,
        inputLength: inputText.length,
      })
      const response = await api.post(`/stories/suggest/${resolvedProjectId}`, {
        moduleName,
        userInput: inputText,
      })
      return response.data.data || { suggestions: [] }
    },
    onSuccess: (data) => {
      const structured = data?.structuredSuggestions || {}
      const epics = Array.isArray(structured.epics) ? structured.epics : []
      const stories = Array.isArray(structured.stories) ? structured.stories : []
      const tasks = Array.isArray(structured.tasks) ? structured.tasks : []
      const planningWarnings = data?.planningMeta?.warnings || []
      const isLowConfidence = data?.planningMeta?.contextQuality === 'low'
      setSuggestions({
        epics,
        stories,
        tasks,
      })
      const hasAny = epics.length + stories.length + tasks.length > 0
      setSuggestionsOpen(hasAny)

      appLogger.info('AI Planner suggest response', {
        hasAny,
        epics: epics.length,
        stories: stories.length,
        tasks: tasks.length,
        message: data?.message || null,
        contextSummary: data?.contextSummary || null,
      })

      if (!hasAny) {
        toast.error('No suggestions generated. Upload/process SRS or try a clearer prompt.')
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
      toast.error(error?.response?.data?.message || error?.message || 'Failed to fetch suggestions')
    },
  })

  const hasSuggestions = (suggestions.epics?.length || 0) + (suggestions.stories?.length || 0) + (suggestions.tasks?.length || 0) > 0

  const renderSuggestionGroup = (title, prefix, items = []) => {
    if (!items.length) return null
    return (
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-wide px-1" style={{ color: '#a0a0a0' }}>{title}</p>
        {items.map((s, idx) => {
          const value = `${prefix}: ${s}`
          return (
            <button
              key={`${prefix}-${idx}-${s}`}
              className="w-full text-left px-3 py-2 rounded-[10px] text-sm font-semibold border"
              style={{ background: '#242424', color: '#e0e0e0', borderColor: '#333' }}
              onClick={() => addSuggestionChip(value)}
            >
              {value}
            </button>
          )
        })}
      </div>
    )
  }

  const generateBacklog = useMutation({
    mutationFn: async () => {
      const resolvedProjectId = await resolveProjectId()
      if (!resolvedProjectId) throw new Error('No project available. Please create one first.')

      // Build comprehensive context combining user input, suggestions, planning prompt, and chat history
      const suggestionContext = [
        suggestions.epics.length > 0 && `Suggested Epics:\n${suggestions.epics.map((e) => `- ${e}`).join('\n')}`,
        suggestions.stories.length > 0 && `Suggested Stories:\n${suggestions.stories.map((s) => `- ${s}`).join('\n')}`,
        suggestions.tasks.length > 0 && `Suggested Tasks:\n${suggestions.tasks.map((t) => `- ${t}`).join('\n')}`,
      ].filter(Boolean).join('\n\n')

      const chatContext = plannerChat
        .filter((m) => m.role === 'user')
        .map((m) => m.text)
        .join('\n')

      const selectedContext = selectedSuggestionChips.length > 0 ? `Selected Planning Chips:\n${selectedSuggestionChips.map((s) => `- ${s}`).join('\n')}` : ''

      const combinedContext = [
        chatContext,
        selectedContext,
        planningPrompt && `Planning Prompt:\n${planningPrompt}`,
        suggestionContext,
      ]
        .filter(Boolean)
        .join('\n\n')

      const response = await api.post(`/stories/generate/${resolvedProjectId}`, {
        moduleName,
        additionalContext: combinedContext,
      }, {
        timeout: 0,
      })
      return { data: response.data.data, resolvedProjectId }
    },
    onSuccess: ({ data, resolvedProjectId }) => {
      const normalized = {
        epics: normalizeGeneratedItems(data?.epics || [], 'epic'),
        stories: normalizeGeneratedItems(data?.stories || [], 'story'),
        tasks: normalizeGeneratedItems(data?.tasks || [], 'task'),
        subtasks: normalizeGeneratedItems(data?.subtasks || [], 'subtask'),
      }

      // Set backlog draft state BEFORE switching tabs
      setBacklogDraft(normalized)

      const planningWarnings = data?.planningMeta?.warnings || []
      const isLowConfidence = data?.planningMeta?.contextQuality === 'low'

      setPlannerChat((prev) => {
        const next = [...prev, { role: 'assistant', text: `Backlog generated with ${normalized.epics.length} epics, ${normalized.stories.length} stories, ${normalized.tasks.length} tasks. Review on Backlog tab, then confirm push to Jira.` }]
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
    onError: (error) => toast.error(error?.message || 'Failed to generate backlog'),
  })

  const confirmAndPush = useMutation({
    mutationFn: async () => {
      const resolvedProjectId = await resolveProjectId()
      if (!resolvedProjectId) throw new Error('No local project found. Please select a local project from sidebar.')

      // Validate backlog has content
      const hasEpics = (backlogDraft.epics || []).length > 0
      const hasStories = (backlogDraft.stories || []).length > 0
      const hasTasks = (backlogDraft.tasks || []).length > 0

      if (!hasEpics || !hasStories || !hasTasks) {
        throw new Error('Backlog must have epics, stories, and tasks. Generate a backlog first.')
      }

      // Validate epic count
      const selectedEpics = (backlogDraft.epics || []).filter((e) => e.selected !== false)
      if (selectedEpics.length < 1) {
        throw new Error('Select at least one epic to push')
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

      const selectedEpicTempIds = new Set(selectedEpics.map((e) => e.tempId))
      const selectedStories = (backlogDraft.stories || []).filter((s) =>
        s.selected !== false && (!s.epicTempId || selectedEpicTempIds.has(s.epicTempId))
      )
      const selectedTasks = (backlogDraft.tasks || []).filter((t) =>
        t.selected !== false && (!t.epicTempId || selectedEpicTempIds.has(t.epicTempId))
      )
      const selectedParentTempIds = new Set([
        ...selectedStories.map((s) => s.tempId),
        ...selectedTasks.map((t) => t.tempId),
      ])
      const selectedSubtasks = (backlogDraft.subtasks || []).filter((st) =>
        st.selected !== false && (!st.parentTempId || selectedParentTempIds.has(st.parentTempId))
      )

      if (!selectedEpics.length && !selectedStories.length && !selectedTasks.length && !selectedSubtasks.length) {
        throw new Error('Select at least one generated item before confirming push')
      }

      // Validate that all selected items have titles
      const validationErrors = validateBacklogItems({
        epics: selectedEpics,
        stories: selectedStories,
        tasks: selectedTasks,
        subtasks: selectedSubtasks,
      })
      if (validationErrors.length > 0) {
        const errorMsg = validationErrors.join('\n')
        const error = new Error(`Please fix the following issues:\n${errorMsg}`)
        error.validationErrors = validationErrors
        throw error
      }

      await api.post(`/stories/save/${resolvedProjectId}`, {
        epics: selectedEpics,
        stories: selectedStories,
        tasks: selectedTasks,
        subtasks: selectedSubtasks,
      })

      const freshEpics = (await api.get(`/stories/epics/${resolvedProjectId}`)).data.data || []
      const freshStories = (await api.get(`/stories/project/${resolvedProjectId}`)).data.data || []

      const jiraKey = selectedJiraProjectKey || project?.jiraProjectKey
      if (!jiraKey) {
        throw new Error('Select Jira project in sidebar first')
      }

      await api.post(`/jira/connect/${resolvedProjectId}`, { jiraProjectKey: jiraKey })

      await api.post(`/jira/push/${resolvedProjectId}`, {
        epicIds: freshEpics.map((e) => e._id),
        storyIds: freshStories.filter((s) => s.type !== 'subtask').map((s) => s._id),
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

  const latestDoc = latestDocumentStatus || documents[0] || null

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
      const parentStory = backlogDraft.stories.find((s) => s.tempId === parentTempId)
      return { ...base, parentTempId, epicTempId: parentStory?.epicTempId || '' }
    }
    if (type === 'subtask') {
      const parentTask = backlogDraft.tasks.find((t) => t.tempId === parentTempId)
      return { ...base, parentTempId, epicTempId: parentTask?.epicTempId || '' }
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

  const selectedBacklogItem = useMemo(() => {
    if (!selectedItem) return null
    const collection = getCollectionFromType(selectedItem.type)
    return (backlogDraft[collection] || []).find((row) => row.tempId === selectedItem.tempId) || null
  }, [selectedItem, backlogDraft])

  const storiesByEpic = useMemo(() => {
    const map = new Map()
    
    // Ensure backlogDraft has required properties
    const stories = Array.isArray(backlogDraft?.stories) ? backlogDraft.stories : []
    const tasks = Array.isArray(backlogDraft?.tasks) ? backlogDraft.tasks : []
    
    // Group stories by epic
    stories.forEach((story) => {
      const key = story.epicTempId || 'ungrouped'
      const arr = map.get(key) || []
      arr.push({ ...story, type: 'story' })
      map.set(key, arr)
    })
    
    // Group tasks (only direct tasks, not under stories)
    tasks.forEach((task) => {
      if (!task.parentTempId) {
        // Only orphan tasks get grouped by epic directly
        const key = task.epicTempId || 'ungrouped'
        const arr = map.get(key) || []
        arr.push({ ...task, type: 'task' })
        map.set(key, arr)
      }
    })
    
    return map
  }, [backlogDraft?.stories, backlogDraft?.tasks])

  const srsStatusLabel = latestDoc
    ? `${latestDoc.name} - ${latestDoc.status}`
    : lastSrsLabel || (srsFile
      ? `${srsFile.name} - ready to upload`
      : 'Not uploaded')

  return (
    <div className="p-5 max-w-[1250px] mx-auto">
      <h1 className="text-[40px] font-bold leading-none mb-4" style={{ color: '#e0e0e0' }}>AI Planner</h1>

      <div className="flex items-center gap-2 mb-3">
        <button
          className="px-4 py-1.5 text-[14px] font-semibold rounded-[10px] border"
          style={{
            background: aiPlannerTab === 'planner' ? 'rgba(26, 115, 232, 0.20)' : '#2a2a2a',
            borderColor: aiPlannerTab === 'planner' ? 'rgba(26, 115, 232, 0.5)' : '#444',
            color: aiPlannerTab === 'planner' ? '#90caf9' : '#a0a0a0',
          }}
          onClick={() => setAiPlannerTab('planner')}
        >
          Planner
        </button>
        <button
          className="px-4 py-1.5 text-[14px] font-semibold rounded-[10px] border"
          style={{
            background: aiPlannerTab === 'backlog' ? 'rgba(26, 115, 232, 0.20)' : '#2a2a2a',
            borderColor: aiPlannerTab === 'backlog' ? 'rgba(26, 115, 232, 0.5)' : '#444',
            color: aiPlannerTab === 'backlog' ? '#90caf9' : '#a0a0a0',
          }}
          onClick={() => setAiPlannerTab('backlog')}
        >
          Backlog
        </button>
      </div>

      {aiPlannerTab === 'planner' ? (
        <div className="grid lg:grid-cols-[1.08fr_0.92fr] gap-3">
          <div className="rounded-2xl border p-4" style={{ background: '#1a1a1a', borderColor: '#333' }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[30px] font-bold" style={{ color: '#e0e0e0' }}>SRS Ingestion</h3>
                <p className="text-sm" style={{ color: '#a0a0a0' }}>Upload - Process - Suggest - Generate</p>
              </div>
              <span className="px-3 py-1 rounded-full text-[12px] font-bold" style={{
                background: latestDoc?.status === 'processed' ? 'rgba(24,128,56,0.14)' : 'rgba(251,188,4,0.16)',
                color: latestDoc?.status === 'processed' ? '#188038' : '#8d5a00',
              }}>
                {(latestDoc?.status || 'uploaded').toUpperCase()}
              </span>
            </div>

            <p className="mt-2 text-sm" style={{ color: '#a0a0a0' }}>Current SRS: {srsStatusLabel}</p>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <input
                ref={filePickerRef}
                type="file"
                accept=".pdf,.doc,.docx,.txt,.md"
                className="hidden"
                onChange={handleSrsFileChange}
              />
              <button className="btn-secondary" onClick={() => filePickerRef.current?.click()}>Upload SRS</button>
              <button className="btn-secondary" onClick={() => connectJira.mutate()} disabled={connectJira.isPending || !selectedJiraProjectKey}>Connect Jira</button>
              <button className="btn-primary" onClick={() => uploadSrs.mutate()} disabled={!srsFile || uploadSrs.isPending}>
                {uploadSrs.isPending ? 'Uploading...' : 'Process SRS'}
              </button>
            </div>

            <p className="text-xs mt-2" style={{ color: '#a0a0a0' }}>Selected file: {selectedFileSummary}</p>

            <div className="mt-3">
              <label className="block text-sm font-semibold mb-1" style={{ color: '#e0e0e0' }}>Planning Prompt</label>
              <textarea
                className="input min-h-[110px]"
                style={{ background: '#242424', borderColor: '#333', color: '#e0e0e0' }}
                value={planningPrompt}
                onChange={(e) => setPlanningPrompt(e.target.value)}
                placeholder="Describe planning direction"
              />
            </div>

            <div className="mt-3">
              <label className="block text-sm font-semibold mb-1" style={{ color: '#e0e0e0' }}>Chat Input</label>
              <input
                className="input"
                style={{ background: '#242424', borderColor: '#333', color: '#e0e0e0' }}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask planner for next sprint plan"
              />
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              <button
                className="btn-primary"
                onClick={() => {
                  if (chatInput.trim()) {
                    setPlannerChat((prev) => [...prev, { role: 'user', text: chatInput.trim() }])
                  }
                  setPlanningPrompt((prev) => prev || chatInput)
                  setChatInput('')
                  fetchSuggestions.mutate()
                }}
                disabled={fetchSuggestions.isPending}
              >
                {fetchSuggestions.isPending ? 'Suggesting...' : 'Suggest'}
              </button>
              <button className="btn-primary" onClick={() => generateBacklog.mutate()} disabled={generateBacklog.isPending}>
                {generateBacklog.isPending ? 'Generating...' : 'Generate Backlog'}
              </button>
            </div>

            <div className="mt-4">
              <p className="text-sm font-semibold" style={{ color: '#e0e0e0' }}>Selected Suggestion Chips</p>
              {!selectedSuggestionChips.length ? (
                <p className="text-sm mt-1" style={{ color: '#a0a0a0' }}>No chips selected.</p>
              ) : (
                <div className="flex flex-wrap gap-2 mt-2">
                  {selectedSuggestionChips.map((chip) => (
                    <button key={chip} className="px-2 py-1 text-xs rounded-full border" style={{ borderColor: '#555', color: '#90caf9', background: '#1e3a5f' }} onClick={() => removeSuggestionChip(chip)}>
                      {chip} x
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border p-4" style={{ background: '#1a1a1a', borderColor: '#333' }}>
            <h3 className="text-[30px] font-bold" style={{ color: '#e0e0e0' }}>Suggested Structure</h3>
            <p className="text-sm mt-1" style={{ color: '#a0a0a0' }}>Based on project module, phase, requirements, and commit history context</p>

            <div className="mt-3 space-y-2">
              {renderSuggestionGroup('Epics', 'EPIC', suggestions.epics)}
              {renderSuggestionGroup('Stories', 'STORY', suggestions.stories)}
              {renderSuggestionGroup('Tasks', 'TASK', suggestions.tasks)}
              {!hasSuggestions && <p className="text-sm" style={{ color: '#5f6368' }}>Click Suggest to generate dynamic recommendations.</p>}
            </div>

            <div className="mt-4 pt-3 border-t" style={{ borderColor: '#333' }}>
              <h4 className="text-[20px] font-bold" style={{ color: '#e0e0e0' }}>Planner Timeline</h4>
              <div className="mt-2 space-y-2 max-h-[320px] overflow-auto">
                {plannerChat.map((msg, idx) => (
                  <div key={`${msg.role}-${idx}`} className="rounded-md border px-3 py-2 text-sm" style={{
                    borderColor: '#333',
                    background: msg.role === 'assistant' ? '#242424' : '#1e3a5f',
                    color: '#e0e0e0',
                  }}>
                    <span className="font-semibold mr-2">{msg.role === 'assistant' ? 'AI' : 'You'}:</span>
                    {msg.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => confirmAndPush.mutate()} disabled={confirmAndPush.isPending || !backlogDraft.epics.length || !selectedJiraProjectKey}>
              {confirmAndPush.isPending ? 'Pushing...' : 'Save and Push to Jira'}
            </button>
            <button className="btn-secondary" onClick={() => addBacklogItem('epic')}>+ Add Epic</button>
          </div>

          <div className="grid lg:grid-cols-[1.08fr_0.92fr] gap-3">
            <div className="rounded-2xl border p-3" style={{ background: '#1a1a1a', borderColor: '#333' }}>
              <div className="space-y-2 max-h-[70vh] overflow-auto pr-1">
                {backlogDraft.epics.map((epic) => (
                  <div key={epic.tempId} className="rounded-xl border p-2" style={{ borderColor: '#333', background: '#242424' }}>
                    <div className="flex items-center justify-between gap-2">
                      <button className="text-left font-semibold text-[15px] flex-1" style={{ color: '#e0e0e0' }} onClick={() => setSelectedItem({ type: 'epic', tempId: epic.tempId })}>
                        EPIC: {epic.title}
                      </button>
                      <div className="flex items-center gap-2">
                        <button className="btn-secondary btn-sm" onClick={() => addBacklogItem('story', epic.tempId)}>+ Story</button>
                        <button className="btn-sm" style={{ background: '#ffe9ee', color: '#b3261e', border: '1px solid #f1c8d3' }} onClick={() => removeByTempId('epics', epic.tempId)}>Delete</button>
                      </div>
                    </div>

                    <div className="ml-4 mt-2 space-y-2">
                      {(storiesByEpic.get(epic.tempId) || []).map((item) => (
                        <div key={item.tempId} className="rounded-lg border p-2" style={{ borderColor: '#333', background: '#1e1e1e' }}>
                          <div className="flex items-center justify-between gap-2">
                            <button className="text-left text-[14px] font-medium flex-1" style={{ color: '#e0e0e0' }} onClick={() => setSelectedItem({ type: item.type, tempId: item.tempId })}>
                              {item.type === 'task' ? 'TASK' : 'STORY'}: {item.title}
                            </button>
                            <div className="flex items-center gap-2">
                              {item.type !== 'task' ? (
                                <button className="btn-secondary btn-sm" onClick={() => addBacklogItem('task', item.tempId)}>+ Task</button>
                              ) : (
                                <button className="btn-secondary btn-sm" onClick={() => addBacklogItem('subtask', item.tempId)}>+ Subtask</button>
                              )}
                              <button className="btn-sm" style={{ background: '#ffe9ee', color: '#b3261e', border: '1px solid #f1c8d3' }} onClick={() => removeByTempId(item.type === 'task' ? 'tasks' : 'stories', item.tempId)}>Delete</button>
                            </div>
                          </div>

                          {(backlogDraft.subtasks || []).filter((st) => st.parentTempId === item.tempId).map((st) => (
                            <div key={st.tempId} className="ml-4 mt-2 rounded-lg border p-2" style={{ borderColor: '#333', background: '#1a1a1a' }}>
                              <div className="flex items-center justify-between gap-2">
                                <button className="text-left text-[13px] font-medium flex-1" style={{ color: '#e0e0e0' }} onClick={() => setSelectedItem({ type: 'subtask', tempId: st.tempId })}>
                                  SUBTASK: {st.title}
                                </button>
                                <button className="btn-sm" style={{ background: '#ffe9ee', color: '#b3261e', border: '1px solid #f1c8d3' }} onClick={() => removeByTempId('subtasks', st.tempId)}>Delete</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {!backlogDraft.epics.length && <p className="text-sm" style={{ color: '#a0a0a0' }}>Generate backlog first to see hierarchy.</p>}
              </div>
            </div>

            <div className="rounded-2xl border p-4" style={{ background: '#1a1a1a', borderColor: '#333' }}>
              <h3 className="text-[30px] font-bold" style={{ color: '#e0e0e0' }}>Item Details</h3>
              {!selectedBacklogItem ? (
                <p className="text-sm mt-3" style={{ color: '#a0a0a0' }}>Select a backlog item from tree.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  <input
                    className="input"
                    style={{ background: '#242424', borderColor: '#333', color: '#e0e0e0' }}
                    value={selectedBacklogItem.title || ''}
                    onChange={(e) => updateByTempId(getCollectionFromType(selectedBacklogItem.type), selectedBacklogItem.tempId, 'title', e.target.value)}
                    placeholder="Title"
                  />
                  <textarea
                    className="input min-h-[100px]"
                    style={{ background: '#242424', borderColor: '#333', color: '#e0e0e0' }}
                    value={selectedBacklogItem.description || ''}
                    onChange={(e) => updateByTempId(getCollectionFromType(selectedBacklogItem.type), selectedBacklogItem.tempId, 'description', e.target.value)}
                    placeholder="Description"
                  />
                  <select
                    className="input"
                    style={{ background: '#242424', borderColor: '#333', color: '#e0e0e0' }}
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
                      style={{ background: '#242424', borderColor: '#333', color: '#e0e0e0' }}
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
                      style={{ background: '#242424', borderColor: '#333', color: '#e0e0e0' }}
                      value={selectedBacklogItem.storyPoints || 0}
                      onChange={(e) => updateByTempId(getCollectionFromType(selectedBacklogItem.type), selectedBacklogItem.tempId, 'storyPoints', Number(e.target.value) || 0)}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm" style={{ color: '#e0e0e0' }}>
                    <input
                      type="checkbox"
                      checked={selectedBacklogItem.selected !== false}
                      onChange={(e) => toggleSelected(getCollectionFromType(selectedBacklogItem.type), selectedBacklogItem.tempId, e.target.checked)}
                    />
                    Include this item in save/push
                  </label>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
