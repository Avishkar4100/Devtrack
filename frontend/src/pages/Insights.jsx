import { useEffect, useMemo, useState } from 'react'
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

const riskBg = (risk = 'low') => {
  const normalized = String(risk).toLowerCase()
  if (normalized === 'high') return 'bg-red-500/15 text-red-300 border-red-500/30'
  if (normalized === 'medium') return 'bg-amber-500/15 text-amber-300 border-amber-500/30'
  return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
}

const scoreColor = (score) => {
  if (score >= 70) return 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
  if (score >= 40) return 'text-amber-300 bg-amber-500/15 border-amber-500/30'
  return 'text-red-300 bg-red-500/15 border-red-500/30'
}

// ── Bar chart for throughput vs intake ──
const ThroughputChart = ({ dailyReport }) => {
  if (!dailyReport.length) {
    return <p className="text-sm text-slate-400 py-8 text-center">No daily activity data available yet.</p>
  }

  const maxVal = Math.max(
    ...dailyReport.map((r) => Math.max(toNum(r.created), toNum(r.completed))),
    1
  )
  const barWidth = 28
  const chartHeight = 160
  const chartWidth = dailyReport.length * 70 + 40

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`} className="w-full h-[200px] min-w-[400px]">
        {/* Grid lines */}
        {[0, 1, 2, 3, 4].map((idx) => {
          const y = 10 + (chartHeight / 4) * idx
          return (
            <g key={idx}>
              <line x1="30" y1={y} x2={chartWidth - 10} y2={y} stroke="rgba(148,163,184,0.15)" />
              <text x="25" y={y + 4} textAnchor="end" className="text-[10px] fill-slate-500">
                {Math.round(maxVal - (maxVal / 4) * idx)}
              </text>
            </g>
          )
        })}
        {/* Bars */}
        {dailyReport.map((row, idx) => {
          const createdH = maxVal ? (toNum(row.created) / maxVal) * chartHeight : 0
          const completedH = maxVal ? (toNum(row.completed) / maxVal) * chartHeight : 0
          const xBase = 40 + idx * 70
          return (
            <g key={idx}>
              {/* Created bar */}
              <rect
                x={xBase}
                y={chartHeight - createdH + 10}
                width={barWidth}
                height={createdH}
                rx="3"
                fill="#3b82f6"
                fillOpacity="0.85"
              />
              {/* Completed bar */}
              <rect
                x={xBase + barWidth + 4}
                y={chartHeight - completedH + 10}
                width={barWidth}
                height={completedH}
                rx="3"
                fill="#22c55e"
                fillOpacity="0.85"
              />
              {/* Value labels */}
              <text x={xBase + barWidth / 2} y={chartHeight - createdH + 6} textAnchor="middle" className="text-[10px] fill-white font-semibold">
                {toNum(row.created) > 0 ? row.created : ''}
              </text>
              <text x={xBase + barWidth + 4 + barWidth / 2} y={chartHeight - completedH + 6} textAnchor="middle" className="text-[10px] fill-white font-semibold">
                {toNum(row.completed) > 0 ? row.completed : ''}
              </text>
              {/* Day label */}
              <text x={xBase + barWidth + 2} y={chartHeight + 28} textAnchor="middle" className="text-[11px] fill-slate-400">
                {row.day}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="flex flex-wrap gap-4 text-xs text-slate-300 mt-1 px-2">
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-blue-500" />Issues created
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm bg-green-500" />Issues completed
        </span>
      </div>
    </div>
  )
}

// ── Team Member Card ──
const TeamMemberCard = ({ member }) => {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-lg border border-slate-700/80 p-3 hover:border-slate-600/70 transition-colors">
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-xs font-bold text-indigo-300 shrink-0">
            {String(member.name || '?').slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-100 text-sm truncate">{member.name}</p>
            <p className="text-[11px] text-slate-400">{member.role}</p>
          </div>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs border font-mono ${scoreColor(member.score)}`}>
          {member.score}
        </span>
      </div>

      {/* Compact stats row */}
      <div className="flex gap-3 mt-2 text-xs">
        {member.doneCount !== undefined && (
          <span className="text-emerald-300">✅ {member.doneCount} done</span>
        )}
        {member.inProgressCount !== undefined && (
          <span className="text-amber-300">🔄 {member.inProgressCount} active</span>
        )}
        {member.notStartedCount !== undefined && (
          <span className="text-slate-400">⏳ {member.notStartedCount} pending</span>
        )}
      </div>

      {/* Expandable details */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-700/60 space-y-2 text-xs">
          {member.currentFocus && (
            <div>
              <span className="text-slate-400">🎯 Focus:</span>
              <p className="text-slate-300 mt-0.5">{member.currentFocus}</p>
            </div>
          )}
          {member.nextAction && (
            <div>
              <span className="text-slate-400">📋 Next:</span>
              <p className="text-slate-300 mt-0.5">{member.nextAction}</p>
            </div>
          )}
          {member.strengths && (
            <div>
              <span className="text-slate-400">💪 Strengths:</span>
              <p className="text-slate-300 mt-0.5">{member.strengths}</p>
            </div>
          )}
          {member.risk && (
            <div>
              <span className="text-red-400">⚠️ Risk:</span>
              <p className="text-red-300 mt-0.5">{member.risk}</p>
            </div>
          )}
          {member.topDoneIssues && member.topDoneIssues.length > 0 && (
            <div>
              <span className="text-slate-400">✅ Completed:</span>
              <p className="text-slate-300 mt-0.5 font-mono">{member.topDoneIssues.slice(0, 8).join(', ')}</p>
            </div>
          )}
        </div>
      )}

      {!expanded && (member.currentFocus || member.risk) && (
        <p className="text-[11px] text-slate-500 mt-2 truncate">
          {member.risk ? `⚠️ ${member.risk}` : member.currentFocus}
        </p>
      )}
    </div>
  )
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
  const metrics = overviewSummary?.metrics || {}

  const rows = useMemo(() => {
    return projects.map((p) => {
      const progress = p.completionPercentage || 0
      const risk = p.risk || 'low'
      const totalStories = p.totalStories || 0
      const completedStories = p.completedStories || 0
      return {
        id: p._id,
        name: p.name,
        key: p.key,
        progress,
        risk,
        totalStories,
        completedStories,
        openStories: Math.max(totalStories - completedStories, 0),
        activeDevs: p.activeDevelopers?.length || 0,
        status: p.status,
      }
    })
  }, [projects])

  const overall = projectInsights?.overall || []
  const dailyReport = projectInsights?.dailyReport || []
  const moduleWise = projectInsights?.moduleWise || []
  const teamInsights = projectInsights?.teamInsights || []
  const dailySummary = projectInsights?.dailySummary || []
  const risks = projectInsights?.risks || []

  const hasGlobalInsights = Boolean(overviewSummary)
  const hasProjectInsights = Boolean(projectInsights)

  const activeProjectName = projects.find((p) => String(p._id) === String(selectedProjectId))?.name || ''

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-bold tracking-tight text-slate-100">Delivery Insights</h1>
          <p className="text-sm text-slate-400 mt-1">
            Real-time delivery intelligence across all projects
          </p>
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

      {/* ── Project selector ── */}
      {projects.length > 1 && (
        <div className="card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">Select Project:</span>
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

      {/* ═══════════════════════════════════════════════════════ */}
      {/* SECTION 1: OVERALL DELIVERY SUMMARY (Higher-Level)    */}
      {/* ═══════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-1.5 rounded-full bg-indigo-500" />
          <h2 className="text-2xl font-bold text-slate-100">Overall Delivery Summary</h2>
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">Multi-Project View</span>
        </div>

        {loadingOverview && !hasGlobalInsights && (
          <div className="card p-4 text-sm text-slate-400">Loading project overview...</div>
        )}

        {!loadingOverview && !hasGlobalInsights && (
          <div className="card p-4 text-sm text-slate-400">No projects found. Create a project to see delivery insights.</div>
        )}

        {hasGlobalInsights && (
          <>
            {/* Global Metrics Cards */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="card p-4 rounded-xl border border-slate-700/80">
                <p className="text-xs text-slate-400 uppercase tracking-wide">Total Projects</p>
                <p className="text-[36px] font-bold leading-none text-slate-100 mt-2">{metrics.totalProjects || projects.length}</p>
                <p className="text-xs text-slate-500 mt-2">{metrics.activeProjects || 0} active</p>
              </div>
              <div className="card p-4 rounded-xl border border-slate-700/80">
                <p className="text-xs text-slate-400 uppercase tracking-wide">Avg Progress</p>
                <p className="text-[36px] font-bold leading-none text-slate-100 mt-2">{metrics.avgProgress || 0}%</p>
                <div className="mt-2 h-1.5 rounded-full bg-slate-700/70 overflow-hidden">
                  <span className="block h-full bg-indigo-500 rounded-full" style={{ width: `${metrics.avgProgress || 0}%` }} />
                </div>
              </div>
              <div className="card p-4 rounded-xl border border-slate-700/80">
                <p className="text-xs text-slate-400 uppercase tracking-wide">High Risk Projects</p>
                <p className={`text-[36px] font-bold leading-none mt-2 ${(metrics.highRiskProjects || 0) > 0 ? 'text-red-400' : 'text-emerald-300'}`}>
                  {metrics.highRiskProjects || 0}
                </p>
                <p className="text-xs text-slate-500 mt-2">Need attention</p>
              </div>
              <div className="card p-4 rounded-xl border border-slate-700/80">
                <p className="text-xs text-slate-400 uppercase tracking-wide">Total Open Stories</p>
                <p className="text-[36px] font-bold leading-none text-slate-100 mt-2">
                  {rows.reduce((sum, r) => sum + r.openStories, 0)}
                </p>
                <p className="text-xs text-slate-500 mt-2">Across all projects</p>
              </div>
            </div>

            {/* Project Risk Board */}
            <div className="card p-4 rounded-xl border border-slate-700/80">
              <h3 className="text-base font-semibold mb-3 text-slate-100">Project Risk Board</h3>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-400 border-b border-slate-700">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Project</th>
                      <th className="py-2 pr-3 font-medium">Progress</th>
                      <th className="py-2 pr-3 font-medium">Risk</th>
                      <th className="py-2 pr-3 font-medium">Open Stories</th>
                      <th className="py-2 pr-3 font-medium">Active Devs</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b border-slate-800/70 hover:bg-slate-800/30 transition-colors">
                        <td className="py-2.5 pr-3">
                          <Link
                            to={`/projects/${row.id}`}
                            className="text-indigo-300 hover:text-indigo-200 font-medium"
                            onClick={() => setSelectedProjectId(row.id)}
                          >
                            {row.name}
                          </Link>
                          {row.key && <span className="text-[11px] text-slate-500 ml-1.5">{row.key}</span>}
                        </td>
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-slate-700/70 overflow-hidden">
                              <span className="block h-full bg-indigo-500 rounded-full" style={{ width: `${row.progress}%` }} />
                            </div>
                            <span className="text-xs text-slate-300">{row.progress}%</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] border capitalize ${riskBg(row.risk)}`}>
                            {row.risk}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className={row.openStories > 5 ? 'text-red-300' : 'text-slate-300'}>
                            {row.openStories}
                          </span>
                          <span className="text-slate-500 text-[11px] ml-1">/ {row.totalStories}</span>
                        </td>
                        <td className="py-2.5 pr-3 text-slate-300">{row.activeDevs || '—'}</td>
                        <td className="py-2.5 pr-3">
                          <span className={`text-[11px] capitalize ${row.status === 'active' ? 'text-emerald-300' : 'text-slate-400'}`}>
                            {row.status || '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-400">
                          No project data yet. Click "Refresh Insights" to generate.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Global AI Summary */}
            <div className="card p-4 rounded-xl border border-slate-700/80 bg-gradient-to-r from-indigo-500/5 to-transparent">
              <h3 className="text-sm font-semibold mb-2 text-slate-200">AI Executive Summary</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                {globalSummary || 'No global summary available yet. Sync your projects with Jira to generate AI-powered insights.'}
              </p>
            </div>
          </>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* SECTION 2: PROJECT DELIVERY SNAPSHOT (Per-Project)    */}
      {/* ═══════════════════════════════════════════════════════ */}
      {selectedProjectId && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 pt-2 border-t border-slate-700/50">
            <div className="h-8 w-1.5 rounded-full bg-emerald-500" />
            <h2 className="text-2xl font-bold text-slate-100">Project Delivery Snapshot</h2>
            {activeProjectName && (
              <span className="text-sm text-indigo-300 bg-indigo-500/10 px-2 py-0.5 rounded-full">{activeProjectName}</span>
            )}
          </div>

          {loadingProjectInsights && (
            <div className="card p-4 text-sm text-slate-400">Loading project insights...</div>
          )}

          {!loadingProjectInsights && !hasProjectInsights && (
            <div className="card p-6 text-center text-sm text-slate-400">
              <p className="text-lg mb-2">📋</p>
              <p>No delivery snapshot available for this project yet.</p>
              <p className="mt-1 text-xs text-slate-500">Generate a scrum-markdown delivery snapshot from the Project Workspace to populate this view.</p>
            </div>
          )}

          {hasProjectInsights && (
            <>
              {/* Overall Metrics Cards */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {overall.map((metric) => (
                  <div key={metric.label} className="card p-4 rounded-xl border border-slate-700/80">
                    <p className="text-xs text-slate-400 uppercase tracking-wide">{metric.label}</p>
                    <p className="text-[32px] font-bold leading-none text-slate-100 mt-2">{metric.value}</p>
                    <p className="text-[11px] text-slate-500 mt-2">{metric.note}</p>
                  </div>
                ))}
                {!overall.length && (
                  <div className="card p-4 lg:col-span-4 text-sm text-slate-400 text-center">
                    No enriched metrics found for this project yet.
                  </div>
                )}
              </div>

              {/* Delivery & Flow Intelligence + Team View */}
              <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
                {/* Left: Delivery & Flow Intelligence */}
                <div className="card p-4 rounded-xl border border-slate-700/80">
                  <h3 className="text-xl font-bold text-slate-100">Delivery & Flow Intelligence</h3>
                  <p className="text-sm text-slate-400 mt-1">Compare issue intake vs completion and catch flow slippage early.</p>

                  <div className="mt-4 rounded-lg border border-slate-700/80 p-3 bg-slate-900/30">
                    <p className="text-sm font-semibold text-slate-200 mb-3">
                      Throughput vs Intake
                      <span className="text-xs text-slate-500 ml-2">({dailyReport.length} cycles)</span>
                    </p>
                    <ThroughputChart dailyReport={dailyReport} />
                  </div>

                  <div className="grid md:grid-cols-2 gap-3 mt-3">
                    <div className="rounded-lg border border-slate-700/80 p-3 bg-slate-900/30">
                      <p className="text-sm font-semibold text-slate-100 mb-2">⚠️ Current Risk Radar</p>
                      {risks.length ? (
                        <ul className="space-y-1.5 text-xs text-slate-300">
                          {risks.map((risk, idx) => (
                            <li key={`${risk}-${idx}`} className="flex items-start gap-1.5">
                              <span className="text-red-400 shrink-0 mt-0.5">•</span>
                              <span>{risk}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-400">No risk items flagged.</p>
                      )}
                    </div>
                    <div className="rounded-lg border border-slate-700/80 p-3 bg-slate-900/30">
                      <p className="text-sm font-semibold text-slate-100 mb-2">📊 Daily Summary</p>
                      <div className="flex flex-wrap gap-1.5">
                        {dailySummary.map((entry) => (
                          <span key={entry} className="px-2 py-1 rounded-full border border-slate-600 bg-indigo-500/10 text-[11px] text-slate-200">
                            {entry}
                          </span>
                        ))}
                        {!dailySummary.length && <p className="text-xs text-slate-400">No summary highlights yet.</p>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right: Team & Leadership View */}
                <div className="card p-4 rounded-xl border border-slate-700/80">
                  <h3 className="text-xl font-bold text-slate-100">Team & Leadership View</h3>
                  <p className="text-sm text-slate-400 mt-1">Role-level indicators to reduce standup dependency and expose blockers quickly.</p>

                  <div className="space-y-2 mt-4 max-h-[520px] overflow-y-auto pr-1">
                    {teamInsights.map((member) => (
                      <TeamMemberCard key={member.name} member={member} />
                    ))}
                    {!teamInsights.length && (
                      <p className="text-sm text-slate-400 py-4 text-center">No team indicators available.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Daily Delivery Report */}
              <div className="card p-4 rounded-xl border border-slate-700/80">
                <h3 className="text-xl font-bold text-slate-100">Daily Delivery Report</h3>
                <p className="text-sm text-slate-400 mt-1">Day-level execution trend from sprint activity.</p>
                <div className="mt-3 rounded-lg border border-slate-700/80 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left bg-slate-800/50 text-slate-300">
                        <th className="py-2.5 px-4 font-medium">Day</th>
                        <th className="py-2.5 px-4 font-medium">Completed</th>
                        <th className="py-2.5 px-4 font-medium">Created</th>
                        <th className="py-2.5 px-4 font-medium">Carry Over</th>
                        <th className="py-2.5 px-4 font-medium">Deploys</th>
                        <th className="py-2.5 px-4 font-medium">Incidents</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyReport.map((row, idx) => (
                        <tr key={`${row.day}-${idx}`} className="border-t border-slate-700/70 text-slate-200 hover:bg-slate-800/30">
                          <td className="py-2.5 px-4 font-medium">{row.day}</td>
                          <td className="py-2.5 px-4">
                            <span className="text-emerald-300 font-medium">{row.completed}</span>
                          </td>
                          <td className="py-2.5 px-4">
                            <span className="text-blue-300">{row.created}</span>
                          </td>
                          <td className="py-2.5 px-4">{row.carryOver}</td>
                          <td className="py-2.5 px-4">{row.deploys}</td>
                          <td className={`py-2.5 px-4 font-medium ${toNum(row.incidents) > 0 ? 'text-red-400' : 'text-emerald-300'}`}>
                            {row.incidents}
                          </td>
                        </tr>
                      ))}
                      {!dailyReport.length && (
                        <tr>
                          <td colSpan={6} className="py-6 px-4 text-center text-slate-400">No daily report data.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Module-Wise Insights */}
              <div className="card p-4 rounded-xl border border-slate-700/80">
                <h3 className="text-xl font-bold text-slate-100">Module-Wise Insights</h3>
                <p className="text-sm text-slate-400 mt-1">Health, velocity, risk, and quality indicators by epic.</p>
                <div className="space-y-2 mt-3">
                  {moduleWise.map((mod) => (
                    <div key={mod.module} className="rounded-lg border border-slate-700/80 p-3 hover:border-slate-600/70 transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-lg font-semibold text-slate-100">{mod.module}</p>
                          {mod.epicKey && mod.epicKey !== mod.module && (
                            <p className="text-[11px] text-slate-500 mt-0.5 font-mono">{mod.epicKey}</p>
                          )}
                          {mod.summary && (
                            <p className="text-xs text-slate-400 mt-1 leading-5">{mod.summary}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm text-slate-400">Velocity</p>
                          <p className="text-lg font-bold text-indigo-300">{mod.velocity}</p>
                        </div>
                      </div>
                      {/* Progress bar */}
                      <div className="mt-2 h-2 rounded-full bg-slate-700/70 overflow-hidden">
                        <span
                          className="block h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-400 transition-all"
                          style={{ width: percentValue(mod.progress) }}
                        />
                      </div>
                      {/* Stats grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs">
                        <div>
                          <p className="text-slate-400">Progress</p>
                          <p className="text-slate-200 font-medium">{percentValue(mod.progress)}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">Defect Leakage</p>
                          <p className={`capitalize font-medium ${mod.defectLeakage === 'high' ? 'text-red-400' : mod.defectLeakage === 'medium' ? 'text-amber-300' : 'text-emerald-300'}`}>
                            {mod.defectLeakage}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-400">Risk</p>
                          <p className={`capitalize font-medium ${riskTone(mod.risk)}`}>{mod.risk}</p>
                        </div>
                        <div>
                          <p className="text-slate-400">AI Coverage</p>
                          <p className={`capitalize font-medium ${mod.aiCoverage === 'high' ? 'text-emerald-300' : mod.aiCoverage === 'medium' ? 'text-amber-300' : 'text-red-300'}`}>
                            {mod.aiCoverage}
                          </p>
                        </div>
                      </div>
                      {/* Epic stats row */}
                      {(mod.done !== undefined || mod.inProgress !== undefined || mod.notStarted !== undefined) && (
                        <div className="flex gap-4 mt-2 pt-2 border-t border-slate-700/50 text-[11px]">
                          {mod.done !== undefined && <span className="text-emerald-300">✅ {mod.done} done</span>}
                          {mod.inProgress !== undefined && <span className="text-amber-300">🔄 {mod.inProgress} active</span>}
                          {mod.notStarted !== undefined && <span className="text-slate-400">⏳ {mod.notStarted} pending</span>}
                          {mod.owners && mod.owners.length > 0 && (
                            <span className="text-slate-500 ml-auto truncate">
                              👥 {mod.owners.slice(0, 3).join(', ')}{mod.owners.length > 3 ? ` +${mod.owners.length - 3}` : ''}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {!moduleWise.length && (
                    <p className="text-sm text-slate-400 py-4 text-center">No module-wise insight data yet.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* No project selected prompt */}
      {!selectedProjectId && hasGlobalInsights && (
        <div className="card p-6 text-center text-sm text-slate-400 border border-dashed border-slate-600/50 rounded-xl">
          <p className="text-2xl mb-2">📋</p>
          <p className="text-slate-300">Select a project above to view its detailed delivery snapshot.</p>
          <p className="text-xs text-slate-500 mt-1">The project-level view shows per-epic breakdowns, team analytics, and daily flow intelligence.</p>
        </div>
      )}
    </div>
  )
}
