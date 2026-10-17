import React, { Suspense } from 'react';
import { Navigate, Route } from 'react-router';

import EntitiesRoutes from 'app/entities/routes';
import AppLayout from 'app/modules/layout/app-layout';
import Dashboard from 'app/modules/dashboard/dashboard';
import Service from 'app/modules/service/service';
import LoginRedirect from 'app/modules/login/login-redirect';
import Logout from 'app/modules/login/logout';
import { hasAdminRole, useKeycloak } from 'app/config/keycloak-provider';
import PrivateRoute from 'app/shared/auth/private-route';
import ErrorBoundaryRoutes from 'app/shared/error/error-boundary-routes';
import { Authority } from 'app/shared/jhipster/constants';

const loading = <div>loading ...</div>;

const Admin = React.lazy(() => import('app/modules/administration'));

const AdminRoute = () => {
  const { user } = useKeycloak();

  return hasAdminRole(user?.roles) ? <Admin /> : <Navigate to="/dashboard" replace />;
};

const AppRoutes = () => {
  return (
    <div className="view-routes">
      <Suspense fallback={loading}>
        <ErrorBoundaryRoutes>
          {/* Custom layout wraps dashboard and future pages */}
          <Route element={<AppLayout />}>
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="service" element={<Service />} />
            <Route path="admin/*" element={<AdminRoute />} />
          </Route>

          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="logout" element={<Logout />} />
          <Route path="sign-in" element={<LoginRedirect />} />
          <Route
            path="*"
            element={
              <PrivateRoute hasAnyAuthorities={[Authority.USER]}>
                <EntitiesRoutes />
              </PrivateRoute>
            }
          />
        </ErrorBoundaryRoutes>
      </Suspense>
    </div>
  );
};

export default AppRoutes;
