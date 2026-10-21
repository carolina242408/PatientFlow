import { Navigate, Route, Routes } from 'react-router'
import { hasAdminRole, useKeycloak } from './auth/context'
import AppLayout from './layout/AppLayout'
import Admin from './pages/Admin'
import Dashboard from './pages/Dashboard'
import NotFound from './pages/NotFound'
import Service from './pages/Service'

const AdminRoute = () => {
  const { user } = useKeycloak()
  return hasAdminRole(user?.roles) ? <Admin /> : <Navigate to="/dashboard" replace />
}

const AppRoutes = () => (
  <Routes>
    <Route element={<AppLayout />}>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="service" element={<Service />} />
      <Route path="admin/*" element={<AdminRoute />} />
      <Route path="*" element={<NotFound />} />
    </Route>
  </Routes>
)

export default AppRoutes
