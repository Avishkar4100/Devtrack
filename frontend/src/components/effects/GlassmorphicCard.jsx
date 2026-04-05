import { motion } from 'framer-motion'

export default function GlassmorphicCard({ children, className = '', onClick, ...props }) {
  return (
    <motion.div
      className={`glass-card ${className}`}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      onClick={onClick}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      {...props}
    >
      {children}
    </motion.div>
  )
}
