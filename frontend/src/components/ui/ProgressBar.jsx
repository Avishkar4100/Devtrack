export default function ProgressBar({ 
  progress = 0,
  variant = 'default',
  size = 'md',
  animated = true,
  className = ''
}) {
  // Clamp progress between 0 and 100
  const percentage = Math.min(Math.max(progress, 0), 100)

  const variants = {
    default: 'bg-primary-500',
    success: 'bg-emerald-500',
    warning: 'bg-yellow-500',
    danger: 'bg-red-500',
    neon: 'bg-neon-cyan shadow-neon-cyan',
  }

  const sizes = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-3',
  }

  return (
    <div className={`w-full bg-surface-3 rounded-full overflow-hidden ${sizes[size]} ${className}`}>
      <div
        className={`${sizes[size]} ${variants[variant]} ${animated ? 'transition-all duration-500 ease-out' : ''}`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  )
}
