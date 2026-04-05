import { useState } from 'react'

export default function Tooltip({ 
  children, 
  content,
  position = 'top',
  className = ''
}) {
  const [isVisible, setIsVisible] = useState(false)

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }

  const arrowClasses = {
    top: 'top-full border-t-surface-3 border-l-transparent border-r-transparent border-b-transparent',
    bottom: 'bottom-full border-b-surface-3 border-l-transparent border-r-transparent border-t-transparent',
    left: 'left-full border-l-surface-3 border-t-transparent border-b-transparent border-r-transparent',
    right: 'right-full border-r-surface-3 border-t-transparent border-b-transparent border-l-transparent',
  }

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
      >
        {children}
      </div>
      
      {isVisible && (
        <div
          className={`absolute z-50 px-3 py-2 bg-surface-3 text-sm text-white rounded-lg whitespace-nowrap border border-border-2 ${positionClasses[position]} ${className}`}
        >
          {content}
          <div className={`absolute w-2 h-2 border-2 ${arrowClasses[position]}`}></div>
        </div>
      )}
    </div>
  )
}
