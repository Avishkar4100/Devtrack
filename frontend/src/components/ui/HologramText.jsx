export default function HologramText({ 
  text,
  color = 'cyan',
  className = '',
  size = 'md',
  animated = true
}) {
  const colors = {
    cyan:     'text-neon-cyan shadow-neon-cyan',
    magenta:  'text-neon-magenta shadow-neon-magenta',
    purple:   'text-neon-purple shadow-neon-purple',
    pink:     'text-neon-pink shadow-neon-pink',
    green:    'text-neon-green',
    blue:     'text-neon-blue',
  }

  const sizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
    xl: 'text-2xl',
    '2xl': 'text-3xl',
  }

  const baseClass = `
    font-mono font-bold tracking-wider uppercase
    drop-shadow-lg transition-all duration-300
    ${colors[color]} ${sizes[size]} ${className}
    ${animated ? 'animate-neon-glow' : ''}
  `

  return (
    <div className={baseClass}>
      {text}
      <span className="block text-xs opacity-50 mt-1 font-light normal-case">
        ▮ SCANNING...
      </span>
    </div>
  )
}
