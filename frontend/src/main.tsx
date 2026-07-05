import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { getOpenCamBootstrap, sendRhinoUiDebug } from './bootstrap'

const queryClient = new QueryClient()

const rootElement = document.getElementById('root')

sendRhinoUiDebug('info', 'main.tsx boot', {
  hasRootElement: Boolean(rootElement),
  bootstrap: getOpenCamBootstrap(),
})

if (!rootElement) {
  sendRhinoUiDebug('error', 'missing #root element')
  throw new Error('Missing root element')
}

try {
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )

  sendRhinoUiDebug('info', 'react root render scheduled')
} catch (error) {
  sendRhinoUiDebug('error', 'react root render failed', {
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  })
  throw error
}
