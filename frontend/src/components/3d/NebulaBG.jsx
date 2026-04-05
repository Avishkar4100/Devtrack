import { lazy, Suspense, useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import Canvas3DErrorBoundary from './Canvas3DErrorBoundary'

function NebulaParticles() {
  const particlesRef = useRef()
  const particleCount = 1000

  const particles = useMemo(() => {
    const temp = new Float32Array(particleCount * 3)
    const colors = new Float32Array(particleCount * 3)

    for (let i = 0; i < particleCount * 3; i += 3) {
      temp[i] = (Math.random() - 0.5) * 50
      temp[i + 1] = (Math.random() - 0.5) * 50
      temp[i + 2] = (Math.random() - 0.5) * 50

      // Color variation (cyan to magenta to purple)
      const rand = Math.random()
      if (rand < 0.33) {
        colors[i] = 0 // R
        colors[i + 1] = 1 // G (cyan)
        colors[i + 2] = 1 // B
      } else if (rand < 0.66) {
        colors[i] = 1 // R
        colors[i + 1] = 0 // G (magenta)
        colors[i + 2] = 1 // B
      } else {
        colors[i] = 0.6 // R
        colors[i + 1] = 0 // G (purple)
        colors[i + 2] = 1 // B
      }
    }
    return { positions: temp, colors }
  }, [])

  useFrame(() => {
    if (particlesRef.current) {
      particlesRef.current.rotation.x += 0.0001
      particlesRef.current.rotation.y += 0.0002
    }
  })

  return (
    <group ref={particlesRef}>
      <points>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            array={particles.positions}
            count={particleCount}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-color"
            array={particles.colors}
            count={particleCount}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.15}
          sizeAttenuation
          vertexColors
          transparent
          opacity={0.8}
        />
      </points>
    </group>
  )
}

function NebulaBGContent() {
  return (
    <Canvas
      camera={{ position: [0, 0, 15], fov: 75 }}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={['#0a0a0f']} />
      <NebulaParticles />
    </Canvas>
  )
}

export default function NebulaBG() {
  return (
    <Canvas3DErrorBoundary>
      <NebulaBGContent />
    </Canvas3DErrorBoundary>
  )
}
