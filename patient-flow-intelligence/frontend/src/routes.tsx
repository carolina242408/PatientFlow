import { Navigate, Outlet, Route, Routes } from "react-router"
import { hasAdminRole, useKeycloak } from "./auth/context"
import AppLayout from "./layout/AppLayout"

import Admin from "./pages/Admin"
import Dashboard from "./pages/Dashboard"
import Lhu from "./pages/Lhu"
import Unit from "./pages/Unit"
import Service from "./pages/Service"
import { LHUHierarchyPage } from "./features/lhu-hierarchy/pages/LHUHierarchy"

import Settings from "./pages/Settings"
import Account from "./pages/Account"

import NotFound from "./pages/NotFound"

const AdminRoute = () => {
  const { user } = useKeycloak()
  return hasAdminRole(user?.roles) ? <Outlet /> : <Navigate to="/dashboard" replace />
}

const AppRoutes = () => (
  <Routes>
    <Route element={<AppLayout />}>
      <Route index element={<Navigate to="/dashboard" replace />} />
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="lhu" element={<Lhu />} />
      <Route path="unit" element={<Unit />} />
      <Route path="service" element={<Service />} />
      <Route path="admin/*" element={<AdminRoute />} />

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
