import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import DashboardView from './views/DashboardView';
import InventoryView from './views/InventoryView';
import CrmView from './views/CrmView';
import TestDrivesView from './views/TestDrivesView';
import DealsView from './views/DealsView';
import ServiceView from './views/ServiceView';
import CommsView from './views/CommsView';
import AdminView from './views/AdminView';
import PortalView from './views/PortalView';

function AppContent() {
  const { user, isCustomer } = useAuth();
  const [activeTab, setActiveTab] = useState(isCustomer ? 'portal_garage' : 'dashboard');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)' }}>
      <Header activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <div style={{ display: 'flex', flex: 1, position: 'relative' }}>
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
        
        <main style={{
          flex: 1,
          padding: '24px 32px',
          overflowY: 'auto',
          maxWidth: '1600px',
          width: '100%',
          margin: '0 auto',
        }}>
          {activeTab === 'dashboard' && <DashboardView onNavigate={setActiveTab} />}
          {activeTab === 'inventory' && <InventoryView onNavigate={setActiveTab} />}
          {activeTab === 'crm' && <CrmView onNavigate={setActiveTab} />}
          {activeTab === 'test_drives' && <TestDrivesView onNavigate={setActiveTab} />}
          {activeTab === 'deals' && <DealsView onNavigate={setActiveTab} />}
          {activeTab === 'service' && <ServiceView onNavigate={setActiveTab} />}
          {activeTab === 'comms' && <CommsView onNavigate={setActiveTab} />}
          {activeTab === 'admin' && <AdminView onNavigate={setActiveTab} />}

          {/* Customer Portal views */}
          {activeTab.startsWith('portal_') && (
            <PortalView viewMode={activeTab} onNavigate={setActiveTab} />
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
