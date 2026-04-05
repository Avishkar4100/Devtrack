import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

export default function CyberpunkChart({ 
  type = 'bar',
  data,
  dataKey = 'value', 
  color = '#00f0ff',
  strokeColor,
  title,
  className = ''
}) {
  const chartColor = color || '#00f0ff'
  const strokeCol = strokeColor || color || '#8b5cf6'

  const chartProps = {
    data,
    margin: { top: 20, right: 30, left: 0, bottom: 20 },
    style: { fontFamily: 'JetBrains Mono, monospace' },
  }

  return (
    <div className={`w-full h-full ${className}`}>
      {title && (
        <div className="px-4 pt-4 pb-2">
          <h3 className="text-sm font-mono uppercase tracking-wider text-current opacity-80">
            {title}
          </h3>
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        {type === 'bar' ? (
          <BarChart {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,240,255,0.1)" />
            <XAxis stroke="rgba(0,240,255,0.3)" tick={{ fontSize: 11 }} />
            <YAxis stroke="rgba(0,240,255,0.3)" tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                background: 'rgba(9,9,11,0.95)',
                border: `1px solid ${chartColor}`,
                borderRadius: '6px',
                fontFamily: 'JetBrains Mono, monospace',
              }}
              cursor={{ stroke: chartColor, strokeWidth: 2 }}
            />
            <Bar dataKey={dataKey} stroke={chartColor} fill={chartColor} fillOpacity={0.2} isAnimationActive={true} />
          </BarChart>
        ) : (
          <LineChart {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(139,92,246,0.1)" />
            <XAxis stroke="rgba(139,92,246,0.3)" tick={{ fontSize: 11 }} />
            <YAxis stroke="rgba(139,92,246,0.3)" tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                background: 'rgba(9,9,11,0.95)',
                border: `1px solid ${strokeCol}`,
                borderRadius: '6px',
                fontFamily: 'JetBrains Mono, monospace',
              }}
              cursor={{ stroke: strokeCol, strokeWidth: 2 }}
            />
            <Line dataKey={dataKey} stroke={strokeCol} isAnimationActive={true} dot={false} strokeWidth={2} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
