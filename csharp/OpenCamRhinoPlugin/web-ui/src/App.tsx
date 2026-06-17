import { useEffect } from 'react'
import { Plus } from 'lucide-react'
import { BackendConnectionIndicator } from '../src/components/backend-connection-indicator'
import { Button } from '../src/components/ui/button'
import { Separator } from '../src/components/ui/separator'

declare global {
  interface Window {
    __setRhinoTheme?: (theme: {
      isDark?: boolean
    }) => void
  }
}

function applyTheme(isDark: boolean) {
  const root = document.documentElement
  root.classList.toggle('dark', isDark)
}

export default function App() {
  useEffect(() => {
    window.__setRhinoTheme = ({ isDark }) => {
      applyTheme(Boolean(isDark))
    }

    applyTheme(true)

    return () => {
      delete window.__setRhinoTheme
    }
  }, [])

  return (
    <div
      data-ui-size='default'
      className='flex flex-col h-full w-full border'
    > 
      <div className='flex flex-row gap-1 p-1 items-center'>
        <Button variant='outline'>
          <Plus />
          Setup
        </Button>
        <Button variant='outline'>
          <Plus />
          Operation
        </Button>
        <BackendConnectionIndicator />
      </div>

      <Separator/>
      <div className='flex h-full w-full rounded-md border-red-500 p-2 text-foreground'>

      </div>
    </div>
  )
}
