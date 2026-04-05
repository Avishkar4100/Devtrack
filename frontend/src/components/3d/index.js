// Lazy-loaded 3D components to prevent initialization errors
import { lazy } from 'react'

export const Cube3D = lazy(() => import('./Cube3D').then(m => ({ default: m.default })))
export const Sphere3D = lazy(() => import('./Sphere3D').then(m => ({ default: m.default })))
export const ParticleField = lazy(() => import('./ParticleField').then(m => ({ default: m.default })))
export const NebulaBG = lazy(() => import('./NebulaBG').then(m => ({ default: m.default })))
export const Hero3D = lazy(() => import('./Hero3D').then(m => ({ default: m.default })))
