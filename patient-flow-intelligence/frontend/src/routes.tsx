import { Navigate, Outlet, Route, Routes, useOutletContext } from "react-router"
import { hasAdminRole, useKeycloak } from "./auth/context"
import AppLayout from "./layout/AppLayout"

import Admin from "./pages/Admin"
import Dashboard from "./pages/Dashboard"
import ManagerHierarchy from "./pages/ManagerHierarchy"
import { LHUHierarchyPage } from "./features/lhu-hierarchy/pages/LHUHierarchy"

import Settings from "./pages/Settings"
import Account from "./pages/Account"

import NotFound from "./pages/NotFound"

const RequireAdmin = () => {
  const { user } = useKeycloak()
  if (hasAdminRole(user?.roles)) return <Outlet />
  return user?.roles.includes('MANAGER_ROLE') && user.scopeType
    ? <Navigate to="/dashboard" replace />
    : <Navigate to="/settings" replace />
}

const RequireManagerScope = () => {
  const { user } = useKeycloak()
  const outletContext = useOutletContext()
  if (hasAdminRole(user?.roles)) return <Navigate to="/lhu-hierarchy" replace />
  return user?.roles.includes('MANAGER_ROLE') && user.scopeType
    ? <Outlet context={outletContext} />
    : <Navigate to="/settings" replace />
}

const RoleHome = () => {
  const { user } = useKeycloak()
  if (hasAdminRole(user?.roles)) return <Navigate to="/lhu-hierarchy" replace />
  if (user?.roles.includes('MANAGER_ROLE') && user.scopeType) return <Navigate to="/dashboard" replace />
  return <Navigate to="/settings" replace />
}

const DashboardRoute = () => {
  const { user } = useKeycloak()
  if (hasAdminRole(user?.roles)) return <Navigate to="/lhu-hierarchy" replace />
  if (user?.roles.includes('MANAGER_ROLE') && user.scopeType) return <Dashboard />
  return <Navigate to="/settings" replace />
}

const AppRoutes = () => (
  <Routes>
    <Route element={<AppLayout />}>
      <Route index element={<RoleHome />} />
      <Route path="dashboard" element={<DashboardRoute />} />
      <Route element={<RequireManagerScope />}>
        <Route path="manager-hierarchy" element={<ManagerHierarchy />} />
      </Route>

      <Route path="settings" element={<Settings />} />
      <Route path="account" element={<Account />} />

      <Route element={<RequireAdmin />}>
        <Route path="admin/*" element={<Admin />} />
        <Route path="lhu-hierarchy" element={<LHUHierarchyPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Route>
  </Routes>
)

export default AppRoutes
