export default function Badge({ 
  children, 
  variant = 'default', 
  size = 'md',
  className = '' 
}) {
  const baseStyles = 'inline-flex items-center font-medium rounded-full transition-colors'
  
  const variants = {
    default: 'bg-primary-500/10 text-primary-400 border border-primary-500/30',
    success: 'bg-green-500/10 text-emerald-400 border border-emerald-500/30',
    warning: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/30',
    danger: 'bg-red-500/10 text-red-400 border border-red-500/30',
    neon: 'bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 shadow-neon-cyan',
    magenta: 'bg-neon-magenta/10 text-neon-magenta border border-neon-magenta/30 shadow-neon-magenta',
  }

  const sizes = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
    lg: 'px-4 py-2 text-base',
  }

  return (
    <span className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </span>
  )
}
