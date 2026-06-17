import { useEffect, useState } from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function BackendConnectionIndicator() {
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const interval = window.setInterval(() => {
      setConnected((value) => !value)
    }, 5000)

    return () => window.clearInterval(interval)
  }, [])

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger className='ml-auto inline-flex size-[var(--button-height)] items-center justify-center rounded-md border bg-background shadow-xs dark:bg-input/30 dark:border-input'>
          <div
            className={connected ? 'size-3 rounded-full bg-green-500' : 'size-3 rounded-full bg-red-500'}
          />
        </TooltipTrigger>
        <TooltipContent>
          {connected ? 'Backend connected' : 'Backend disconnected'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
