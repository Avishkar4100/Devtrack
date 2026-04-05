import { lazy, Suspense, useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import Canvas3DErrorBoundary from './Canvas3DErrorBoundary'

function ParticleSystem() {
  const particlesRef = useRef()
  const particleCount = 500

  const particles = useMemo(() => {
    const temp = new Float32Array(particleCount * 3)
    for (let i = 0; i < particleCount * 3; i += 3) {
      temp[i] = (Math.random() - 0.5) * 20
      temp[i + 1] = (Math.random() - 0.5) * 20
      temp[i + 2] = (Math.random() - 0.5) * 20
    }
    return temp
  }, [])

  const positionAttribute = useMemo(() => {
    return new THREE.BufferAttribute(particles, 3)
  }, [particles])

  useFrame(() => {
    if (particlesRef.current) {
      particlesRef.current.rotation.x += 0.0005
      particlesRef.current.rotation.y += 0.0005

      const positions = particlesRef.current.geometry.attributes.position.array
      for (let i = 0; i < positions.length; i += 3) {
        positions[i + 1] -= 0.02
        if (positions[i + 1] < -10) {
          positions[i + 1] = 10
        }
      }
      particlesRef.current.geometry.attributes.position.needsUpdate = true
    }
  })

  return (
    <group ref={particlesRef}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" {...positionAttribute} />
        </bufferGeometry>
        <pointsMaterial
          size={0.08}
          color="#00f0ff"
          sizeAttenuation
          transparent
          opacity={0.6}
        />
      </points>
    </group>
  )
}

function ParticleFieldContent() {
  return (
    <Canvas
      camera={{ position: [0, 0, 8], fov: 75 }}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={['#09090b']} />
      <ParticleSystem />
    </Canvas>
  )
}

export default function ParticleField() {
  return (
    <Canvas3DErrorBoundary>
      <ParticleFieldContent />
    </Canvas3DErrorBoundary>
  )
}
