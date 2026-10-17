import React, { useState, useEffect, useRef } from 'react';
import { useKeycloak } from 'app/config/keycloak-provider';
import './top-bar.scss';

interface TopBarProps {
  pageName: string;
  pageDescription: string;
}

const TopBar = ({ pageName, pageDescription }: TopBarProps) => {
  const { user, keycloak } = useKeycloak();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !event.composedPath().some(target => target === dropdownRef.current)) {
        setIsDropdownOpen(false);
      }
    };
    globalThis.document.addEventListener('mousedown', handleClickOutside);
    return () => globalThis.document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getDisplayRole = () => {
    if (!user?.roles || user.roles.length === 0) return 'User';
    const hasAdmin = user.roles.some(r => r.includes('ADMIN'));
    if (hasAdmin) return 'Admin';
    const gestor = user.roles.find(r => r.includes('GESTOR'));
    if (gestor) return gestor.replace('GESTOR_', 'Gestor ').replace(/_/g, ' ');
    return 'User';
  };

  return (
    <header className="top-bar">
      {/* Left Side: Page Title & Description */}
      <div className="top-bar-page-info">
        <h1 className="page-name">{pageName}</h1>
        <p className="page-description">{pageDescription}</p>
      </div>

      <div className="top-bar-spacer" />

      {/* Right Side: User Profile Dropdown */}
      <div className="top-bar-user-container" ref={dropdownRef}>
        <div
          className={`top-bar-user ${isDropdownOpen ? 'open' : ''}`}
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          title={user?.name}
        >
          <div className="user-avatar" />
          <div className="user-info">
            <span className="user-name">{user?.name || 'User'}</span>
            <span className="user-role">{getDisplayRole()}</span>
          </div>
          <span className="dropdown-chevron">▼</span>
        </div>

        {/* Dropdown Menu */}
        {isDropdownOpen && (
          <div className="user-dropdown">
            <div className="dropdown-header">
              <span className="dropdown-name">{user?.name}</span>
              <span className="dropdown-email">{user?.email}</span>
            </div>
            <div className="dropdown-divider"></div>
            <button
              className="dropdown-item"
              onClick={() => {
                /* Navigate to profile */
              }}
            >
              My Account
            </button>
            <div className="dropdown-divider"></div>
            <button className="dropdown-item logout" onClick={() => keycloak.logout()}>
              Logout
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

export default TopBar;
