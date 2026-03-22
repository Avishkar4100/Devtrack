import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import api from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'ai-planner', label: 'AI Planner' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'progress', label: 'Progress' },
]

const displayDate = (value) => {
  if (!value) return 'N/A'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

const getCommitAuthorName = (commit) => {
  if (!commit) return 'Unknown'
  if (typeof commit.author === 'string' && commit.author.trim()) return commit.author
  if (commit.author?.login) return commit.author.login
  if (commit.commit?.author?.name) return commit.commit.author.name
  return 'Unknown'
}

const getCommitMessage = (commit) => {
  if (!commit) return 'Commit'
  if (typeof commit.message === 'string' && commit.message.trim()) return commit.message
  if (typeof commit.commitMessage === 'string' && commit.commitMessage.trim()) return commit.commitMessage
  if (typeof commit.commit?.message === 'string' && commit.commit.message.trim()) return commit.commit.message
  return 'Commit'
}

const normalize = (v = '') => v.toLowerCase().replace(/[^a-z0-9]/g, '')

export default function ProjectWorkspacePage() {
  const { id } = useParams()
  const queryClient = useQueryClient()
  const { user } = useAuthStore()
  const isScrumMaster = user?.role === 'scrum_master'

  const [activeTab, setActiveTab] = useState('overview')
  const [moduleName, setModuleName] = useState('Core Module')
  const [storyPrompt, setStoryPrompt] = useState('')
  const [generatedResult, setGeneratedResult] = useState(null)
  const [generatedJsonText, setGeneratedJsonText] = useState('')
  const [plannerInput, setPlannerInput] = useState('')
  const [plannerChat, setPlannerChat] = useState([
    { role: 'assistant', text: 'Upload SRS, ask for suggestions, review generated backlog, then push to Jira.' },
  ])
  const [srsFile, setSrsFile] = useState(null)
  const [jiraProjectKey, setJiraProjectKey] = useState('')
  const [autoDetectedKey, setAutoDetectedKey] = useState('')
  const [autoConnectAttempted, setAutoConnectAttempted] = useState(false)

  const [newStory, setNewStory] = useState({ title: '', type: 'story', priority: 'medium', sprint: 'backlog', epic: '' })
  const [editingStoryId, setEditingStoryId] = useState('')
  const [editingDraft, setEditingDraft] = useState({ title: '', status: 'approved', priority: 'medium', sprint: 'backlog' })

  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => (await api.get(`/projects/${id}`)).data.data,
  })

  const { data: dashboard } = useQuery({
    queryKey: ['dashboard', id],
    queryFn: async () => (await api.get(`/dashboard/${id}`)).data.data,
  })

  const { data: epics = [] } = useQuery({
    queryKey: ['epics', id],
    queryFn: async () => (await api.get(`/stories/epics/${id}`)).data.data,
  })

  const { data: stories = [] } = useQuery({
    queryKey: ['stories', id],
    queryFn: async () => (await api.get(`/stories/project/${id}`)).data.data,
  })

  const { data: jiraProjects = [] } = useQuery({
    queryKey: ['jira-server-projects', id],
    enabled: true,
    queryFn: async () => (await api.get('/jira/server/projects')).data.data || [],
  })

  const { data: commits = [] } = useQuery({
    queryKey: ['commits', id],
    queryFn: async () => (await api.get(`/github/commits/${id}`)).data.data,
  })

  const { data: documents = [] } = useQuery({
    queryKey: ['documents', id],
    queryFn: async () => (await api.get(`/documents/project/${id}`)).data.data,
  })

  const { data: insights } = useQuery({
    queryKey: ['insights', id],
    queryFn: async () => (await api.get(`/insights/${id}`)).data.data,
  })

  const createStory = useMutation({
    mutationFn: async () => (await api.post('/stories', {
      project: id,
      epic: newStory.epic || undefined,
      title: newStory.title,
      type: newStory.type,
      priority: newStory.priority,
      sprint: newStory.sprint,
      status: 'approved',
    })).data,
    onSuccess: () => {
      setNewStory({ title: '', type: 'story', priority: 'medium', sprint: 'backlog', epic: '' })
      queryClient.invalidateQueries({ queryKey: ['stories', id] })
      queryClient.invalidateQueries({ queryKey: ['project', id] })
      toast.success('Backlog item created')
    },
  })

  const updateStory = useMutation({
    mutationFn: async () => (await api.put(`/stories/${editingStoryId}`, editingDraft)).data,
    onSuccess: () => {
      setEditingStoryId('')
      queryClient.invalidateQueries({ queryKey: ['stories', id] })
      queryClient.invalidateQueries({ queryKey: ['project', id] })
      toast.success('Backlog item updated')
    },
  })

  const deleteStory = useMutation({
    mutationFn: async (storyId) => (await api.delete(`/stories/${storyId}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stories', id] })
      queryClient.invalidateQueries({ queryKey: ['project', id] })
      toast.success('Backlog item deleted')
    },
  })

  const generateStories = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/stories/generate/${id}`, {
        moduleName,
        additionalContext: storyPrompt,
      })
      return response.data.data
    },
    onSuccess: (data) => {
      setGeneratedResult(data || null)
      setGeneratedJsonText(JSON.stringify(data || {}, null, 2))
      toast.success('AI backlog draft generated')
    },
  })

  const saveGenerated = useMutation({
    mutationFn: async () => {
      const response = await api.post(`/stories/save/${id}`, {
        epics: generatedResult?.epics || [],
        stories: generatedResult?.stories || [],
        tasks: generatedResult?.tasks || [],
        subtasks: generatedResult?.subtasks || [],
      })
      return response.data.data
    },
    onSuccess: () => {
      setGeneratedResult(null)
      setStoryPrompt('')
      queryClient.invalidateQueries({ queryKey: ['epics', id] })
      queryClient.invalidateQueries({ queryKey: ['stories', id] })
      queryClient.invalidateQueries({ queryKey: ['project', id] })
      toast.success('AI backlog draft saved')
    },
  })

  const connectJira = useMutation({
    mutationFn: async (key) =>
      (await api.post(`/jira/connect/${id}`, {
        jiraProjectKey: key,
      })).data,
    onSuccess: (_, keyUsed) => {
      queryClient.invalidateQueries({ queryKey: ['project', id] })
      if (keyUsed) setJiraProjectKey(keyUsed)
      toast.success(`Connected to Jira project ${keyUsed || ''}`.trim())
    },
  })

  const syncFromJira = useMutation({
    mutationFn: async () => (await api.post(`/jira/sync/${id}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['epics', id] })
      queryClient.invalidateQueries({ queryKey: ['stories', id] })
      queryClient.invalidateQueries({ queryKey: ['project', id] })
      toast.success('Pulled latest backlog from Jira')
    },
  })

  const pushToJira = useMutation({
    mutationFn: async () => {
      const epicIds = epics.map((e) => e._id)
      const storyIds = stories.filter((s) => s.type !== 'subtask').map((s) => s._id)
      return (await api.post(`/jira/push/${id}`, { epicIds, storyIds })).data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['epics', id] })
      queryClient.invalidateQueries({ queryKey: ['stories', id] })
      queryClient.invalidateQueries({ queryKey: ['project', id] })
      toast.success('Backlog pushed to Jira')
    },
  })

  const refreshCommits = useMutation({
    mutationFn: async () => (await api.get(`/github/commits/${id}`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['commits', id] }),
  })

  const uploadSrs = useMutation({
    mutationFn: async () => {
      const formData = new FormData()
      formData.append('document', srsFile)
      return (await api.post(`/documents/upload/${id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })).data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', id] })
      setPlannerChat((prev) => [...prev, { role: 'assistant', text: 'SRS uploaded. Embedding ingestion is running in background.' }])
      setSrsFile(null)
      toast.success('SRS uploaded')
    },
  })

  const confirmPlannerDraft = useMutation({
    mutationFn: async () => {
      let parsed = {}
      try {
        parsed = JSON.parse(generatedJsonText || '{}')
      } catch (_) {
        throw new Error('Invalid JSON. Please fix JSON before confirm.')
      }

      await api.post(`/stories/save/${id}`, {
        epics: parsed?.epics || [],
        stories: parsed?.stories || [],
        tasks: parsed?.tasks || [],
        subtasks: parsed?.subtasks || [],
      })

      const freshEpics = (await api.get(`/stories/epics/${id}`)).data.data || []
      const freshStories = (await api.get(`/stories/project/${id}`)).data.data || []

      await api.post(`/jira/push/${id}`, {
        epicIds: freshEpics.map((e) => e._id),
        storyIds: freshStories.filter((s) => s.type !== 'subtask').map((s) => s._id),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['epics', id] })
      queryClient.invalidateQueries({ queryKey: ['stories', id] })
      queryClient.invalidateQueries({ queryKey: ['project', id] })
      setPlannerChat((prev) => [...prev, { role: 'assistant', text: 'Draft confirmed and pushed to Jira.' }])
      toast.success('Draft confirmed and pushed to Jira')
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to confirm draft')
    },
  })

  useEffect(() => {
    if (!project || project.jiraConnected || autoConnectAttempted || jiraProjects.length === 0) return

    const byKey = jiraProjects.find((jp) => normalize(jp.key) === normalize(project.key || ''))
    const byName = jiraProjects.find((jp) => normalize(jp.name) === normalize(project.name || ''))
    const match = byKey || byName

    if (!match) {
      setAutoConnectAttempted(true)
      return
    }

    setAutoDetectedKey(match.key)
    setJiraProjectKey(match.key)
    setAutoConnectAttempted(true)
    connectJira.mutate(match.key)
  }, [isScrumMaster, project, jiraProjects, autoConnectAttempted])

  const commitByDeveloper = useMemo(() => {
    const map = new Map()
    for (const c of commits) {
      const key = getCommitAuthorName(c)
      map.set(key, (map.get(key) || 0) + 1)
    }
    return [...map.entries()].map(([name, count]) => ({ name, count }))
  }, [commits])

  const projectRisk = useMemo(() => {
    const p = project?.completionPercentage || 0
    if (p < 40) return 'High'
    if (p < 70) return 'Medium'
    return 'Low'
  }, [project])

  const openStories = stories.filter((s) => s.status !== 'done').length
  const sprintRows = useMemo(() => {
    const bucket = new Map()
    stories.forEach((s) => {
      const sprint = s.sprint || 'backlog'
      const current = bucket.get(sprint) || { sprint, total: 0, done: 0, inProgress: 0 }
      current.total += 1
      if (s.status === 'done') current.done += 1
      if (s.status === 'in_progress') current.inProgress += 1
      bucket.set(sprint, current)
    })
    return [...bucket.values()].map((row) => ({
      ...row,
      completion: row.total ? Math.round((row.done / row.total) * 100) : 0,
    }))
  }, [stories])

  const issueRows = useMemo(() => {
    return stories.map((s) => ({
      id: s._id,
      title: s.title,
      sprint: s.sprint || 'backlog',
      status: s.status,
      codeStatus: s.codeStatus || 'not_started',
      updatedAt: s.updatedAt,
    }))
  }, [stories])

  if (loadingProject) return <div className="p-6">Loading workspace...</div>
  if (!project) return <div className="p-6">Project not found.</div>

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{project.name}</h1>
          <p className="text-sm text-slate-400">Workspace</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-md text-sm border ${activeTab === tab.id ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-900/50 border-slate-700 text-slate-300'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid md:grid-cols-3 gap-3">
          <Card title="Sprint Progress" value={`${dashboard?.activeSprint?.completionPercentage ?? project.completionPercentage ?? 0}%`} />
          <Card title="Open Stories" value={openStories} />
          <Card title="Risk" value={projectRisk} />
        </div>
      )}

      {activeTab === 'ai-planner' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <h3 className="text-base font-semibold">AI Planner Chat</h3>
            <div className="rounded-md border border-slate-700 bg-slate-950/40 p-3 max-h-56 overflow-auto space-y-2">
              {plannerChat.map((msg, idx) => (
                <p key={`${msg.role}-${idx}`} className={`text-sm ${msg.role === 'assistant' ? 'text-slate-200' : 'text-indigo-200'}`}>
                  <span className="font-semibold mr-2">{msg.role === 'assistant' ? 'AI' : 'You'}:</span>
                  {msg.text}
                </p>
              ))}
            </div>
            <div className="grid md:grid-cols-[1fr_auto] gap-2">
              <input
                className="input"
                value={plannerInput}
                onChange={(e) => setPlannerInput(e.target.value)}
                placeholder="Add context or ask for issue suggestions from SRS"
              />
              <button
                className="btn-secondary"
                onClick={() => {
                  if (!plannerInput.trim()) return
                  setPlannerChat((prev) => [
                    ...prev,
                    { role: 'user', text: plannerInput },
                    { role: 'assistant', text: 'Suggestion request captured. Click Generate Backlog below to produce editable epics/stories/tasks JSON.' },
                  ])
                  setStoryPrompt(plannerInput)
                  setPlannerInput('')
                }}
                disabled={!plannerInput.trim()}
              >
                Suggest
              </button>
            </div>
            <div className="grid md:grid-cols-[1fr_auto] gap-2">
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt,.md"
                className="input"
                onChange={(e) => setSrsFile(e.target.files?.[0] || null)}
              />
              <button className="btn-secondary" onClick={() => uploadSrs.mutate()} disabled={!srsFile || uploadSrs.isPending}>
                {uploadSrs.isPending ? 'Uploading...' : 'Upload SRS'}
              </button>
            </div>
            {documents.length > 0 && (
              <p className="text-xs text-slate-400">Latest SRS status: {documents[0].name} - {documents[0].status}</p>
            )}
          </div>

          <div className="card p-4 space-y-3">
            <h3 className="text-base font-semibold">Generate Backlog JSON</h3>
            <textarea
              value={storyPrompt}
              onChange={(e) => setStoryPrompt(e.target.value)}
              className="input min-h-[88px]"
              placeholder="Describe goals, constraints, sprint targets, and delivery expectations"
            />
            <input
              value={moduleName}
              onChange={(e) => setModuleName(e.target.value)}
              className="input"
              placeholder="Module Name"
            />
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={() => generateStories.mutate()} disabled={generateStories.isPending || !storyPrompt.trim() || !moduleName.trim()}>
                {generateStories.isPending ? 'Generating...' : 'Generate JSON'}
              </button>
              <button className="btn-secondary" onClick={() => confirmPlannerDraft.mutate()} disabled={confirmPlannerDraft.isPending || !generatedJsonText.trim()}>
                {confirmPlannerDraft.isPending ? 'Confirming...' : 'Confirm and Push to Jira'}
              </button>
              <button className="btn-secondary" onClick={() => saveGenerated.mutate()} disabled={saveGenerated.isPending || !generatedResult}>
                Save Draft Only
              </button>
            </div>
            <textarea
              value={generatedJsonText}
              onChange={(e) => setGeneratedJsonText(e.target.value)}
              className="input min-h-[260px] font-mono text-xs"
              placeholder="Generated JSON (epics/stories/tasks/subtasks) appears here for editing"
            />
          </div>
        </div>
      )}

      {activeTab === 'workspace' && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <h3 className="text-base font-semibold">Jira Workspace</h3>
            <div className="flex flex-wrap gap-2">
              <select className="input max-w-[320px]" value={jiraProjectKey} onChange={(e) => setJiraProjectKey(e.target.value)}>
                <option value="">Select Jira project</option>
                {jiraProjects.map((jp) => (
                  <option key={jp.id || jp.key} value={jp.key}>{jp.key} - {jp.name}</option>
                ))}
              </select>
              <button className="btn-secondary" onClick={() => connectJira.mutate(jiraProjectKey)} disabled={connectJira.isPending || !jiraProjectKey}>
                Connect Jira Project
              </button>
              <button className="btn-secondary" onClick={() => pushToJira.mutate()} disabled={pushToJira.isPending || stories.length === 0}>
                Push Local to Jira
              </button>
              <button className="btn-secondary" onClick={() => syncFromJira.mutate()} disabled={syncFromJira.isPending}>
                Pull from Jira
              </button>
            </div>
            {autoDetectedKey && <p className="text-xs text-emerald-300">Auto-detected Jira project: {autoDetectedKey}</p>}
            {!autoDetectedKey && jiraProjects.length === 0 && (
              <p className="text-xs text-amber-300">No Jira projects detected. Save Jira credentials in Settings first.</p>
            )}
          </div>

          <div className="card p-4 space-y-3">
            <h3 className="text-base font-semibold">Backlog CRUD</h3>
            <div className="grid md:grid-cols-5 gap-2">
              <input className="input md:col-span-2" placeholder="Backlog title" value={newStory.title} onChange={(e) => setNewStory((s) => ({ ...s, title: e.target.value }))} />
              <select className="input" value={newStory.type} onChange={(e) => setNewStory((s) => ({ ...s, type: e.target.value }))}>
                <option value="story">story</option>
                <option value="task">task</option>
                <option value="bug">bug</option>
              </select>
              <select className="input" value={newStory.priority} onChange={(e) => setNewStory((s) => ({ ...s, priority: e.target.value }))}>
                <option value="highest">highest</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
                <option value="lowest">lowest</option>
              </select>
              <button className="btn-primary" onClick={() => createStory.mutate()} disabled={createStory.isPending || !newStory.title.trim()}>
                {createStory.isPending ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div className="card p-4">
              <h3 className="text-base font-semibold mb-2">Epics</h3>
              <ul className="space-y-2 text-sm text-slate-300 max-h-80 overflow-auto">
                {epics.map((epic) => (
                  <li key={epic._id} className="border border-slate-700 rounded-md p-2">
                    <p className="font-medium">{epic.title}</p>
                    <p className="text-xs text-slate-400">{epic.pushedToJira ? epic.jiraEpicKey || 'Pushed' : 'Not pushed'}</p>
                  </li>
                ))}
                {epics.length === 0 && <li className="text-slate-400">No epics yet.</li>}
              </ul>
            </div>

            <div className="card p-4">
              <h3 className="text-base font-semibold mb-2">Stories / Tasks / Subtasks</h3>
              <ul className="space-y-2 text-sm text-slate-300 max-h-80 overflow-auto">
                {stories.map((story) => {
                  const editing = editingStoryId === story._id
                  return (
                    <li key={story._id} className="border border-slate-700 rounded-md p-2 space-y-2">
                      {editing ? (
                        <>
                          <input className="input" value={editingDraft.title} onChange={(e) => setEditingDraft((s) => ({ ...s, title: e.target.value }))} />
                          <div className="grid grid-cols-3 gap-2">
                            <select className="input" value={editingDraft.status} onChange={(e) => setEditingDraft((s) => ({ ...s, status: e.target.value }))}>
                              <option value="draft">draft</option>
                              <option value="approved">approved</option>
                              <option value="to_do">to_do</option>
                              <option value="in_progress">in_progress</option>
                              <option value="in_review">in_review</option>
                              <option value="done">done</option>
                              <option value="cancelled">cancelled</option>
                            </select>
                            <select className="input" value={editingDraft.priority} onChange={(e) => setEditingDraft((s) => ({ ...s, priority: e.target.value }))}>
                              <option value="highest">highest</option>
                              <option value="high">high</option>
                              <option value="medium">medium</option>
                              <option value="low">low</option>
                              <option value="lowest">lowest</option>
                            </select>
                            <select className="input" value={editingDraft.sprint} onChange={(e) => setEditingDraft((s) => ({ ...s, sprint: e.target.value }))}>
                              <option value="backlog">backlog</option>
                              <option value="S1">S1</option>
                              <option value="S2">S2</option>
                              <option value="S3">S3</option>
                              <option value="S4">S4</option>
                            </select>
                          </div>
                          <div className="flex gap-2">
                            <button className="btn-primary btn-sm" onClick={() => updateStory.mutate()} disabled={updateStory.isPending}>Save</button>
                            <button className="btn-secondary btn-sm" onClick={() => setEditingStoryId('')}>Cancel</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p className="font-medium">{story.title}</p>
                          <p className="text-xs text-slate-400">{story.type} • {story.status} • {story.priority} • {story.pushedToJira ? (story.jiraIssueKey || 'Pushed') : 'Not pushed'}</p>
                          <div className="flex gap-2">
                            <button
                              className="btn-secondary btn-sm"
                              onClick={() => {
                                setEditingStoryId(story._id)
                                setEditingDraft({
                                  title: story.title,
                                  status: story.status || 'approved',
                                  priority: story.priority || 'medium',
                                  sprint: story.sprint || 'backlog',
                                })
                              }}
                            >
                              Edit
                            </button>
                            <button className="btn-secondary btn-sm" onClick={() => deleteStory.mutate(story._id)} disabled={deleteStory.isPending}>Delete</button>
                          </div>
                        </>
                      )}
                    </li>
                  )
                })}
                {stories.length === 0 && <li className="text-slate-400">No stories yet.</li>}
              </ul>
            </div>
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold">Git Activity Snapshot</h3>
              <button className="btn-secondary" onClick={() => refreshCommits.mutate()} disabled={refreshCommits.isPending}>Refresh</button>
            </div>
            <p className="text-sm text-slate-300">Recent commits: {commits.length}</p>
          </div>
        </div>
      )}

      {activeTab === 'progress' && (
        <div className="space-y-3">
          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">AI System Summary</h3>
            <p className="text-sm text-slate-300 leading-relaxed">{insights?.summary || 'No AI summary generated yet.'}</p>
            <div className="grid sm:grid-cols-4 gap-2 mt-3 text-sm">
              <MiniStat label="Done" value={stories.filter((s) => s.status === 'done').length} />
              <MiniStat label="In Progress" value={stories.filter((s) => s.status === 'in_progress').length} />
              <MiniStat label="AI Done" value={stories.filter((s) => s.codeStatus === 'done').length} />
              <MiniStat label="AI Partial" value={stories.filter((s) => s.codeStatus === 'partial').length} />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div className="card p-4">
              <h3 className="text-base font-semibold mb-2">Sprint-wise Progress</h3>
              <ul className="space-y-2 text-sm text-slate-300 max-h-80 overflow-auto">
                {sprintRows.map((row) => (
                  <li key={row.sprint} className="border border-slate-700 rounded-md p-2">
                    <p className="font-medium">{row.sprint}</p>
                    <p className="text-xs text-slate-400">{row.done}/{row.total} done • {row.inProgress} in progress • {row.completion}% complete</p>
                  </li>
                ))}
                {sprintRows.length === 0 && <li className="text-slate-400">No sprint data.</li>}
              </ul>
            </div>

            <div className="card p-4">
              <h3 className="text-base font-semibold mb-2">Issue-wise Progress</h3>
              <ul className="space-y-2 text-sm text-slate-300 max-h-80 overflow-auto">
                {issueRows.map((issue) => (
                  <li key={issue.id} className="border border-slate-700 rounded-md p-2">
                    <p className="font-medium">{issue.title}</p>
                    <p className="text-xs text-slate-400">Sprint: {issue.sprint} • Status: {issue.status} • AI: {issue.codeStatus} • Updated: {displayDate(issue.updatedAt)}</p>
                  </li>
                ))}
                {issueRows.length === 0 && <li className="text-slate-400">No issue data.</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

function Card({ title, value }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-slate-400">{title}</p>
      <p className="text-2xl font-bold text-slate-100">{value}</p>
    </div>
  )
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-md border border-slate-700 px-2 py-1.5">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-sm text-slate-100">{value}</p>
    </div>
  )
}
