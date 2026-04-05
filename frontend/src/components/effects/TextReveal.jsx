import { motion } from 'framer-motion'

const container = {
  hidden: { opacity: 0 },
  visible: (i = 1) => ({
    opacity: 1,
    transition: { staggerChildren: 0.03, delayChildren: 0.04 * i },
  }),
}

const child = {
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring',
      damping: 12,
      stiffness: 100,
    },
  },
  hidden: {
    opacity: 0,
    y: 10,
    transition: {
      type: 'spring',
      damping: 12,
      stiffness: 100,
    },
  },
}

export default function TextReveal({ text, className = '', as: Component = 'h2' }) {
  return (
    <motion.div
      className={`text-reveal ${className}`}
      variants={container}
      initial="hidden"
      animate="visible"
    >
      {typeof text === 'string' ? (
        <Component>
          {text.split('').map((char, index) => (
            <motion.span key={index} variants={child}>
              {char === ' ' ? '\u00A0' : char}
            </motion.span>
          ))}
        </Component>
      ) : (
        text
      )}
    </motion.div>
  )
}
