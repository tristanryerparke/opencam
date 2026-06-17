import { useEffect } from 'react'
import { Button } from '../src/components/ui/button'

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
      className='flex h-full w-full border border-red-500 p-2 text-foreground'
    >
      <Button variant='outline'>hi</Button>
    </div>
  )
}
