import React from 'react';
import './dashboard.scss';

// MOCK DATA — replace with API calls later
const stats = [
  { label: 'Total Patient', value: '123', change: '10.3%', trend: 'up' },
  { label: 'Total Doctor', value: '123', change: '1.06%', trend: 'down' },
  { label: 'Book Appointment', value: '123', change: '15.3%', trend: 'up' },
  { label: 'Room Availability', value: '123', change: '19.8%', trend: 'down' },
];

const recentPatients = [
  { 
    id: 1, 
    name: 'Emily Rose Parker', 
    location: 'Ward 3 - Bed 12', 
    service: 'Cardiology', 
    discharge: 'Oct 08, 2026', 
    readiness: 'Ready' 
  },
  { 
    id: 2, 
    name: 'Michael James Turner', 
    location: 'ICU - Bed 4', 
    service: 'Neurology', 
    discharge: 'Oct 12, 2026', 
    readiness: 'Pending Labs' 
  },
  { 
    id: 3, 
    name: 'Olivia Grace Bennett', 
    location: 'Ward 1 - Bed 8', 
    service: 'Orthopedics', 
    discharge: 'Oct 09, 2026', 
    readiness: 'Waiting for PT' 
  },
];

const StatCard = ({ label, value, change, trend }: typeof stats[0]) => (
  <div className="stat-card">
    <div className="stat-icon" />
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
    <div className={`stat-badge ${trend}`}>
      <span className="stat-arrow">{trend === 'up' ? '↑' : '↓'}</span>
      {change}
    </div>
  </div>
);

const Dashboard = () => (
  <div className="dashboard-page">
    <div className="dashboard-header">
      <h1 className="dashboard-title">Welcome back, Simone!</h1>
      <div className="dashboard-actions">
        <div className="last-update">Last Update: October 06, 2026 at 09:40</div>
        <button className="btn-export">Export CSV</button>
      </div>
    </div>

    <div className="stats-grid">
      {stats.map(s => (
        <StatCard key={s.label} {...s} />
      ))}
    </div>

    <div className="charts-row">
      <div className="chart-main">Chart Placeholder</div>
      <div className="chart-side">Chart Placeholder</div>
    </div>

    <div className="recent-patients">
      <div className="recent-header">
        <h2>Recent Patients</h2>
        <input type="text" placeholder="Search" className="search-input" />
      </div>
      <table className="patients-table">
        <thead>
          <tr>
            <th>Patient</th>
            <th>Current Location</th>
            <th>Service</th>
            <th>Expected Discharge</th>
            <th>Readiness</th>
          </tr>
        </thead>
        <tbody>
          {recentPatients.map(p => (
            <tr key={p.id}>
              <td><strong>{p.name}</strong></td>
              <td>{p.location}</td>
              <td>{p.service}</td>
              <td>{p.discharge}</td>
              <td>{p.readiness}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export default Dashboard;