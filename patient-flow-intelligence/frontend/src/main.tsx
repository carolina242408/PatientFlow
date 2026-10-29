import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import './index.css'
import './i18n'
import { KeycloakProvider } from './auth/KeycloakProvider'
import AppRoutes from './routes'

document.documentElement.classList.toggle(
  'theme-dark',
  localStorage.getItem('theme') === 'dark',
)
const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KeycloakProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </QueryClientProvider>
    </KeycloakProvider>
  </StrictMode>,
)
