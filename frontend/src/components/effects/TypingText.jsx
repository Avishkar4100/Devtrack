import { useEffect, useRef, useState } from 'react'

export default function TypingText({ text, speed = 50, className = '' }) {
  const [displayText, setDisplayText] = useState('')
  const ref = useRef(null)
  const indexRef = useRef(0)

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (indexRef.current < text.length) {
        setDisplayText((prev) => prev + text[indexRef.current])
        indexRef.current += 1
      }
    }, speed)

    return () => clearTimeout(timeout)
  }, [displayText, text, speed])

  return (
    <span ref={ref} className={`typing-text ${className}`}>
      {displayText}
      <span className='blinking-cursor'>|</span>
    </span>
  )
}
