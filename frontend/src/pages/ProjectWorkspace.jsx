import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import api from '@/lib/api'
import { useProjectStore } from '@/store/projectStore'
import { useWorkspaceStateStore } from '@/store/workspaceStateStore'

const TABS = [
  { id: 'overview', label: 'Project Overview' },
  { id: 'progress', label: 'Delivery Snapshot' },
]

const isTabAllowed = (tabId) => TABS.some((tab) => tab.id === tabId)

const displayDate = (value) => {
  if (!value) return 'N/A'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

export default function ProjectWorkspacePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const setSelectedProjectId = useProjectStore((state) => state.setSelectedProjectId)
  const setSelectedJiraProjectKey = useProjectStore((state) => state.setSelectedJiraProjectKey)

  const workspaceStorageKey = id || '__fallback__'
  const workspaceHydrated = useWorkspaceStateStore((state) => state.hydrated)
  const persistedWorkspace = useWorkspaceStateStore((state) => state.projectWorkspaceByProject[workspaceStorageKey])
  const setProjectWorkspaceState = useWorkspaceStateStore((state) => state.setProjectWorkspaceState)

  const [activeTab, setActiveTab] = useState('overview')
  const workspaceLoadedKeyRef = useRef('')

  useEffect(() => {
    if (!workspaceHydrated) return
    if (workspaceLoadedKeyRef.current === workspaceStorageKey) return

    workspaceLoadedKeyRef.current = workspaceStorageKey
    const snapshot = persistedWorkspace || {}
    const savedTab = snapshot.activeTab || 'overview'
    setActiveTab(isTabAllowed(savedTab) ? savedTab : 'overview')
  }, [workspaceHydrated, workspaceStorageKey, persistedWorkspace])

  useEffect(() => {
    if (isTabAllowed(activeTab)) return
    setActiveTab('overview')
  }, [activeTab])

  useEffect(() => {
    if (!workspaceHydrated) return
    if (workspaceLoadedKeyRef.current !== workspaceStorageKey) return

    setProjectWorkspaceState(workspaceStorageKey, { activeTab })
  }, [workspaceHydrated, workspaceStorageKey, activeTab, setProjectWorkspaceState])

  const {
    data: project,
    isLoading: loadingProject,
    isError: projectLoadError,
    error: projectError,
  } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => (await api.get(`/projects/${id}`)).data.data,
    retry: false,
  })

  const hasProjectContext = Boolean(project?._id)

  const { data: dashboard } = useQuery({
    queryKey: ['dashboard', id],
    enabled: hasProjectContext,
    queryFn: async () => (await api.get(`/dashboard/${id}`)).data.data,
  })

  const { data: controlTower } = useQuery({
    queryKey: ['control-tower', id],
    enabled: hasProjectContext,
    queryFn: async () => (await api.get(`/dashboard/${id}/control-tower`)).data.data,
  })

  const { data: stories = [] } = useQuery({
    queryKey: ['stories', id],
    enabled: hasProjectContext,
    queryFn: async () => (await api.get(`/stories/project/${id}`)).data.data,
  })

  const { data: insights } = useQuery({
    queryKey: ['insights', id],
    enabled: hasProjectContext,
    queryFn: async () => (await api.get(`/insights/${id}`)).data.data,
  })

  const projectRisk = useMemo(() => {
    const riskStatus = controlTower?.toolHealth?.find((item) => item.name === 'GitHub Commit Validator')?.status
    if (riskStatus === 'risk') return 'High'
    if (riskStatus === 'watch') return 'Medium'
    return 'Low'
  }, [controlTower])

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

  const issueRows = useMemo(() => stories.map((s) => ({
    id: s._id,
    title: s.title,
    sprint: s.sprint || 'backlog',
    status: s.status,
    codeStatus: s.codeStatus || 'not_started',
    updatedAt: s.updatedAt,
  })), [stories])

  if (loadingProject) return <div className="p-6">Loading workspace...</div>
  if (projectLoadError) {
    return (
      <div className="p-6 text-rose-300">
        Failed to load project workspace: {projectError?.response?.data?.message || projectError?.message || 'Unknown error'}
      </div>
    )
  }
  if (!project) return <div className="p-6">Project not found.</div>

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{project.name}</h1>
          <p className="text-sm text-slate-400">Project hub with context and delivery signals</p>
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <button
            className="btn-primary"
            onClick={() => {
              setSelectedProjectId(project._id)
              if (project.jiraProjectKey) setSelectedJiraProjectKey(project.jiraProjectKey)
              navigate('/ai-planner')
            }}
          >
            Open AI Planner
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              setSelectedProjectId(project._id)
              if (project.jiraProjectKey) setSelectedJiraProjectKey(project.jiraProjectKey)
              navigate('/workspace')
            }}
          >
            Open Workspace
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              setSelectedProjectId(project._id)
              navigate('/insights')
            }}
          >
            Open Delivery Insights
          </button>
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
        <div className="space-y-3">
          <div className="grid md:grid-cols-4 gap-3">
            <Card title="Sprint Progress" value={`${dashboard?.activeSprint?.completionPercentage ?? project.completionPercentage ?? 0}%`} />
            <Card title="Open Stories" value={openStories} />
            <Card title="Risk" value={projectRisk} />
            <Card title="Commit Mapped" value={`${controlTower?.kpis?.commitMappedPct ?? 0}%`} />
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div className="card p-4">
              <h3 className="text-base font-semibold mb-2">Control Tower KPIs</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md border border-slate-700 p-2">AI Issues Created: <strong>{controlTower?.kpis?.aiIssuesCreated ?? 0}</strong></div>
                <div className="rounded-md border border-slate-700 p-2">Jira Sync: <strong>{controlTower?.kpis?.jiraSyncSuccessPct ?? 0}%</strong></div>
                <div className="rounded-md border border-slate-700 p-2">Validation Trend (latest): <strong>{(controlTower?.validationTrend || []).slice(-1)[0] ?? 0}%</strong></div>
                <div className="rounded-md border border-slate-700 p-2">Standup Time Saved: <strong>{controlTower?.kpis?.standupTimeSavedHours ?? 0}h/week</strong></div>
              </div>
            </div>

            <div className="card p-4">
              <h3 className="text-base font-semibold mb-2">Tool Health</h3>
              <ul className="space-y-2 text-sm">
                {(controlTower?.toolHealth || []).map((tool) => (
                  <li key={tool.name} className="rounded-md border border-slate-700 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <strong>{tool.name}</strong>
                      <span className="text-xs uppercase text-slate-300">{tool.status}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{tool.detail}</p>
                  </li>
                ))}
                {(!controlTower?.toolHealth || controlTower.toolHealth.length === 0) && (
                  <li className="text-slate-400">No tool health data yet.</li>
                )}
              </ul>
            </div>
          </div>

          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">Engineering Signals</h3>
            <ul className="list-disc pl-5 text-sm text-slate-300 space-y-1">
              {(controlTower?.engineeringSignals || []).map((signal) => (
                <li key={signal}>{signal}</li>
              ))}
            </ul>
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
                    <p className="text-xs text-slate-400">{row.done}/{row.total} done  {row.inProgress} in progress  {row.completion}% complete</p>
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
                    <p className="text-xs text-slate-400">Sprint: {issue.sprint}  Status: {issue.status}  AI: {issue.codeStatus}  Updated: {displayDate(issue.updatedAt)}</p>
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
