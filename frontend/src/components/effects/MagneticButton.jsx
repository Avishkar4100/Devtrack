import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'

export default function MagneticButton({ children, className = '', href, ...props }) {
  const ref = useRef(null)

  useEffect(() => {
    const button = ref.current
    if (!button) return

    const onMove = (e) => {
      const rect = button.getBoundingClientRect()
      const x = (e.clientX - rect.left - rect.width / 2) * 0.3
      const y = (e.clientY - rect.top - rect.height / 2) * 0.3

      gsap.to(button, {
        x,
        y,
        duration: 0.3,
        ease: 'power2.out',
      })
    }

    const onLeave = () => {
      gsap.to(button, {
        x: 0,
        y: 0,
        duration: 0.6,
        ease: 'elastic.out(1, 0.5)',
      })
    }

    button.addEventListener('mousemove', onMove)
    button.addEventListener('mouseleave', onLeave)

    return () => {
      button.removeEventListener('mousemove', onMove)
      button.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  const Component = href ? 'a' : 'button'

  return (
    <Component
      ref={ref}
      href={href}
      className={`magnetic-btn ${className}`}
      {...props}
    >
      {children}
    </Component>
  )
}
