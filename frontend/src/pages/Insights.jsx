import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '@/lib/api'
import { useProjectStore } from '@/store/projectStore'
import PageErrorBoundary from '@/components/PageErrorBoundary'
import DataErrorBoundary from '@/components/DataErrorBoundary'

const toNum = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const percentValue = (value) => {
  const n = toNum(String(value ?? '').replace(/[^\d.]/g, ''), 0)
  return `${Math.max(0, Math.min(100, Math.round(n)))}%`
}

const riskTone = (risk = 'low') => {
  const normalized = String(risk).toLowerCase()
  if (normalized === 'high') return 'text-red-400'
  if (normalized === 'medium') return 'text-amber-300'
  return 'text-emerald-300'
}

const polylinePoints = (values, width, height, padding) => {
  if (!values.length) return ''
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = Math.max(max - min, 1)
  return values
    .map((v, idx) => {
      const x = padding + ((width - padding * 2) * idx) / Math.max(values.length - 1, 1)
      const y = padding + ((max - v) / span) * (height - padding * 2)
      return `${x},${y}`
    })
    .join(' ')
}

export default function InsightsPage() {
  return (
    <PageErrorBoundary pageName="Insights">
      <DataErrorBoundary pageName="Insights">
        <InsightsContent />
      </DataErrorBoundary>
    </PageErrorBoundary>
  )
}

