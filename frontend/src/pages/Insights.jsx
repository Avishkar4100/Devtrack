import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

  const queryClient = useQueryClient()

  // ── Auto-load overview summary on mount ──
  const {
    data: overviewSummary,
    isLoading: loadingOverview,
  } = useQuery({
    queryKey: ['insights-overview-summary'],
    queryFn: async () => {
      const { data } = await api.get('/dashboard/overview-summary')
      return data?.data || null
    },
    staleTime: 2 * 60 * 1000,
  })

  // Auto-select default project from overview
  useEffect(() => {
    if (!selectedProjectId && overviewSummary?.selectedProjectId) {
      setSelectedProjectId(overviewSummary.selectedProjectId)
      if (overviewSummary.selectedJiraProjectKey) {
        setSelectedJiraProjectKey(overviewSummary.selectedJiraProjectKey)
      }
    }
  }, [overviewSummary, selectedProjectId, setSelectedProjectId, setSelectedJiraProjectKey])

  // ── Auto-load per-project insights when project is selected ──
  const {
    data: projectInsights,
    isLoading: loadingProjectInsights,
  } = useQuery({
    queryKey: ['insights-project', selectedProjectId],
    enabled: !!selectedProjectId,
    queryFn: async () => {
      const { data } = await api.get(`/insights/${selectedProjectId}`)
      return data?.data || null
    },
    staleTime: 2 * 60 * 1000,
  })

  // Manual refresh
  const refreshInsights = useMutation({
    mutationFn: async () => {
      const overviewRes = await api.get('/dashboard/overview-summary')
      let projectRes = null
      if (selectedProjectId) {
        projectRes = await api.get(`/insights/${selectedProjectId}`)
      }
      return {
        overview: overviewRes?.data?.data || null,
        project: projectRes?.data?.data || null,
      }
    },
    onSuccess: ({ overview, project }) => {
      queryClient.setQueryData(['insights-overview-summary'], overview)
      if (project) {
        queryClient.setQueryData(['insights-project', selectedProjectId], project)
      }
      toast.success('Insights refreshed')
    },
    onError: (err) => {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to refresh insights')
    },
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
  const teamInsights = projectInsights?.teamInsights || []
  const dailySummary = projectInsights?.dailySummary || []
  const risks = projectInsights?.risks || []

  const dailyTrend = useMemo(() => {
    const created = dailyReport.map((row) => toNum(row.created))
    const completed = dailyReport.map((row) => toNum(row.completed))
    return { created, completed }
  }, [dailyReport])

  const hasGlobalInsights = Boolean(overviewSummary)
  const hasProjectInsights = Boolean(projectInsights)

  const activeProjectName = projects.find((p) => String(p._id) === String(selectedProjectId))?.name || ''

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-bold tracking-tight text-slate-100">Delivery Insights</h1>
          {activeProjectName && (
            <p className="text-sm text-slate-400 mt-1">
              Viewing: <span className="text-indigo-300 font-medium">{activeProjectName}</span>
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => refreshInsights.mutate()}
          disabled={refreshInsights.isPending || loadingOverview || loadingProjectInsights}
        >
          {refreshInsights.isPending ? 'Refreshing...' : loadingOverview ? 'Loading...' : 'Refresh Insights'}
        </button>
      </div>

      {/* Project selector for switching context */}
      {projects.length > 1 && (
        <div className="card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">Select Project:</span>
            {projects.map((p) => (
              <button
                key={p._id}
                type="button"
                onClick={() => {
                  setSelectedProjectId(p._id)
                  if (p.jiraProjectKey) setSelectedJiraProjectKey(p.jiraProjectKey)
                }}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  String(p._id) === String(selectedProjectId)
                    ? 'border-indigo-500 bg-indigo-500/20 text-indigo-200'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:border-white/20'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

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

      {loadingOverview && !hasGlobalInsights && (
        <div className="card p-4 text-sm text-slate-400">
          Loading project overview...
        </div>
      )}

      {!loadingOverview && !hasGlobalInsights && (
        <div className="card p-4 text-sm text-slate-400">
          No projects found. Create a project to see delivery insights.
        </div>
      )}

      {!selectedProjectId && hasGlobalInsights && (
        <div className="card p-4 text-sm text-slate-400">
          Select a project from the list above to view detailed delivery insights.
        </div>
      )}

      {loadingProjectInsights && selectedProjectId && (
        <div className="card p-4 text-sm text-slate-400">
          Loading project insights...
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
            </div>
          </div>

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
            <h2 className="text-[30px] font-bold tracking-tight text-slate-100">Module-Wise Insights</h2>
            <p className="text-sm text-slate-400 mt-1">Health, velocity, risk, and quality indicators by epic.</p>
            <div className="space-y-2 mt-3">
              {moduleWise.map((module) => (
                <div key={module.module} className="rounded-lg border border-slate-700/80 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xl font-semibold text-slate-100">{module.module}</p>
                      {module.epicKey && module.epicKey !== module.module && (
                        <p className="text-xs text-slate-500 mt-0.5">{module.epicKey}</p>
                      )}
                      {module.summary && (
                        <p className="text-xs text-slate-400 mt-1 leading-5">{module.summary}</p>
                      )}
                    </div>
                    <p className="text-sm text-slate-400 shrink-0">Velocity {module.velocity}</p>
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
