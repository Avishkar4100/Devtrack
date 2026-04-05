export default function CyberpunkCard({ 
  children, 
  title,
  glitchText,
  neonColor = 'cyan',
  className = ''
}) {
  const neonColors = {
    cyan:     'shadow-neon-cyan border-neon-cyan text-neon-cyan',
    magenta:  'shadow-neon-magenta border-neon-magenta text-neon-magenta',
    purple:   'shadow-neon-purple border-neon-purple text-neon-purple',
    pink:     'shadow-neon-pink border-neon-pink text-neon-pink',
    green:    'text-neon-green',
    yellow:   'text-neon-yellow',
  }

  return (
    <div className={`relative bg-surface-1 border-2 ${neonColors[neonColor]} rounded-lg overflow-hidden transition-all duration-300 hover:shadow-lg ${className}`}>
      {/* Glitch effect decorations */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-current opacity-60" />
        <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-current opacity-60" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-current opacity-60" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-current opacity-60" />
      </div>

      {/* Content */}
      <div className="relative p-6 space-y-4">
        {title && (
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold font-mono uppercase tracking-widest leading-none">
              {title}
            </span>
            {glitchText && (
              <span className="text-xs font-mono uppercase opacity-50 animate-glitch">
                [{glitchText}]
              </span>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