function InsightsContent() {
  const {
    projects: storeProjects,
    selectedProjectId,
    selectedJiraProjectKey,
    setSelectedProjectId,
    setSelectedJiraProjectKey,
  } = useProjectStore()

  const [overviewSummary, setOverviewSummary] = useState(null)
  const [projectInsights, setProjectInsights] = useState(null)
  const [loadedProjectId, setLoadedProjectId] = useState('')

  const loadInsights = useMutation({
    mutationFn: async () => {
      const projectId = selectedProjectId
      const overviewPromise = api.get('/dashboard/overview-summary')
      const projectPromise = projectId
        ? api.get(`/insights/${projectId}`)
        : Promise.resolve(null)

      const [overviewResponse, projectResponse] = await Promise.all([overviewPromise, projectPromise])
      return {
        overview: overviewResponse?.data?.data || null,
        project: projectResponse?.data?.data || null,
        projectId,
      }
    },
    onError: (err) => {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to load AI insights')
    },
    onSuccess: ({ overview, project, projectId }) => {
      setOverviewSummary(overview)
      setProjectInsights(project)
      setLoadedProjectId(projectId || '')
      if (!selectedProjectId && overview?.selectedProjectId) {
        setSelectedProjectId(overview.selectedProjectId)
        setSelectedJiraProjectKey(overview.selectedJiraProjectKey || '')
      }
    },
  })

  const { data: jiraIssues = [] } = useQuery({
    queryKey: ['insights-jira-issues', selectedJiraProjectKey],
    enabled: !!selectedJiraProjectKey,
    queryFn: async () => (await api.get('/jira/server/issues', {
      params: { projectKey: selectedJiraProjectKey, maxResults: 40 },
    })).data.data?.issues || [],
  })

  const projects = overviewSummary?.projects || storeProjects || []
  const globalSummary = overviewSummary?.summary

  const rows = useMemo(() => {
    return projects.map((p) => {
      const progress = p.completionPercentage || 0
      const risk = p.risk || 'low'
      return {
        id: p._id,
        name: p.name,
        progress,
        risk,
        openStories: Math.max((p.totalStories || 0) - (p.completedStories || 0), 0),
      }
    })
  }, [projects])

  const overall = projectInsights?.overall || []
  const dailyReport = projectInsights?.dailyReport || []
  const moduleWise = projectInsights?.moduleWise || []
  const issueWise = projectInsights?.issueWise || []
  const teamInsights = projectInsights?.teamInsights || []
  const dailySummary = projectInsights?.dailySummary || []
  const risks = projectInsights?.risks || []
  const executive = projectInsights?.executiveSummary || null

  const dailyTrend = useMemo(() => {
    const created = dailyReport.map((row) => toNum(row.created))
    const completed = dailyReport.map((row) => toNum(row.completed))
    return { created, completed }
  }, [dailyReport])

  const jiraIssueRows = useMemo(() => {
    const mapped = jiraIssues.map((issue) => ({
      id: issue.key,
      title: issue.fields?.summary || 'Untitled issue',
      owner: issue.fields?.assignee?.displayName || 'Unassigned',
      status: issue.fields?.status?.name || 'Unknown',
      severity: issue.fields?.priority?.name || issue.fields?.issuetype?.name || 'Medium',
      eta: issue.fields?.duedate || issue.fields?.updated || '-',
    }))
    return mapped.slice(0, 8)
  }, [jiraIssues])

  const finalIssueRows = jiraIssueRows.length ? jiraIssueRows : issueWise

  const executiveRows = useMemo(() => {
    const fromExecutive = executive
      ? [
          { indicator: 'Automation Coverage', value: executive.automationCoverage || '-', trend: 'Up', meaning: 'Higher AI issue conversion in active stream' },
          { indicator: 'Validation Trust', value: executive.validationTrust || '-', trend: 'Up', meaning: 'More commits linked to accepted stories' },
          { indicator: 'Sync Reliability', value: executive.syncReliability || '-', trend: 'Stable', meaning: 'Lower Jira sync drift across boards' },
          { indicator: 'Standup Overhead', value: executive.standupOverhead || '-', trend: 'Down', meaning: 'Fewer manual status collection meetings' },
        ]
      : []
    return fromExecutive
  }, [executive])

  const hasGlobalInsights = Boolean(overviewSummary)
  const hasProjectInsights = Boolean(projectInsights && loadedProjectId === selectedProjectId)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[34px] font-bold tracking-tight text-slate-100">Insights</h1>
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={() => loadInsights.mutate()}
          disabled={loadInsights.isPending}
        >
          {loadInsights.isPending ? 'Loading AI Insights...' : 'Load AI Insights'}
        </button>
      </div>

      <div className="card p-4">
        <h2 className="text-base font-semibold mb-3 text-slate-100">Project Risk Board</h2>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-400 border-b border-slate-700">
              <tr>
                <th className="py-2 pr-3">Project</th>
                <th className="py-2 pr-3">Progress</th>
                <th className="py-2 pr-3">Risk</th>
                <th className="py-2 pr-3">Open Stories</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-800/70">
                  <td className="py-2 pr-3">
                    <Link
                      to={`/projects/${row.id}`}
                      className="text-indigo-300 hover:text-indigo-200"
                      onClick={() => setSelectedProjectId(row.id)}
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">{row.progress}%</td>
                  <td className="py-2 pr-3 capitalize">{row.risk}</td>
                  <td className="py-2 pr-3">{row.openStories}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-slate-400">No project data yet. Click "Load AI Insights" to generate it.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!hasGlobalInsights && (
        <div className="card p-4 text-sm text-slate-400">
          AI insights are loaded manually now. Use the button above to generate the project summary and delivery breakdown.
        </div>
      )}

      {hasProjectInsights && !!selectedProjectId && (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {overall.map((metric) => (
              <div key={metric.label} className="card p-4 rounded-xl border border-slate-700/80">
                <p className="text-xs text-slate-400">{metric.label}</p>
                <p className="text-[40px] font-bold leading-none text-slate-100 mt-2">{metric.value}</p>
                <p className="text-xs text-slate-400 mt-2">{metric.note}</p>
              </div>
            ))}
            {!overall.length && (
              <div className="card p-4 md:col-span-2 xl:col-span-4 text-sm text-slate-400">No enriched metrics found for this project yet.</div>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
            <div className="card p-4 rounded-xl border border-slate-700/80">
              <h2 className="text-[28px] font-bold tracking-tight text-slate-100">Delivery and Flow Intelligence</h2>
              <p className="text-sm text-slate-400 mt-1">Compare issue intake vs completion and catch flow slippage early.</p>

              <div className="mt-4 rounded-lg border border-slate-700/80 p-3">
                <p className="text-sm font-semibold text-slate-200 mb-2">Throughput vs Intake ({dailyReport.length} cycles)</p>
                <svg viewBox="0 0 380 180" className="w-full h-[180px]">
                  {[0, 1, 2, 3, 4].map((idx) => {
                    const y = 20 + idx * 35
                    return (
                      <line key={idx} x1="24" y1={y} x2="356" y2={y} stroke="rgba(148,163,184,0.2)" />
                    )
                  })}
                  <polyline
                    points={polylinePoints(dailyTrend.created, 380, 180, 24)}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="3"
                  />
                  <polyline
                    points={polylinePoints(dailyTrend.completed, 380, 180, 24)}
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth="3"
                  />
                </svg>
                <div className="flex flex-wrap gap-4 text-xs text-slate-300 mt-2">
                  <span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" />Issues created</span>
                  <span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />Issues completed</span>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-3 mt-3">
                <div className="rounded-lg border border-slate-700/80 p-3 bg-slate-900/30">
                  <p className="text-sm font-semibold text-slate-100 mb-1">Current Risk Radar</p>
                  {risks.length ? (
                    <ul className="space-y-1 text-sm text-slate-300">
                      {risks.map((risk, idx) => <li key={`${risk}-${idx}`}>{risk}</li>)}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-400">No risk items flagged.</p>
                  )}
                </div>
                <div className="rounded-lg border border-slate-700/80 p-3 bg-slate-900/30">
                  <p className="text-sm font-semibold text-slate-100 mb-2">Auto Daily Summary</p>
                  <div className="flex flex-wrap gap-2">
                    {dailySummary.map((entry) => (
                      <span key={entry} className="px-2 py-1 rounded-full border border-slate-600 bg-indigo-500/15 text-xs text-slate-200">{entry}</span>
                    ))}
                    {!dailySummary.length && <p className="text-sm text-slate-400">No summary highlights yet.</p>}
                  </div>
                </div>
              </div>
            </div>

            <div className="card p-4 rounded-xl border border-slate-700/80">
              <h2 className="text-[28px] font-bold tracking-tight text-slate-100">Team and Leadership View</h2>
              <p className="text-sm text-slate-400 mt-1">Role-level indicators to reduce standup dependency and expose blockers quickly.</p>

              <div className="grid sm:grid-cols-2 gap-2 mt-4">
                {teamInsights.map((member) => (
                  <div key={member.name} className="rounded-lg border border-slate-700/80 p-3">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-slate-100">{member.name}</p>
                      <span className="px-2 py-0.5 rounded-full text-xs border border-indigo-400/50 bg-indigo-500/15 text-indigo-200">{member.score}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{member.role}</p>
                    <p className="text-xs text-slate-300 mt-2">{member.note}</p>
                  </div>
                ))}
                {!teamInsights.length && <p className="text-sm text-slate-400">No team indicators available.</p>}
              </div>

              <div className="mt-3 rounded-lg border border-slate-700/80 overflow-hidden">
                <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr_1fr] gap-2 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 bg-slate-800/50">
                  <div>Indicator</div>
                  <div>Value</div>
                  <div>Trend</div>
                  <div>Meaning</div>
                </div>
                {executiveRows.map((row) => (
                  <div key={row.indicator} className="grid grid-cols-[1.2fr_0.8fr_0.8fr_1fr] gap-2 px-3 py-2 text-xs text-slate-200 border-t border-slate-700/80">
                    <div>{row.indicator}</div>
                    <div>{row.value}</div>
                    <div>{row.trend}</div>
                    <div className="text-slate-400">{row.meaning}</div>
                  </div>
                ))}
                {!executiveRows.length && <div className="px-3 py-3 text-sm text-slate-400">No executive summary table yet.</div>}
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <div className="card p-4 rounded-xl border border-slate-700/80">
              <h2 className="text-[30px] font-bold tracking-tight text-slate-100">Daily Delivery Report</h2>
              <p className="text-sm text-slate-400 mt-1">Day-level execution trend from practical sprint activity.</p>
              <div className="mt-3 rounded-lg border border-slate-700/80 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left bg-slate-800/50 text-slate-300">
                      <th className="py-2 px-3">Day</th>
                      <th className="py-2 px-3">Completed</th>
                      <th className="py-2 px-3">Created</th>
                      <th className="py-2 px-3">Carry Over</th>
                      <th className="py-2 px-3">Deploys</th>
                      <th className="py-2 px-3">Incidents</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyReport.map((row, idx) => (
                      <tr key={`${row.day}-${idx}`} className="border-t border-slate-700/70 text-slate-200">
                        <td className="py-2 px-3 font-medium">{row.day}</td>
                        <td className="py-2 px-3">{row.completed}</td>
                        <td className="py-2 px-3">{row.created}</td>
                        <td className="py-2 px-3">{row.carryOver}</td>
                        <td className="py-2 px-3">{row.deploys}</td>
                        <td className={`py-2 px-3 ${toNum(row.incidents) > 0 ? 'text-red-400' : 'text-emerald-300'}`}>{row.incidents}</td>
                      </tr>
                    ))}
                    {!dailyReport.length && (
                      <tr>
                        <td colSpan={6} className="py-4 px-3 text-slate-400">No daily report data.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card p-4 rounded-xl border border-slate-700/80">
              <h2 className="text-[30px] font-bold tracking-tight text-slate-100">Issue-Wise Insights</h2>
              <p className="text-sm text-slate-400 mt-1">Open and critical blockers with current ownership.</p>
              <div className="space-y-2 mt-3">
                {finalIssueRows.map((issue) => (
                  <div key={`${issue.id}-${issue.title}`} className="rounded-lg border border-slate-700/80 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-slate-100">{issue.id}</p>
                      <span className={`text-xs font-semibold uppercase ${riskTone(issue.severity)}`}>{issue.severity}</span>
                    </div>
                    <p className="text-sm text-slate-200 mt-1">{issue.title}</p>
                    <div className="grid grid-cols-3 gap-2 text-xs text-slate-400 mt-2">
                      <div>Owner: {issue.owner}</div>
                      <div>Status: {issue.status}</div>
                      <div>ETA: {issue.eta}</div>
                    </div>
                  </div>
                ))}
                {!finalIssueRows.length && <p className="text-sm text-slate-400">No issue-level insights yet.</p>}
              </div>
            </div>
          </div>

          <div className="card p-4 rounded-xl border border-slate-700/80">
            <h2 className="text-[30px] font-bold tracking-tight text-slate-100">Module-Wise Insights</h2>
            <p className="text-sm text-slate-400 mt-1">Health, velocity, risk, and quality indicators by module.</p>
            <div className="space-y-2 mt-3">
              {moduleWise.map((module) => (
                <div key={module.module} className="rounded-lg border border-slate-700/80 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xl font-semibold text-slate-100">{module.module}</p>
                    <p className="text-sm text-slate-400">Velocity {module.velocity}</p>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-700/70 overflow-hidden">
                    <span className="block h-full bg-indigo-500" style={{ width: percentValue(module.progress) }} />
                  </div>
                  <div className="grid sm:grid-cols-4 gap-2 mt-2 text-sm">
                    <div>
                      <p className="text-slate-400">Progress</p>
                      <p className="text-slate-200">{percentValue(module.progress)}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Defect Leakage</p>
                      <p className="text-slate-200 capitalize">{module.defectLeakage}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Risk</p>
                      <p className={`capitalize ${riskTone(module.risk)}`}>{module.risk}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">AI Coverage</p>
                      <p className="text-slate-200 capitalize">{module.aiCoverage}</p>
                    </div>
                  </div>
                </div>
              ))}
              {!moduleWise.length && <p className="text-sm text-slate-400">No module-wise insight data yet.</p>}
            </div>
          </div>

          <div className="card p-4">
            <h2 className="text-base font-semibold mb-2 text-slate-100">Global AI Summary</h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              {globalSummary || 'No global summary available yet.'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
