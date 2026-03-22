import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

export default function InsightsPage() {
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => (await api.get('/projects')).data.data,
  })

  const { data: globalInsights } = useQuery({
    queryKey: ['global-insights'],
    queryFn: async () => (await api.get('/insights/global')).data.data,
  })

  const rows = useMemo(() => {
    return projects.map((p) => {
      const progress = p.completionPercentage || 0
      const risk = progress < 40 ? 'high' : progress < 70 ? 'medium' : 'low'
      return {
        id: p._id,
        name: p.name,
        progress,
        risk,
        openStories: Math.max((p.totalStories || 0) - (p.completedStories || 0), 0),
      }
    })
  }, [projects])

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-slate-100">Insights</h1>

      <div className="card p-4">
        <h2 className="text-base font-semibold mb-2">Global AI Summary</h2>
        <p className="text-sm text-slate-300 leading-relaxed">
          {globalInsights?.summary || 'No global summary available yet.'}
        </p>
      </div>

      <div className="card p-4">
        <h2 className="text-base font-semibold mb-3">Project Risk Board</h2>
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
                    <Link to={`/projects/${row.id}`} className="text-indigo-300 hover:text-indigo-200">
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
                  <td colSpan={4} className="py-4 text-slate-400">No project insight data yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
