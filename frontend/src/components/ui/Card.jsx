export default function Card({ 
  children, 
  className = '',
  hover = false,
  glow = false,
  interactive = false,
  ...props 
}) {
  const baseStyles = 'bg-surface-1 border border-border-1 rounded-xl backdrop-blur-sm transition-all duration-300'
  
  const hoverStyles = hover ? 'hover:border-border-2 hover:bg-surface-2' : ''
  const glowStyles = glow ? 'shadow-glow' : 'shadow-card'
  const interactiveStyles = interactive ? `${hoverStyles} hover:shadow-card-hover hover:-translate-y-0.5 cursor-pointer` : ''

  return (
    <div 
      className={`${baseStyles} ${glowStyles} ${interactiveStyles} ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
