import { useEffect, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { BackendConnectionIndicator } from '../src/components/backend-connection-indicator'
import { Button } from '../src/components/ui/button'
import { Separator } from '../src/components/ui/separator'
import { SetupModal } from './setup-modal'

type OpenCamBootstrap = {
  isDark?: boolean
  mode?: string
  route?: string
}

type BridgeMessage = {
  type: string
  payload?: Record<string, unknown>
}

declare global {
  interface Window {
    __OPENCAM_BOOTSTRAP__?: OpenCamBootstrap
    __setRhinoTheme?: (theme: {
      isDark?: boolean
    }) => void
  }
}

function applyTheme(isDark: boolean) {
  const root = document.documentElement
  root.classList.toggle('dark', isDark)
}

function sendBridgeMessage(type: string, payload: Record<string, unknown> = {}) {
  const message: BridgeMessage = { type, payload }
  const serialized = JSON.stringify(message)

  window.location.href = `rhino://opencam?${encodeURIComponent(serialized)}`
}

function getRoute() {
  const bootstrapRoute = window.__OPENCAM_BOOTSTRAP__?.route
  if (bootstrapRoute) {
    return bootstrapRoute
  }

  return window.location.pathname.endsWith('/setup') ? '/setup' : '/'
}

function AppFrame({ children }: { children: ReactNode }) {
  return (
    <div
      data-ui-size='default'
      className='flex h-full w-full flex-col border bg-background text-foreground'
    >
      {children}
    </div>
  )
}

function PanelHome() {
  return (
    <AppFrame>
      <div className='flex flex-row items-center gap-1 p-1'>
        <Button variant='outline' onClick={() => sendBridgeMessage('openSetupModal')}>
          <Plus />
          Setup
        </Button>
        <Button variant='outline'>
          <Plus />
          Operation
        </Button>
        <BackendConnectionIndicator />
      </div>

      <Separator />
      <div className='flex h-full w-full rounded-md border-red-500 p-2' />
    </AppFrame>
  )
}

export default function App() {
  useEffect(() => {
    window.__setRhinoTheme = ({ isDark }) => {
      applyTheme(Boolean(isDark))
    }

    applyTheme(window.__OPENCAM_BOOTSTRAP__?.isDark ?? true)

    return () => {
      delete window.__setRhinoTheme
    }
  }, [])

  return getRoute() === '/setup'
    ? (
        <AppFrame>
          <SetupModal onClose={(result) => sendBridgeMessage('closeModal', { result })} />
        </AppFrame>
      )
    : <PanelHome />
}
