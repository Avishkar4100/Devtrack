import { lazy, Suspense, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Box, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import Canvas3DErrorBoundary from './Canvas3DErrorBoundary'

function RotatingBox() {
  const meshRef = useRef()

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.x += 0.01
      meshRef.current.rotation.y += 0.01
    }
  })

  return (
    <Box ref={meshRef} args={[2, 2, 2]}>
      <meshPhongMaterial color="#6366f1" wireframe emissive="#4f46e5" />
    </Box>
  )
}

function Cube3DContent({ interactive = false }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 5], fov: 50 }}
      style={{ width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      <RotatingBox />
      {interactive && <OrbitControls />}
    </Canvas>
  )
}

export default function Cube3D({ interactive = false }) {
  return (
    <Canvas3DErrorBoundary>
      <Cube3DContent interactive={interactive} />
    </Canvas3DErrorBoundary>
  )
}
