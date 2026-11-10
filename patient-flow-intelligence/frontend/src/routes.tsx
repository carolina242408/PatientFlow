import { Navigate, Outlet, Route, Routes } from "react-router"
import { hasAdminRole, useKeycloak } from "./auth/context"
import AppLayout from "./layout/AppLayout"

import Admin from "./pages/Admin"
import Dashboard from "./pages/Dashboard"
import ManagerHierarchy from "./pages/ManagerHierarchy"
import { LHUHierarchyPage } from "./features/lhu-hierarchy/pages/LHUHierarchy"

import Settings from "./pages/Settings"
import Account from "./pages/Account"

import NotFound from "./pages/NotFound"

const AdminRoute = () => {
  const { user } = useKeycloak()
  return hasAdminRole(user?.roles) ? <Outlet /> : <Navigate to="/dashboard" replace />
}

const HomeRoute = () => {
  const { user } = useKeycloak()
  return (
    <Navigate
      to={hasAdminRole(user?.roles) ? "/lhu-hierarchy" : "/dashboard"}
      replace
    />
  )
}

const DashboardRoute = () => {
  const { user } = useKeycloak()
  return hasAdminRole(user?.roles) ? <Navigate to="/lhu-hierarchy" replace /> : <Dashboard />
}

const AppRoutes = () => (
  <Routes>
    <Route element={<AppLayout />}>
      <Route index element={<HomeRoute />} />
      <Route path="dashboard" element={<DashboardRoute />} />
      <Route path="manager-hierarchy" element={<ManagerHierarchy />} />

      <Route path="settings" element={<Settings />} />
      <Route path="account" element={<Account />} />

      <Route element={<AdminRoute />}>
        <Route path="admin/*" element={<Admin />} />
        <Route path="lhu-hierarchy" element={<LHUHierarchyPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Route>
  </Routes>
)

export default AppRoutes
