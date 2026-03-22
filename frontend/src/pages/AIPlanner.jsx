import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { useProjectStore } from '@/store/projectStore'
import toast from 'react-hot-toast'

const makeId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

const normalizeGeneratedItems = (rows = [], prefix) =>
  rows.map((row) => ({
    ...row,
    tempId: row.tempId || makeId(prefix),
    selected: row.selected !== false,
    assignee: row.assignee || '',
  }))

export default function AIPlannerPage() {
  const qc = useQueryClient()
  const {
    selectedProjectId,
    selectedJiraProjectKey,
    setSelectedJiraProjectKey,
    projects,
  } = useProjectStore()

  const [chatInput, setChatInput] = useState('')
  const [planningPrompt, setPlanningPrompt] = useState('')
  const [srsFile, setSrsFile] = useState(null)
  const [selectedSuggestionChips, setSelectedSuggestionChips] = useState([])
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [backlogDraft, setBacklogDraft] = useState({ epics: [], stories: [], tasks: [], subtasks: [] })
  const [latestDocumentStatus, setLatestDocumentStatus] = useState(null)
  const [lastSrsLabel, setLastSrsLabel] = useState('')
  const [plannerChat, setPlannerChat] = useState([
    {
      role: 'assistant',
      text: 'Upload SRS, press Suggest, pick context prompts, add your instruction, then generate editable backlog and confirm push to Jira.',
    },
  ])

  const filePickerRef = useRef(null)
  const monitorInFlightRef = useRef(false)

  const { data: project } = useQuery({
    queryKey: ['ai-planner-project', selectedProjectId],
    enabled: !!selectedProjectId,
    queryFn: async () => (await api.get(`/projects/${selectedProjectId}`)).data.data,
  })

  useEffect(() => {
    if (project?.jiraProjectKey) {
      setSelectedJiraProjectKey(project.jiraProjectKey)
    }
  }, [project?.jiraProjectKey])

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
    if (project?.owner?._id) {
      map.set(project.owner._id, {
        id: project.owner._id,
        label: `${project.owner.name || 'Owner'} (Owner)`,
      })
    }
    ;(project?.members || []).forEach((m) => {
      if (!m?.user?._id) return
      const role = (m?.role || 'member').replace('_', ' ')
      map.set(m.user._id, {
        id: m.user._id,
        label: `${m.user.name || 'Member'} (${role})`,
      })
    })
    return [...map.values()]
  }, [project])

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
      const response = await api.post(`/stories/suggest/${resolvedProjectId}`, {
        moduleName,
        userInput: inputText,
      })
      return response.data.data || { suggestions: [] }
    },
    onSuccess: (data) => {
      const list = Array.isArray(data.suggestions) ? data.suggestions : []
      setSuggestions(list)
      setSuggestionsOpen(true)
    },
    onError: (error) => toast.error(error?.message || 'Failed to fetch suggestions'),
  })

  const generateBacklog = useMutation({
    mutationFn: async () => {
      const resolvedProjectId = await resolveProjectId()
      if (!resolvedProjectId) throw new Error('No project available. Please create one first.')

      const combinedContext = [
        plannerChat.filter((m) => m.role === 'user').map((m) => m.text).join('\n'),
        selectedSuggestionChips.map((s) => `- ${s}`).join('\n'),
        planningPrompt,
      ].filter(Boolean).join('\n\n')

      const response = await api.post(`/stories/generate/${resolvedProjectId}`, {
        moduleName,
        additionalContext: combinedContext,
      })
      return response.data.data
    },
    onSuccess: (data) => {
      const normalized = {
        epics: normalizeGeneratedItems(data?.epics || [], 'epic'),
        stories: normalizeGeneratedItems(data?.stories || [], 'story'),
        tasks: normalizeGeneratedItems(data?.tasks || [], 'task'),
        subtasks: normalizeGeneratedItems(data?.subtasks || [], 'subtask'),
      }
      setBacklogDraft(normalized)
      setPlannerChat((prev) => [...prev, { role: 'assistant', text: 'Backlog generated. Review/edit on the left, then confirm push to Jira.' }])
      toast.success('Backlog generated')
    },
    onError: (error) => toast.error(error?.message || 'Failed to generate backlog'),
  })

  const confirmAndPush = useMutation({
    mutationFn: async () => {
      const resolvedProjectId = await resolveProjectId()
      if (!resolvedProjectId) throw new Error('No local project found. Please select a local project from sidebar.')

      const selectedEpics = (backlogDraft.epics || []).filter((e) => e.selected !== false)
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
      toast.success('Confirmed and pushed to Jira')
      setPlannerChat((prev) => [...prev, { role: 'assistant', text: 'Confirmed and pushed to Jira.' }])
    },
    onError: (error) => toast.error(error?.message || 'Failed to confirm and push'),
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
    setSuggestionsOpen(false)
  }

  const latestDoc = latestDocumentStatus || documents[0] || null
  const storiesByEpic = useMemo(() => {
    const map = new Map()
    ;[...(backlogDraft.stories || []), ...(backlogDraft.tasks || [])].forEach((item) => {
      const key = item.epicTempId || 'ungrouped'
      const arr = map.get(key) || []
      arr.push(item)
      map.set(key, arr)
    })
    return map
  }, [backlogDraft.stories, backlogDraft.tasks])

  const srsStatusLabel = latestDoc
    ? `${latestDoc.name} - ${latestDoc.status}`
    : lastSrsLabel || (srsFile
      ? `${srsFile.name} - ready to upload`
      : 'Not uploaded')

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">AI Planner</h1>
          <p className="text-sm text-slate-400">Vectorless graph context planning with editable hierarchical backlog before Jira push.</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
          <input
            ref={filePickerRef}
            type="file"
            accept=".pdf,.doc,.docx,.txt,.md"
            className="hidden"
            onChange={handleSrsFileChange}
          />
          <button className="btn-secondary" onClick={() => filePickerRef.current?.click()}>Choose SRS</button>
          <button className="btn-primary" onClick={() => uploadSrs.mutate()} disabled={!srsFile || uploadSrs.isPending}>
            {uploadSrs.isPending ? 'Uploading...' : 'Upload'}
          </button>
          </div>
          <p className="text-xs text-slate-400 max-w-[360px] text-right">Selected file: {selectedFileSummary}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {activeProject && (
          <span className="px-2 py-1 rounded-md border border-slate-700 text-slate-300 bg-slate-900/60">Project: {activeProject.key} - {activeProject.name}</span>
        )}
        <span className="px-2 py-1 rounded-md border border-slate-700 text-slate-300 bg-slate-900/60">Jira: {selectedJiraProjectKey || 'Select from sidebar'}</span>
        <span className="px-2 py-1 rounded-md border border-slate-700 text-slate-300 bg-slate-900/60">SRS: {srsStatusLabel}</span>
      </div>

      <div className="grid lg:grid-cols-[1.1fr_1fr] gap-3">
        <div className="card p-4 space-y-3 min-h-[70vh]">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Backlog Draft (Editable Hierarchy)</h3>
            <button className="btn-secondary" onClick={() => confirmAndPush.mutate()} disabled={confirmAndPush.isPending || !backlogDraft.epics.length || !selectedJiraProjectKey}>Confirm and Push to Jira</button>
          </div>
          <div className="space-y-3 overflow-auto max-h-[62vh] pr-1">
            {backlogDraft.epics.map((epic) => (
              <div key={epic.tempId} className="rounded-md border border-slate-700 p-3 bg-slate-950/35">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <label className="text-xs text-indigo-300 inline-flex items-center gap-2">
                    <input type="checkbox" checked={epic.selected !== false} onChange={(e) => toggleSelected('epics', epic.tempId, e.target.checked)} />
                    Epic
                  </label>
                  <button className="text-xs text-rose-300 hover:text-rose-200" onClick={() => removeByTempId('epics', epic.tempId)}>Remove</button>
                </div>
                <input className="input mb-2" value={epic.title || ''} onChange={(e) => updateByTempId('epics', epic.tempId, 'title', e.target.value)} placeholder="Epic title" />
                <textarea className="input min-h-[56px] mb-2" value={epic.description || ''} onChange={(e) => updateByTempId('epics', epic.tempId, 'description', e.target.value)} placeholder="Epic description" />
                <div className="space-y-2 ml-3 border-l border-slate-700 pl-3">
                  {(storiesByEpic.get(epic.tempId) || []).map((item) => (
                    <div key={item.tempId} className="rounded-md border border-slate-700 p-2 bg-slate-900/40">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <label className="text-xs text-cyan-300 inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={item.selected !== false}
                            onChange={(e) => toggleSelected(item.type === 'task' ? 'tasks' : 'stories', item.tempId, e.target.checked)}
                          />
                          {item.type || 'story'}
                        </label>
                        <button className="text-xs text-rose-300 hover:text-rose-200" onClick={() => removeByTempId(item.type === 'task' ? 'tasks' : 'stories', item.tempId)}>Remove</button>
                      </div>
                      <input className="input mb-2" value={item.title || ''} onChange={(e) => updateByTempId(item.type === 'task' ? 'tasks' : 'stories', item.tempId, 'title', e.target.value)} placeholder="Title" />
                      <select
                        className="input mb-2"
                        value={item.assignee || ''}
                        onChange={(e) => updateByTempId(item.type === 'task' ? 'tasks' : 'stories', item.tempId, 'assignee', e.target.value)}
                      >
                        <option value="">Assign to...</option>
                        {availableAssignees.map((assignee) => (
                          <option key={assignee.id} value={assignee.id}>{assignee.label}</option>
                        ))}
                      </select>
                      <textarea className="input min-h-[48px]" value={item.description || ''} onChange={(e) => updateByTempId(item.type === 'task' ? 'tasks' : 'stories', item.tempId, 'description', e.target.value)} placeholder="Description" />
                      <div className="space-y-1 mt-2 ml-3 border-l border-slate-700 pl-3">
                        {(backlogDraft.subtasks || []).filter((st) => st.parentTempId === item.tempId).map((st) => (
                          <div key={st.tempId} className="rounded-md border border-slate-700 p-2 bg-slate-900/40">
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <label className="text-xs text-emerald-300 inline-flex items-center gap-2">
                                <input type="checkbox" checked={st.selected !== false} onChange={(e) => toggleSelected('subtasks', st.tempId, e.target.checked)} />
                                subtask
                              </label>
                              <button className="text-xs text-rose-300 hover:text-rose-200" onClick={() => removeByTempId('subtasks', st.tempId)}>Remove</button>
                            </div>
                            <input className="input" value={st.title || ''} onChange={(e) => updateByTempId('subtasks', st.tempId, 'title', e.target.value)} placeholder="Subtask title" />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!backlogDraft.epics.length && <p className="text-sm text-slate-400">No backlog draft yet. Use chat and generate.</p>}
          </div>
        </div>

        <div className="card p-4 space-y-3 min-h-[70vh]">
          <h3 className="text-base font-semibold">Planner Chat</h3>
          <div className="rounded-md border border-slate-700 bg-slate-950/40 p-3 min-h-[300px] max-h-[44vh] overflow-auto space-y-2">
            {plannerChat.map((msg, idx) => (
              <p key={`${msg.role}-${idx}`} className={`text-sm ${msg.role === 'assistant' ? 'text-slate-200' : 'text-indigo-200'}`}>
                <span className="font-semibold mr-2">{msg.role === 'assistant' ? 'AI' : 'You'}:</span>
                {msg.text}
              </p>
            ))}
          </div>

          {!!selectedSuggestionChips.length && (
            <div className="flex flex-wrap gap-2">
              {selectedSuggestionChips.map((chip) => (
                <button key={chip} className="px-2 py-1 text-xs rounded-md border border-indigo-500/40 bg-indigo-500/10 text-indigo-200" onClick={() => removeSuggestionChip(chip)}>
                  {chip} x
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <textarea className="input min-h-[80px]" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Optional instruction for planning (you can leave this blank)..." />
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-secondary"
                onClick={() => {
                  if (chatInput.trim()) {
                    setPlannerChat((prev) => [...prev, { role: 'user', text: chatInput.trim() }])
                  }
                  setPlanningPrompt(chatInput)
                  setChatInput('')
                  fetchSuggestions.mutate()
                }}
                disabled={fetchSuggestions.isPending}
              >
                {fetchSuggestions.isPending ? 'Loading...' : 'Suggest'}
              </button>
              <button className="btn-primary" onClick={() => generateBacklog.mutate()} disabled={generateBacklog.isPending}>
                {generateBacklog.isPending ? 'Generating...' : 'Generate Backlog'}
              </button>
            </div>
            {suggestionsOpen && suggestions.length > 0 && (
              <div className="rounded-md border border-slate-700 bg-slate-950/80 p-2 space-y-1">
                {suggestions.map((s, idx) => (
                  <button key={`${s}-${idx}`} className="w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-800 text-sm text-slate-200" onClick={() => addSuggestionChip(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
