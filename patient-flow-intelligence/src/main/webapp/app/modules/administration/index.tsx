import React from 'react';
import { Navigate, Route } from 'react-router';

import ErrorBoundaryRoutes from 'app/shared/error/error-boundary-routes';

import Docs from './docs/docs';
import Gateway from './gateway/gateway';

const AdministrationRoutes = () => (
  <div>
    <ErrorBoundaryRoutes>
      <Route index element={<Navigate to="gateway" replace />} />
      <Route path="gateway" element={<Gateway />} />
      <Route path="docs" element={<Docs />} />
    </ErrorBoundaryRoutes>
  </div>
);

export default AdministrationRoutes;
