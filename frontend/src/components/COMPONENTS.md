# DevTrack UI Components Library

A comprehensive, modern UI component library built with React, Tailwind CSS, and Three.js. Features cyberpunk aesthetic, 3D visualizations, and smooth micro-interactions.

## 🎨 Component Categories

### Core UI Components (`src/components/ui`)
- **Badge** - Tags, labels, and badges with multiple variants
- **Button** - Versatile buttons with loading states and icons
- **Card** - Container components with hover and glow effects
- **Input** - Form inputs with validation and variants
- **Modal** - Dialog boxes with customizable sizes
- **ProgressBar** - Progress indicators with multiple variants
- **Spinner** - Loading indicators
- **Tooltip** - Contextual help bubbles

### Cyberpunk Components (`src/components/ui`)
- **CyberpunkCard** - Neon-bordered cards with glitch effect corners
- **CyberpunkChart** - Data visualization with cyberpunk styling
- **HologramText** - Glowing text with hologram effect
- **ScanlineEffect** - Horizontal scan line overlay

### Text Effects (`src/components/effects`)
- **TypingText** - Typewriter animation with blinking cursor
- **GlitchText** - Random character glitch effect

### 3D Components (`src/components/3d`)
- **Cube3D** - Rotating 3D cube with interactive OrbitControls
- **Sphere3D** - Animated sphere with glowing effects
- **ParticleField** - Floating particle animation
- **NebulaBG** - Space nebula background with colored particles
- **Hero3D** - Animated logo/hero element

## 🚀 Quick Start

### Import Components
```jsx
import { Button, Card, Badge, Input } from '@/components/ui'
import { TypingText, GlitchText } from '@/components/effects'
import { Cube3D, Sphere3D } from '@/components/3d'
```

### Usage Examples

#### Button
```jsx
<Button variant="primary">Click Me</Button>
<Button variant="neon" loading>Loading...</Button>
<Button disabled>Disabled</Button>
```

#### Card
```jsx
<Card hover interactive>
  <div className="p-6">
    <h3>Interactive Card</h3>
  </div>
</Card>
```

#### CyberpunkCard
```jsx
<CyberpunkCard title="System" neonColor="cyan">
  <p>Neon-glowing content</p>
</CyberpunkCard>
```

#### 3D Components
```jsx
<div className="w-96 h-96">
  <Cube3D interactive />
</div>
```

## 🎯 Component Props

### Button Props
- `variant` - 'primary' | 'secondary' | 'ghost' | 'neon' | 'danger'
- `size` - 'sm' | 'md' | 'lg'
- `loading` - Show loading spinner
- `disabled` - Disable button
- `icon` - React component for icon
- `className` - Additional Tailwind classes

### Card Props
- `hover` - Add hover effect
- `glow` - Add glow shadow
- `interactive` - Full interactive state with lift effect
- `className` - Additional Tailwind classes

### CyberpunkChart Props
- `type` - 'bar' | 'line'
- `data` - Array of data points
- `dataKey` - Key to read from data objects
- `color` - Neon color
- `title` - Chart title
- `className` - Additional classes

### 3D Component Props
- `interactive` - Enable OrbitControls

## 🎨 Tailwind Extended Config

The project includes extended Tailwind configuration with:
- **Custom Colors**: Primary, surface, border, neon colors (cyan, magenta, purple, pink, green, yellow, blue)
- **Animations**: Fade, slide, scale, shimmer, glow, glitch, aurora, and more
- **Shadows**: Glow, card, neon glow, glass effect
- **Custom Fonts**: Inter (sans), JetBrains Mono (mono)

## ✨ Features

### Text Effects
- Smooth typing animation
- Character glitch effect
- Customizable speed and styling

### 3D Visualizations
- Interactive 3D models with mouse controls
- Particle systems
- Animated materials
- Responsive canvas rendering

### Cyberpunk Aesthetic
- Neon borders and glows
- Glitch corner decorations
- Scan line overlays
- Monospace typography
- High contrast colors

### Micro-Interactions
- Smooth transitions (0.2-0.4s)
- Button press animations
- Hover scale effects
- Focus ring states
- Active state indicators
- Ripple effects
- Entrance animations

## 📦 Installation

All dependencies are already installed. To use the components:

```bash
# Install dependencies (if needed)
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## 🎯 Demo Page

Visit `/components-demo` to see all components in action with:
- Interactive examples
- Code snippets
- Live customization
- Full feature showcase

## 🌐 Color Palette

### Primary Colors
- Primary: `#6366f1` (Indigo)
- Secondary: `#8b5cf6` (Violet)

### Neon Colors
- Cyan: `#00f0ff`
- Magenta: `#ff00ff`
- Purple: `#9d00ff`
- Pink: `#ff0080`
- Green: `#00ff00`
- Yellow: `#ffff00`

### Surface Colors
- Surface-0: `#09090b`
- Surface-1: `#0f0f12`
- Surface-2: `#18181b`
- Surface-3: `#1f1f23`
- Surface-4: `#27272a`

## 🔧 Customization

All components support Tailwind class extensions via the `className` prop. Modify `tailwind.config.js` to customize colors, animations, and effects.

## 📝 Notes

- Components use `transition-all` with duration 200-300ms for smooth interactions
- 3D components require Three.js (already included)
- Icons use `@heroicons/react`
- Animations are GPU-accelerated using CSS transforms

## 🎓 Learn More

- [Tailwind CSS](https://tailwindcss.com)
- [React Three Fiber](https://docs.pmnd.rs/react-three-fiber)
- [Framer Motion](https://www.framer.com/motion)
- [GSAP](https://gsap.com)

---

**DevTrack UI Library** - Built with React, Tailwind CSS, and modern web technologies.
