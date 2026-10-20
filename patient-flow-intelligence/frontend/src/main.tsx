import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import './i18n'
import { KeycloakProvider } from './auth/KeycloakProvider'
import AppRoutes from './routes'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KeycloakProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </KeycloakProvider>
  </StrictMode>,
)
