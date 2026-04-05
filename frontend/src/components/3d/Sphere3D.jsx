import { lazy, Suspense, useRef, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Sphere, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import Canvas3DErrorBoundary from './Canvas3DErrorBoundary'

function AnimatedSphere() {
  const meshRef = useRef()
  const materialRef = useRef()

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.3) * 0.5
      meshRef.current.rotation.y += 0.005
    }

    if (materialRef.current) {
      materialRef.current.emissiveIntensity =
        0.5 + Math.sin(state.clock.elapsedTime * 2) * 0.3
    }
  })

  return (
    <Sphere ref={meshRef} args={[2, 32, 32]}>
      <meshPhongMaterial
        ref={materialRef}
        color="#8b5cf6"
        emissive="#6366f1"
        wireframe={false}
        metalness={0.8}
        roughness={0.2}
      />
    </Sphere>
  )
}

function Sphere3DContent({ interactive = false }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 6], fov: 50 }}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={['#09090b']} />
      <ambientLight intensity={0.6} />
      <pointLight position={[10, 10, 5]} intensity={1.5} color="#6366f1" />
      <pointLight position={[-10, -10, 5]} intensity={0.8} color="#8b5cf6" />
      <AnimatedSphere />
      {interactive && <OrbitControls />}
    </Canvas>
  )
}

export default function Sphere3D({ interactive = false }) {
  return (
    <Canvas3DErrorBoundary>
      <Sphere3DContent interactive={interactive} />
    </Canvas3DErrorBoundary>
  )
}
