import { useState, Suspense } from 'react'
import { Link } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  ProgressBar,
  Spinner,
  Tooltip,
  CyberpunkCard,
  CyberpunkChart,
  HologramText,
  ScanlineEffect,
} from '@/components/ui'
import { TypingText, GlitchText } from '@/components/effects'
import { Cube3D, ParticleField, Sphere3D, NebulaBG, Hero3D } from '@/components/3d'
import { HomeIcon } from '@heroicons/react/24/outline'

function Loading3D() {
  return (
    <div className="flex items-center justify-center h-full bg-surface-2 rounded">
      <div className="flex flex-col items-center gap-2">
        <Spinner />
        <p className="text-sm text-text-secondary">Loading 3D...</p>
      </div>
    </div>
  )
}

export default function ComponentsDemo() {
  const [modalOpen, setModalOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')

  return (
    <div className="min-h-screen bg-surface-0 text-white">
      {/* Header */}
      <header className="border-b border-border-1 bg-surface-1/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">UI Components Demo</h1>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-3 transition-colors"
          >
            <HomeIcon className="w-4 h-4" />
            Home
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-12 space-y-16">
        {/* Effects Section */}
        <section>
          <h2 className="text-3xl font-bold mb-8">Text Effects</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="p-8">
              <h3 className="text-lg font-semibold mb-4">Typing Effect</h3>
              <TypingText
                text="Welcome to DevTrack AI revolution"
                speed={50}
                className="text-2xl text-primary-400"
              />
            </Card>

            <Card className="p-8">
              <h3 className="text-lg font-semibold mb-4">Glitch Effect</h3>
              <GlitchText
                text="System Status: ONLINE"
                className="text-2xl text-neon-cyan"
              />
            </Card>
          </div>
        </section>

        {/* 3D Components Section */}
        <section>
          <h2 className="text-3xl font-bold mb-8">3D Visualizations</h2>
          <div className="mb-6 p-4 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
            <p className="text-sm text-yellow-200">
              💡 <span className="font-semibold">Note:</span> 3D components require WebGL support. If you see placeholder boxes below, your browser may not support WebGL or you may need to enable it in your browser settings.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="p-0 overflow-hidden h-80">
              <Suspense fallback={<Loading3D />}>
                <div className="w-full h-full">
                  <Hero3D />
                </div>
              </Suspense>
            </Card>

            <Card className="p-0 overflow-hidden h-80">
              <Suspense fallback={<Loading3D />}>
                <div className="w-full h-full">
                  <Cube3D interactive />
                </div>
              </Suspense>
            </Card>

            <Card className="p-0 overflow-hidden h-80">
              <Suspense fallback={<Loading3D />}>
                <div className="w-full h-full">
                  <Sphere3D interactive />
                </div>
              </Suspense>
            </Card>

            <Card className="p-0 overflow-hidden h-80">
              <Suspense fallback={<Loading3D />}>
                <div className="w-full h-full">
                  <ParticleField />
                </div>
              </Suspense>
            </Card>

            <Card className="p-0 overflow-hidden h-80 md:col-span-2">
              <Suspense fallback={<Loading3D />}>
                <div className="w-full h-full">
                  <NebulaBG />
                </div>
              </Suspense>
            </Card>
          </div>
        </section>

        {/* Badges Section */}
        <section>
          <h2 className="text-3xl font-bold mb-8">Badges</h2>
          <Card className="p-8">
            <div className="flex flex-wrap gap-4">
              <Badge>Default</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="danger">Danger</Badge>
              <Badge variant="neon">Neon</Badge>
              <Badge variant="magenta">Magenta</Badge>
              <Badge size="sm">Small</Badge>
              <Badge size="lg">Large</Badge>
            </div>
          </Card>
        </section>

        {/* Buttons Section */}
        <section>
          <h2 className="text-3xl font-bold mb-8">Buttons</h2>
          <Card className="p-8">
            <div className="flex flex-wrap gap-4">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="neon">Neon</Button>
              <Button variant="danger">Danger</Button>
              <Button size="sm">Small</Button>
              <Button size="lg">Large</Button>
              <Button disabled>Disabled</Button>
              <Button loading>Loading</Button>
              <Button onClick={() => setModalOpen(true)}>Open Modal</Button>
            </div>
          </Card>
        </section>

        {/* Cards Section */}
        <section>
          <h2 className="text-3xl font-bold mb-8">Cards</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card hover>
              <div className="p-6">
                <h3 className="font-semibold mb-2">Hover Card</h3>
                <p className="text-gray-400">Hover over this card to see the effect</p>
              </div>
            </Card>

            <Card glow>
              <div className="p-6">
                <h3 className="font-semibold mb-2">Glowing Card</h3>
                <p className="text-gray-400">This card has a glowing effect</p>
              </div>
            </Card>

            <Card interactive>
              <div className="p-6">
                <h3 className="font-semibold mb-2">Interactive Card</h3>
                <p className="text-gray-400">This card is fully interactive</p>
              </div>
            </Card>
          </div>
        </section>

        {/* Input Section */}
        <section>
          <h2 className="text-3xl font-bold mb-8">Form Inputs</h2>
          <Card className="p-8 max-w-md">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Default Input</label>
                <Input
                  placeholder="Enter text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Neon Variant</label>
                <Input placeholder="Neon style" variant="neon" />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Error State</label>
                <Input error placeholder="Error input" />
              </div>
            </div>
          </Card>
        </section>

        {/* Progress Section */}
        <section>
          <h2 className="text-3xl font-bold mb-8">Progress Bars</h2>
          <Card className="p-8 space-y-6">
            <div>
              <label className="block text-sm font-medium mb-2">0%</label>
              <ProgressBar progress={0} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">50%</label>
              <ProgressBar progress={50} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">100%</label>
              <ProgressBar progress={100} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Neon 75%</label>
              <ProgressBar progress={75} variant="neon" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Success 85%</label>
              <ProgressBar progress={85} variant="success" />
            </div>
          </Card>
        </section>

        {/* Spinner Section */}
        <section>
          <h2 className="text-3xl font-bold mb-8">Spinners</h2>
          <Card className="p-8">
            <div className="flex items-center gap-12">
              <div className="flex flex-col items-center gap-2">
                <Spinner size="sm" />
                <span className="text-sm text-gray-400">Small</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Spinner size="md" />
                <span className="text-sm text-gray-400">Medium</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Spinner size="lg" />
                <span className="text-sm text-gray-400">Large</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Spinner size="md" variant="neon" />
                <span className="text-sm text-gray-400">Neon</span>
              </div>
            </div>
          </Card>
        </section>

        {/* Tooltip Section */}
        <section>
          <h2 className="text-3xl font-bold mb-8">Tooltips</h2>
          <Card className="p-8">
            <div className="flex flex-wrap gap-8 items-center justify-center">
              <Tooltip content="Top tooltip" position="top">
                <Button variant="secondary">Top</Button>
              </Tooltip>

              <Tooltip content="Bottom tooltip" position="bottom">
                <Button variant="secondary">Bottom</Button>
              </Tooltip>

              <Tooltip content="Left tooltip" position="left">
                <Button variant="secondary">Left</Button>
              </Tooltip>

              <Tooltip content="Right tooltip" position="right">
                <Button variant="secondary">Right</Button>
              </Tooltip>
            </div>
          </Card>
        </section>

        {/* Cyberpunk Section */}
        <section>
          <h2 className="text-3xl font-bold mb-8">Cyberpunk Components</h2>
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <CyberpunkCard title="System" glitchText="001" neonColor="cyan">
                <p className="text-sm text-gray-300">
                  Neon-glowing card with glitch corners
                </p>
                <Button variant="neon" className="mt-4 w-full">
                  ACTIVATE
                </Button>
              </CyberpunkCard>

              <CyberpunkCard title="Network" glitchText="002" neonColor="magenta">
                <p className="text-sm text-gray-300">
                  Magenta themed cyberpunk card
                </p>
                <Button variant="neon" className="mt-4 w-full">
                  CONNECT
                </Button>
              </CyberpunkCard>

              <CyberpunkCard title="Override" glitchText="003" neonColor="purple">
                <p className="text-sm text-gray-300">
                  Purple neon aesthetic
                </p>
                <Button variant="neon" className="mt-4 w-full">
                  BREACH
                </Button>
              </CyberpunkCard>
            </div>

            {/* Hologram Text Examples */}
            <Card className="p-8">
              <h3 className="text-lg font-bold mb-6 text-white">Hologram Text</h3>
              <div className="space-y-6">
                <HologramText text="AI PROTOCOL" color="cyan" size="lg" />
                <HologramText text="NEURAL NETWORK" color="magenta" size="lg" />
                <HologramText text="DATA STREAM" color="purple" size="lg" />
              </div>
            </Card>

            {/* Charts with Cyberpunk styling */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="p-6 h-80">
                <CyberpunkChart
                  type="bar"
                  title="System Load"
                  data={[
                    { name: 'Mon', value: 45 },
                    { name: 'Tue', value: 52 },
                    { name: 'Wed', value: 48 },
                    { name: 'Thu', value: 61 },
                    { name: 'Fri', value: 55 },
                  ]}
                  color="#00f0ff"
                />
              </Card>

              <Card className="p-6 h-80">
                <CyberpunkChart
                  type="line"
                  title="Network Activity"
                  data={[
                    { name: '00:00', value: 30 },
                    { name: '06:00', value: 45 },
                    { name: '12:00', value: 70 },
                    { name: '18:00', value: 80 },
                    { name: '23:59', value: 65 },
                  ]}
                  strokeColor="#8b5cf6"
                />
              </Card>
            </div>

            {/* Scanline Effect */}
            <Card className="p-8 relative overflow-hidden h-40 flex items-center justify-center">
              <ScanlineEffect color="cyan" intensity={0.3}>
                <div className="text-center z-10 relative">
                  <HologramText text="SCANNING..." color="cyan" animated={true} />
                </div>
              </ScanlineEffect>
            </Card>
          </div>
        </section>

        {/* Modal Section */}
        <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Modal Dialog">
          <div className="space-y-4">
            <p>This is a modal dialog component. You can customize its size and content.</p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => setModalOpen(false)}>
                Close
              </Button>
              <Button variant="secondary">Action</Button>
            </div>
          </div>
        </Modal>
      </main>

      {/* Footer */}
      <footer className="border-t border-border-1 bg-surface-1/50 backdrop-blur-sm mt-20">
        <div className="max-w-6xl mx-auto px-6 py-8 text-center text-gray-400">
          <p>UI Components Demo • Built with React & Tailwind CSS</p>
        </div>
      </footer>
    </div>
  )
}
