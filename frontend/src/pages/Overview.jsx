import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

const riskFromProgress = (progress = 0) => {
  if (progress < 40) return 'high'
  if (progress < 70) return 'medium'
  return 'low'
}

export default function OverviewPage() {
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get('/projects')).data.data,
  })

  const { data: globalInsights } = useQuery({
    queryKey: ['global-insights'],
    queryFn: async () => (await api.get('/insights/global')).data.data,
  })

  const metrics = useMemo(() => {
    const total = projects.length
    const active = projects.filter((p) => p.status === 'active').length
    const avgProgress = total ? Math.round(projects.reduce((sum, p) => sum + (p.completionPercentage || 0), 0) / total) : 0
    const highRisk = projects.filter((p) => riskFromProgress(p.completionPercentage) === 'high').length
    return { total, active, avgProgress, highRisk }
  }, [projects])

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
              const risk = riskFromProgress(project.completionPercentage)
              return (
                <Link key={project._id} to={`/projects/${project._id}`} className="block border border-slate-700/70 rounded-lg p-3 hover:border-indigo-400/40 transition-colors">
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
            {globalInsights?.summary || 'No summary yet. Connect project activity to generate AI summary.'}
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
