import { useEffect, useState } from 'react'

export default function ScanlineEffect({ children, color = 'cyan', intensity = 0.3 }) {
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setOffset((prev) => (prev + 2) % 100)
    }, 50)
    return () => clearInterval(interval)
  }, [])

  const colorMap = {
    cyan: 'from-neon-cyan to-transparent',
    magenta: 'from-neon-magenta to-transparent',
    purple: 'from-neon-purple to-transparent',
    pink: 'from-neon-pink to-transparent',
  }

  return (
    <div className="relative w-full h-full overflow-hidden">
      {children}

      {/* Scanline overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `repeating-linear-gradient(
            0deg,
            rgba(0, 240, 255, ${intensity * 0.1}),
            rgba(0, 240, 255, ${intensity * 0.1}) 1px,
            transparent 1px,
            transparent 2px
          )`,
          animation: 'scanlines 8s linear infinite',
        }}
      />

      {/* Horizontal scan line */}
      <div
        className={`absolute left-0 right-0 h-0.5 bg-gradient-to-r ${colorMap[color]} pointer-events-none`}
        style={{
          top: `${offset}%`,
          boxShadow: `0 0 20px rgba(0, 240, 255, ${intensity * 0.5})`,
          opacity: intensity,
        }}
      />
    </div>
  )
}

const scanlineStyles = `
  @keyframes scanlines {
    0% {
      transform: translateY(0);
    }
    100% {
      transform: translateY(10px);
    }
  }
`

// Export styles to be used globally
if (typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.textContent = scanlineStyles
  if (!document.querySelector('style[data-scanlines]')) {
    style.setAttribute('data-scanlines', 'true')
    document.head.appendChild(style)
  }
}
