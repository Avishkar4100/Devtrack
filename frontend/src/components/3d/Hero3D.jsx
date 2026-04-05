import { Canvas, useFrame } from '@react-three/fiber'
import { lazy, Suspense, useRef, useMemo } from 'react'
import * as THREE from 'three'
import Canvas3DErrorBoundary from './Canvas3DErrorBoundary'

function AnimatedLogo() {
  const groupRef = useRef()
  const torusRef = useRef()
  const particlesRef = useRef()

  // Create particles
  const particleCount = 100
  const particlesData = useMemo(() => {
    const positions = new Float32Array(particleCount * 3)
    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 8
      positions[i + 1] = (Math.random() - 0.5) * 8
      positions[i + 2] = (Math.random() - 0.5) * 8
    }
    return positions
  }, [])

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.z += 0.001
    }

    if (torusRef.current) {
      torusRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.5) * 0.3
      torusRef.current.rotation.y += 0.003
    }

    if (particlesRef.current) {
      const positions = particlesRef.current.geometry.attributes.position.array
      for (let i = 0; i < positions.length; i += 3) {
        positions[i + 1] += 0.01
        if (positions[i + 1] > 4) {
          positions[i + 1] = -4
        }
      }
      particlesRef.current.geometry.attributes.position.needsUpdate = true
    }
  })

  return (
    <group ref={groupRef}>
      {/* Central Torus */}
      <mesh ref={torusRef}>
        <torusGeometry args={[2, 0.6, 16, 32]} />
        <meshPhongMaterial
          color="#6366f1"
          emissive="#4f46e5"
          emissiveIntensity={0.5}
          wireframe={false}
        />
      </mesh>

      {/* Spiral Rings */}
      <mesh position={[0, 0, 0]} rotation={[Math.PI / 2.5, 0, 0]}>
        <torusGeometry args={[3, 0.3, 12, 64]} />
        <meshPhongMaterial
          color="#8b5cf6"
          emissive="#7c3aed"
          emissiveIntensity={0.3}
          transparent
          opacity={0.6}
        />
      </mesh>

      <mesh position={[0, 0, 0]} rotation={[0, Math.PI / 3, Math.PI / 2.5]}>
        <torusGeometry args={[2.5, 0.25, 12, 64]} />
        <meshPhongMaterial
          color="#00f0ff"
          emissive="#00d4ff"
          emissiveIntensity={0.2}
          transparent
          opacity={0.5}
        />
      </mesh>

      {/* Floating Particles */}
      <group ref={particlesRef}>
        <points>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              array={particlesData}
              count={particleCount}
              itemSize={3}
            />
          </bufferGeometry>
          <pointsMaterial size={0.1} color="#00f0ff" sizeAttenuation transparent opacity={0.7} />
        </points>
      </group>
    </group>
  )
}

function Hero3DContent() {
  return (
    <Canvas
      camera={{ position: [0, 0, 8], fov: 50 }}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={['transparent']} />
      <ambientLight intensity={0.6} />
      <pointLight position={[10, 10, 10]} intensity={1} color="#6366f1" />
      <pointLight position={[-10, -5, 5]} intensity={0.8} color="#8b5cf6" />
      <AnimatedLogo />
    </Canvas>
  )
}

export default function Hero3D() {
  return (
    <Canvas3DErrorBoundary>
      <Hero3DContent />
    </Canvas3DErrorBoundary>
  )
}
