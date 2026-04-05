import { useEffect, useRef } from 'react'

export default function GlitchText({ text, className = '' }) {
  const ref = useRef(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const glitch = () => {
      const originalText = text
      const glitchChars = '!<>-_\\/[]{}—=+*^?#________'

      let glitchedText = ''
      for (let i = 0; i < originalText.length; i++) {
        if (Math.random() > 0.8) {
          glitchedText += glitchChars[Math.floor(Math.random() * glitchChars.length)]
        } else {
          glitchedText += originalText[i]
        }
      }

      element.textContent = glitchedText

      setTimeout(() => {
        element.textContent = originalText
      }, 100)
    }

    const interval = setInterval(glitch, Math.random() * 3000 + 2000)
    return () => clearInterval(interval)
  }, [text])

  return (
    <span ref={ref} className={`glitch-text ${className}`}>
      {text}
    </span>
  )
}
