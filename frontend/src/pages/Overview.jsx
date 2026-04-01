import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useProjectStore } from '@/store/projectStore'

const riskFromProgress = (progress = 0) => {
  if (progress < 40) return 'high'
  if (progress < 70) return 'medium'
  return 'low'
}

export default function OverviewPage() {
  const {
    projects: storeProjects,
    setProjects,
    selectedProjectId,
    setSelectedProjectId,
    setSelectedJiraProjectKey,
  } = useProjectStore()

  const {
    data: overviewSummary,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['overview-summary'],
    queryFn: async () => (await api.get('/dashboard/overview-summary')).data.data,
  })

  const projects = useMemo(() => overviewSummary?.projects || [], [overviewSummary?.projects])

  useEffect(() => {
    const sameLength = storeProjects.length === projects.length
    const sameIds = sameLength && storeProjects.every((p, idx) => p?._id === projects[idx]?._id)
    if (sameIds) return
    setProjects(projects)
  }, [projects, setProjects, storeProjects])

  useEffect(() => {
    if (!projects.length) return

    const selectedExists = selectedProjectId && projects.some((p) => p._id === selectedProjectId)
    if (selectedExists) return

    const nextProjectId = overviewSummary?.selectedProjectId || projects[0]?._id || ''
    const selectedProject = projects.find((p) => p._id === nextProjectId)

    if (nextProjectId) {
      setSelectedProjectId(nextProjectId)
      setSelectedJiraProjectKey(selectedProject?.jiraProjectKey || '')
    }
  }, [projects, selectedProjectId, overviewSummary?.selectedProjectId, setSelectedJiraProjectKey, setSelectedProjectId])

  const selectedProject = useMemo(
    () => projects.find((project) => project._id === selectedProjectId) || null,
    [projects, selectedProjectId]
  )

  const todaySummary = selectedProject?.summary || overviewSummary?.selectedProjectSummary || overviewSummary?.summary

  const metrics = useMemo(() => {
    const total = overviewSummary?.metrics?.totalProjects ?? projects.length
    const active = overviewSummary?.metrics?.activeProjects ?? projects.filter((p) => p.status === 'active').length
    const avgProgress = overviewSummary?.metrics?.avgProgress ?? (total ? Math.round(projects.reduce((sum, p) => sum + (p.completionPercentage || 0), 0) / total) : 0)
    const highRisk = overviewSummary?.metrics?.highRiskProjects ?? projects.filter((p) => (p.risk || riskFromProgress(p.completionPercentage)) === 'high').length
    return { total, active, avgProgress, highRisk }
  }, [overviewSummary, projects])

  const applyProjectContext = (project) => {
    if (!project?._id) return
    setSelectedProjectId(project._id)
    setSelectedJiraProjectKey(project.jiraProjectKey || '')
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="card p-4 text-sm text-slate-300">Loading overview...</div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="card p-4 text-sm text-red-300">
          Failed to load overview data: {error?.response?.data?.message || error?.message || 'Unknown error'}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold text-gray-100">Overview</h1>

      <div className="grid md:grid-cols-4 gap-3">
        <MetricCard label="Total Projects" value={metrics.total} />
        <MetricCard label="Active Projects" value={metrics.active} />
        <MetricCard label="Avg Progress %" value={`${metrics.avgProgress}%`} />
        <MetricCard label="High Risk Projects" value={metrics.highRisk} />
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="card p-4 space-y-3">
          <h2 className="text-base font-semibold text-gray-100">Projects</h2>
          <div className="grid md:grid-cols-2 gap-3">
            {projects.map((project) => {
              const risk = project.risk || riskFromProgress(project.completionPercentage)
              return (
                <Link
                  key={project._id}
                  to={`/projects/${project._id}`}
                  onClick={() => applyProjectContext(project)}
                  className="block border border-slate-700/70 rounded-lg p-3 hover:border-indigo-400/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-100 truncate">{project.name}</p>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${risk === 'high' ? 'bg-red-500/20 text-red-300' : risk === 'medium' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
                      {risk}
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${project.completionPercentage || 0}%` }} />
                  </div>
                  <p className="text-xs text-slate-400 mt-2">Last activity: {new Date(project.updatedAt).toLocaleString()}</p>
                </Link>
              )
            })}
            {projects.length === 0 && <p className="text-sm text-slate-400">No projects available.</p>}
          </div>
        </div>

        <div className="card p-4 h-fit">
          <h2 className="text-base font-semibold text-gray-100 mb-2">Today Summary</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            {todaySummary || 'No summary yet. Connect project activity to generate AI summary.'}
          </p>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-2xl font-bold text-slate-100">{value}</p>
    </div>
  )
}
