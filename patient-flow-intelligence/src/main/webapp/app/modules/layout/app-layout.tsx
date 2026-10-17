import React from 'react';
import { Outlet, useLocation } from 'react-router';
import Sidebar from './sidebar/sidebar';
import TopBar from './top-bar/top-bar';
import './app-layout.scss';

interface PageMetadata {
  pageName: string;
  pageDescription: string;
}

const pageMetadataByPath: Record<string, PageMetadata> = {
  '/dashboard': {
    pageName: 'Dashboard',
    pageDescription: 'Welcome to your patient flow overview',
  },
  '/service': {
    pageName: 'Services',
    pageDescription: 'Manage patient flow services',
  },
  '/admin': {
    pageName: 'Admin Console',
    pageDescription: 'Manage application administration',
  },
};

const AppLayout = () => {
  const { pathname } = useLocation();
  const pageMetadata = Object.entries(pageMetadataByPath).find(([path]) => pathname === path || pathname.startsWith(`${path}/`))?.[1] ?? {
    pageName: 'PatientFlow',
    pageDescription: 'Patient flow overview',
  };

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <TopBar pageName={pageMetadata.pageName} pageDescription={pageMetadata.pageDescription} />
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
