import 'react-toastify/dist/ReactToastify.css';
import './app.scss';
import 'app/config/dayjs';

import React, { useEffect } from 'react';
import { Card } from 'react-bootstrap';
import { BrowserRouter } from 'react-router';
import { ToastContainer } from 'react-toastify';

import { useAppDispatch, useAppSelector } from 'app/config/store';
import { KeycloakProvider } from 'app/config/keycloak-provider';
import AppRoutes from 'app/routes';
import { hasAnyAuthority } from 'app/shared/auth/private-route';
import ErrorBoundary from 'app/shared/error/error-boundary';
import { Authority } from 'app/shared/jhipster/constants';
import Footer from 'app/shared/layout/footer/footer';
import { getProfile } from 'app/shared/reducers/application-profile';
import { getSession } from 'app/shared/reducers/authentication';

const baseHref = document.querySelector('base')!.getAttribute('href')!.replace(/\/$/, '');

// Inner app — runs only after Keycloak auth is confirmed
const InnerApp = () => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    // Now safe: axios-interceptor will attach the Keycloak token
    dispatch(getSession());
    dispatch(getProfile());
  }, []);

  const currentLocale = useAppSelector(state => state.locale.currentLocale);
  const ribbonEnv = useAppSelector(state => state.applicationProfile.ribbonEnv);
  const isInProduction = useAppSelector(state => state.applicationProfile.inProduction);
  const isOpenAPIEnabled = useAppSelector(state => state.applicationProfile.isOpenAPIEnabled);

  return (
    <BrowserRouter basename={baseHref}>
      <div className="app-container">
        <ToastContainer position="top-left" className="toastify-container" toastClassName="toastify-toast" />
        <ErrorBoundary>
          <div className="view-container" id="app-view-container">
            <ErrorBoundary>
              <AppRoutes />
            </ErrorBoundary>
          </div>
        </ErrorBoundary>
      </div>
    </BrowserRouter>
  );
};

export const App = () => (
  <KeycloakProvider>
    <InnerApp />
  </KeycloakProvider>
);

export default App;