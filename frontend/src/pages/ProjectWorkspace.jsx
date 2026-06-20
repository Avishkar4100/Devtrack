import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
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

const progressBarClass = (tone = 'indigo') => {
  if (tone === 'emerald') return 'bg-emerald-500/80'
  if (tone === 'amber') return 'bg-amber-500/80'
  if (tone === 'rose') return 'bg-rose-500/80'
  return 'bg-indigo-500/80'
}

const truncateText = (value, max = 88) => {
  const text = String(value || '').trim()
  if (!text) return 'Untitled activity'
  return text.length > max ? `${text.slice(0, max - 1)}...` : text
}

const jiraTypeMeta = (issueType = '') => {
  const normalized = String(issueType || '').toLowerCase()
  if (normalized.includes('epic')) return { symbol: '⚡', label: 'Epic' }
  if (normalized.includes('story')) return { symbol: '📘', label: 'Story' }
  if (normalized.includes('task')) return { symbol: '✅', label: 'Task' }
  if (normalized.includes('bug')) return { symbol: '🐞', label: 'Bug' }
  if (normalized.includes('sub')) return { symbol: '🔧', label: 'Sub-task' }
  return { symbol: '🧩', label: issueType || 'Issue' }
}

const getActivityVisual = (item = {}) => {
  if (item.source === 'Jira') {
    return {
      cardClass: 'border-sky-700/70 bg-sky-900/20',
      badgeClass: 'bg-sky-500/20 border-sky-500/40 text-sky-200',
      symbol: item.symbol || '🧩',
      label: item.typeLabel || 'Jira',
    }
  }
  if (item.source === 'GitHub') {
    return {
      cardClass: 'border-emerald-700/70 bg-emerald-900/20',
      badgeClass: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200',
      symbol: '⎇',
      label: 'Commit',
    }
  }
  return {
    cardClass: 'border-violet-700/70 bg-violet-900/20',
    badgeClass: 'bg-violet-500/20 border-violet-500/40 text-violet-200',
    symbol: '◆',
    label: 'Platform',
  }
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

  const { data: projectAudit = [] } = useQuery({
    queryKey: ['project-audit', id],
    enabled: hasProjectContext,
    queryFn: async () => (await api.get(`/projects/${id}/audit`)).data.data || [],
  })

  const { data: projectCommits = [] } = useQuery({
    queryKey: ['project-commits', id],
    enabled: hasProjectContext,
    queryFn: async () => (await api.get(`/github/commits/${id}`, { params: { fetchAll: true } })).data.data || [],
  })

  const { data: jiraIssues = [] } = useQuery({
    queryKey: ['project-jira-issues', id, project?.jiraProjectKey],
    enabled: hasProjectContext && Boolean(project?.jiraProjectKey),
    queryFn: async () => (
      await api.get('/jira/server/issues', {
        params: {
          projectKey: project?.jiraProjectKey,
          fetchAll: true,
          maxResults: 100,
        },
      })
    ).data.data?.issues || [],
  })

  const {
    data: scrumMarkdownInsights,
    isFetching: loadingScrumMarkdown,
    refetch: loadScrumMarkdownInsights,
  } = useQuery({
    queryKey: ['project-scrum-markdown-insights', id],
    enabled: false,
    queryFn: async () => (await api.get(`/insights/${id}/scrum-markdown`)).data.data,
  })

  const handleLoadScrumMarkdown = async () => {
    try {
      const result = await loadScrumMarkdownInsights()
      if (result?.isError || result?.status === 'error') {
        throw result?.error || new Error('Failed to load AI snapshot')
      }
      toast.success('AI snapshot loaded')
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to load AI snapshot')
    }
  }

  const recentJiraActivities = useMemo(() => {
    return [...jiraIssues]
      .sort((a, b) => new Date(b?.fields?.updated || 0) - new Date(a?.fields?.updated || 0))
      .slice(0, 8)
      .map((issue) => {
        const issueType = issue.fields?.issuetype?.name || 'Issue'
        const meta = jiraTypeMeta(issueType)
        return ({
        id: issue.id || issue.key,
        title: truncateText(issue.fields?.summary || issue.key, 80),
        subtitle: `${issue.key} • ${issue.fields?.status?.name || 'Unknown'} • ${issue.fields?.assignee?.displayName || 'Unassigned'}`,
        date: issue.fields?.updated || issue.fields?.created,
        tone: issue.fields?.status?.statusCategory?.key === 'done' ? 'done' : 'active',
        source: 'Jira',
        issueType,
        symbol: meta.symbol,
        typeLabel: meta.label,
      })
      })
  }, [jiraIssues])

  const recentGithubActivities = useMemo(() => {
    return [...projectCommits]
      .sort((a, b) => new Date(b?.commit?.author?.date || b?.commit?.committer?.date || b?.date || 0) - new Date(a?.commit?.author?.date || a?.commit?.committer?.date || a?.date || 0))
      .slice(0, 8)
      .map((commit) => ({
        id: commit.sha,
        title: truncateText(commit.commit?.message || commit.message || 'Commit', 72),
        subtitle: `${(commit.sha || '').slice(0, 8)} • ${commit.commit?.author?.name || commit.author || 'Unknown author'}`,
        date: commit.commit?.author?.date || commit.commit?.committer?.date || commit.date,
        tone: 'code',
        source: 'GitHub',
      }))
  }, [projectCommits])

  const recentPlatformActivities = useMemo(() => {
    return [...projectAudit]
      .sort((a, b) => new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0))
      .slice(0, 10)
      .map((entry) => ({
        id: entry._id,
        title: truncateText(entry.action || 'Activity', 60),
        subtitle: `${entry.entity || 'platform'} • ${entry.user?.name || 'System'}`,
        date: entry.createdAt,
        tone: 'platform',
        source: 'Platform',
      }))
  }, [projectAudit])

  const combinedActivities = useMemo(() => (
    [...recentJiraActivities, ...recentGithubActivities, ...recentPlatformActivities]
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .slice(0, 18)
  ), [recentJiraActivities, recentGithubActivities, recentPlatformActivities])

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
            <Card title="Recent Jira" value={recentJiraActivities.length} />
            <Card title="Recent GitHub" value={recentGithubActivities.length} />
            <Card title="Platform Logs" value={recentPlatformActivities.length} />
            <Card title="Total Combined" value={combinedActivities.length} />
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-base font-semibold">Recent Activity Feed</h3>
              <p className="text-xs text-slate-400">Jira, GitHub, and DevTrack platform events in one feed</p>
            </div>
            <ul className="space-y-2 text-sm max-h-[18rem] overflow-auto pr-1">
              {combinedActivities.map((item) => {
                const visual = getActivityVisual(item)
                return (
                <li key={`${item.source}-${item.id}`} className={`rounded-md border p-2.5 ${visual.cardClass}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm leading-none">{visual.symbol}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-semibold uppercase tracking-wide ${visual.badgeClass}`}>{visual.label}</span>
                      </div>
                      <p className="font-medium text-slate-100 mt-1.5 leading-tight">{truncateText(item.title, 90)}</p>
                      <p className="text-xs text-slate-400 mt-1 leading-tight">{truncateText(item.subtitle, 92)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500">{item.source}</p>
                      <p className="text-xs text-slate-400">{displayDate(item.date)}</p>
                    </div>
                  </div>
                </li>
              )})}
              {combinedActivities.length === 0 && <li className="text-slate-400">No recent activity found yet.</li>}
            </ul>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <div className="card p-4">
              <h3 className="text-base font-semibold mb-2">Recent Jira Activities</h3>
              <ul className="space-y-2 text-sm max-h-72 overflow-auto pr-1">
                {recentJiraActivities.map((item) => (
                  <li key={item.id} className="rounded-md border border-sky-700/70 p-2 bg-sky-900/20">
                    <div className="flex items-center gap-2">
                      <span className="text-sm leading-none">{item.symbol || '🧩'}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md border bg-sky-500/20 border-sky-500/40 text-sky-200 font-semibold uppercase tracking-wide">{item.typeLabel || item.issueType || 'Issue'}</span>
                    </div>
                    <p className="font-medium text-slate-100 mt-1.5 leading-tight">{truncateText(item.title, 72)}</p>
                    <p className="text-xs text-slate-400 mt-1 leading-tight">{truncateText(item.subtitle, 84)}</p>
                    <p className="text-xs text-slate-500 mt-1">{displayDate(item.date)}</p>
                  </li>
                ))}
                {recentJiraActivities.length === 0 && <li className="text-slate-400">No Jira activity available.</li>}
              </ul>
            </div>

            <div className="card p-4">
              <h3 className="text-base font-semibold mb-2">Recent GitHub Activities</h3>
              <ul className="space-y-2 text-sm max-h-72 overflow-auto pr-1">
                {recentGithubActivities.map((item) => (
                  <li key={item.id} className="rounded-md border border-emerald-700/70 p-2 bg-emerald-900/20">
                    <div className="flex items-center gap-2">
                      <span className="text-sm leading-none">⎇</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md border bg-emerald-500/20 border-emerald-500/40 text-emerald-200 font-semibold uppercase tracking-wide">Commit</span>
                    </div>
                    <p className="font-medium text-slate-100 mt-1.5 leading-tight">{truncateText(item.title, 72)}</p>
                    <p className="text-xs text-slate-400 mt-1 leading-tight">{truncateText(item.subtitle, 84)}</p>
                    <p className="text-xs text-slate-500 mt-1">{displayDate(item.date)}</p>
                  </li>
                ))}
                {recentGithubActivities.length === 0 && <li className="text-slate-400">No GitHub activity available.</li>}
              </ul>
            </div>

            <div className="card p-4">
              <h3 className="text-base font-semibold mb-2">Platform Activities</h3>
              <ul className="space-y-2 text-sm max-h-72 overflow-auto pr-1">
                {recentPlatformActivities.map((item) => (
                  <li key={item.id} className="rounded-md border border-violet-700/70 p-2 bg-violet-900/20">
                    <div className="flex items-center gap-2">
                      <span className="text-sm leading-none">◆</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md border bg-violet-500/20 border-violet-500/40 text-violet-200 font-semibold uppercase tracking-wide">Platform</span>
                    </div>
                    <p className="font-medium text-slate-100 mt-1.5 leading-tight">{truncateText(item.title, 72)}</p>
                    <p className="text-xs text-slate-400 mt-1 leading-tight">{truncateText(item.subtitle, 84)}</p>
                    <p className="text-xs text-slate-500 mt-1">{displayDate(item.date)}</p>
                  </li>
                ))}
                {recentPlatformActivities.length === 0 && <li className="text-slate-400">No platform activity available.</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'progress' && (
        <div className="space-y-3">
          <div className="card p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-base font-semibold">Delivery Snapshot AI Insights</h3>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={handleLoadScrumMarkdown}
                disabled={loadingScrumMarkdown}
              >
                {loadingScrumMarkdown ? 'Loading...' : 'Load AI Snapshot'}
              </button>
            </div>
            <p className="text-xs text-slate-400">Execution-first dashboard from Jira backlog + commit history</p>
            <div className="grid sm:grid-cols-3 gap-3 mt-3 text-sm">
              <ProgressMetric
                label="Done"
                value={scrumMarkdownInsights?.totals?.done || 0}
                total={scrumMarkdownInsights?.totals?.total || 0}
                percent={scrumMarkdownInsights?.totals?.completionPct || 0}
                tone="emerald"
              />
              <ProgressMetric
                label="In Progress"
                value={scrumMarkdownInsights?.totals?.inProgress || 0}
                total={scrumMarkdownInsights?.totals?.total || 0}
                percent={
                  (scrumMarkdownInsights?.totals?.total || 0)
                    ? Math.round(((scrumMarkdownInsights?.totals?.inProgress || 0) / (scrumMarkdownInsights?.totals?.total || 1)) * 100)
                    : 0
                }
                tone="amber"
              />
              <ProgressMetric
                label="Not Started"
                value={scrumMarkdownInsights?.totals?.notStarted || 0}
                total={scrumMarkdownInsights?.totals?.total || 0}
                percent={
                  (scrumMarkdownInsights?.totals?.total || 0)
                    ? Math.round(((scrumMarkdownInsights?.totals?.notStarted || 0) / (scrumMarkdownInsights?.totals?.total || 1)) * 100)
                    : 0
                }
                tone="rose"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-2 mt-3 text-xs">
              <div className="rounded-md border border-slate-700 p-2 bg-slate-900/40">Comment Coverage: <strong>{scrumMarkdownInsights?.totals?.commentCoveragePct || 0}%</strong></div>
              <div className="rounded-md border border-slate-700 p-2 bg-slate-900/40">Done Commit Trace Coverage: <strong>{scrumMarkdownInsights?.totals?.commitCoveragePct || 0}%</strong></div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <div className="card p-4">
              <h3 className="text-base font-semibold mb-2">Done Issues</h3>
              <ul className="space-y-2 text-sm text-slate-300 max-h-80 overflow-auto pr-1">
                {(scrumMarkdownInsights?.doneIssues || []).map((issue) => (
                  <li key={issue.key} className="border border-emerald-700/70 rounded-md p-2 bg-emerald-900/20">
                    <p className="font-medium text-slate-100">{issue.key} - {issue.title}</p>
                    <p className="text-xs text-slate-400 mt-1">Owner: {issue.assignee} • Epic: {issue.epic}</p>
                    <p className="text-xs text-slate-400">Commits: {issue.linkedCommitCount} • Comments: {issue.commentsCount}</p>
                  </li>
                ))}
                {(scrumMarkdownInsights?.doneIssues || []).length === 0 && <li className="text-slate-400">No done issues yet.</li>}
              </ul>
            </div>

            <div className="card p-4">
              <h3 className="text-base font-semibold mb-2">In Progress Issues</h3>
              <ul className="space-y-2 text-sm text-slate-300 max-h-80 overflow-auto pr-1">
                {(scrumMarkdownInsights?.inProgressIssues || []).map((issue) => (
                  <li key={issue.key} className="border border-amber-700/70 rounded-md p-2 bg-amber-900/20">
                    <p className="font-medium text-slate-100">{issue.key} - {issue.title}</p>
                    <p className="text-xs text-slate-400 mt-1">Owner: {issue.assignee} • Priority: {issue.priority}</p>
                  </li>
                ))}
                {(scrumMarkdownInsights?.inProgressIssues || []).length === 0 && <li className="text-slate-400">No in-progress issues.</li>}
              </ul>
            </div>

            <div className="card p-4">
              <h3 className="text-base font-semibold mb-2">Not Started Issues</h3>
              <ul className="space-y-2 text-sm text-slate-300 max-h-80 overflow-auto pr-1">
                {(scrumMarkdownInsights?.notStartedIssues || []).map((issue) => (
                  <li key={issue.key} className="border border-rose-700/70 rounded-md p-2 bg-rose-900/20">
                    <p className="font-medium text-slate-100">{issue.key} - {issue.title}</p>
                    <p className="text-xs text-slate-400 mt-1">Owner: {issue.assignee} • Priority: {issue.priority}</p>
                  </li>
                ))}
                {(scrumMarkdownInsights?.notStartedIssues || []).length === 0 && <li className="text-slate-400">No not-started issues.</li>}
              </ul>
            </div>
          </div>

          <div className="card p-4">
            <h3 className="text-base font-semibold mb-2">AI Scrum Master HTML Dashboard</h3>
            {loadingScrumMarkdown ? (
              <p className="text-sm text-slate-400">Generating HTML insights...</p>
            ) : (
              <div className="rounded-md border border-slate-700 p-3 bg-slate-900/40 max-h-[34rem] overflow-auto">
                <div
                  className="min-w-[320px]"
                  dangerouslySetInnerHTML={{
                    __html: scrumMarkdownInsights?.dashboardHtml || '<div class="text-sm text-slate-300">Click "Load AI Snapshot" to generate the dashboard.</div>',
                  }}
                />
              </div>
            )}
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

function ProgressMetric({ label, value, total, percent, tone }) {
  const safePercent = Math.max(0, Math.min(100, Number(percent || 0)))
  return (
    <div className="rounded-md border border-slate-700 p-2 bg-slate-900/40">
      <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
        <span>{label}</span>
        <span>{value}/{total}</span>
      </div>
      <div className="h-2 rounded bg-slate-800 overflow-hidden">
        <div className={`h-full ${progressBarClass(tone)}`} style={{ width: `${safePercent}%` }} />
      </div>
      <p className="text-xs text-slate-300 mt-1">{safePercent}%</p>
    </div>
  )
}
