import React, { useState } from 'react';
import { NavLink } from 'react-router';
import { hasAdminRole, useKeycloak } from 'app/config/keycloak-provider';
import './sidebar.scss';

interface MenuItem {
  label: string;
  path: string;
  icon: string; // simple emoji/character placeholder — swap for lucide-react later
}

const sections: Record<string, MenuItem[]> = {
  Menu: [
    { label: 'Dashboard', path: '/dashboard', icon: '⊞' },
    { label: 'Service', path: '/service', icon: '✦' },
  ],
  Setting: [
    { label: 'Settings', path: '/settings', icon: '⚙' },
    { label: 'My Account', path: '/user', icon: '👤' },
  ],
  Support: [{ label: 'Help Center', path: '/help', icon: '?' }],
};

const Sidebar = () => {
  const { keycloak, user } = useKeycloak();
  const [collapsed, setCollapsed] = useState(false);
  const visibleSections = {
    ...sections,
    ...(hasAdminRole(user?.roles) ? { Administration: [{ label: 'Admin Console', path: '/admin', icon: '⚙' }] } : {}),
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <img src="https://placehold.co/31x31" alt="Logo" />
        </div>
        {!collapsed && <span className="sidebar-brand">PatientFlow</span>}
        <button
          className="sidebar-toggle"
          onClick={() => setCollapsed(prev => !prev)}
          title={collapsed ? 'Expand' : 'Collapse'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <nav className="sidebar-nav">
        {Object.entries(visibleSections).map(([section, items]) => (
          <div key={section} className="sidebar-section">
            {!collapsed && <div className="sidebar-section-label">{section}</div>}
            {items.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                title={collapsed ? item.label : undefined}
              >
                <span className="sidebar-icon">{item.icon}</span>
                {!collapsed && <span className="sidebar-label">{item.label}</span>}
              </NavLink>
            ))}
          </div>
        ))}

        <div className="sidebar-section">
          {!collapsed && <div className="sidebar-section-label">Support</div>}
          <button className="sidebar-link sidebar-logout" onClick={() => keycloak.logout()} title={collapsed ? 'Logout' : undefined}>
            <span className="sidebar-icon">⏻</span>
            {!collapsed && <span className="sidebar-label">Logout</span>}
          </button>
        </div>
      </nav>
    </aside>
  );
};

export default Sidebar;
