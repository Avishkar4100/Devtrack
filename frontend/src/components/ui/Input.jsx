import { forwardRef } from 'react'

const Input = forwardRef(({ 
  type = 'text',
  error = false,
  icon: Icon,
  className = '',
  variant = 'default',
  ...props 
}, ref) => {
  const baseStyles = 'w-full px-4 py-2 rounded-lg transition-all duration-200 bg-surface-2 text-white placeholder-gray-500 focus:outline-none'
  
  const variants = {
    default: error 
      ? 'border-2 border-red-500 focus:border-red-600 focus:shadow-red-500/20' 
      : 'border border-border-2 focus:border-primary-500 focus:shadow-glow-sm',
    neon: 'border border-neon-cyan/50 focus:border-neon-cyan focus:shadow-neon-cyan',
  }

  return (
    <div className="relative w-full">
      {Icon && (
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
      )}
      <input
        ref={ref}
        type={type}
        className={`${baseStyles} ${variants[variant]} ${Icon ? 'pl-10' : ''} ${className}`}
        {...props}
      />
      {error && props['aria-invalid'] && (
        <p className="mt-1 text-sm text-red-400">Please check your input</p>
      )}
    </div>
  )
})

Input.displayName = 'Input'

export default Input
