import React from 'react';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard, CarFront, GitPullRequest, Calendar, 
  FileSpreadsheet, Wrench, MessageSquare, ShieldCheck, 
  UserCheck, Heart, Warehouse, ShieldAlert, Sparkles, Compass
} from 'lucide-react';

export default function Sidebar({ activeTab, setActiveTab }) {
  const { user, isStaff, isCustomer, isAdmin, isSales, isService } = useAuth();

  const staffItems = [
    { id: 'dashboard', label: 'Executive KPIs', icon: LayoutDashboard, roles: ['admin', 'sales', 'service'] },
    { id: 'inventory', label: 'Vehicle Inventory', icon: CarFront, roles: ['admin', 'sales', 'service'] },
    { id: 'crm', label: 'CRM & Pipeline', icon: GitPullRequest, roles: ['admin', 'sales'] },
    { id: 'test_drives', label: 'Test Drives & GPS', icon: Calendar, roles: ['admin', 'sales', 'service'] },
    { id: 'deals', label: 'Desking & Deals', icon: FileSpreadsheet, roles: ['admin', 'sales'] },
    { id: 'service', label: 'Service & Parts', icon: Wrench, roles: ['admin', 'service'] },
    { id: 'comms', label: 'Omnichannel Inbox', icon: MessageSquare, roles: ['admin', 'sales', 'service'] },
    { id: 'admin', label: 'Admin & Compliance', icon: ShieldCheck, roles: ['admin'] },
  ];

  const portalItems = [
    { id: 'portal_showroom', label: 'Vehicle Showroom', icon: Compass },
    { id: 'portal_garage', label: 'My Garage & Status', icon: Warehouse },
    { id: 'portal_booking', label: 'Book Test Drive', icon: Calendar },
    { id: 'portal_favorites', label: 'Saved Favorites', icon: Heart },
    { id: 'portal_privacy', label: 'Privacy & GDPR', icon: ShieldAlert },
  ];

  const filteredStaffItems = staffItems.filter((item) =>
    item.roles.includes(user?.role || 'admin')
  );

  return (
    <aside style={{
      width: '240px',
      minWidth: '240px',
      background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border-subtle)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '16px 12px',
      minHeight: 'calc(100vh - 64px)',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {/* Section title */}
        {isStaff && (
          <>
            <div style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              padding: '6px 12px',
              letterSpacing: '0.06em',
            }}>
              Dealership Operations
            </div>

            {filteredStaffItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`nav-tab-${item.id}`}
                  onClick={() => setActiveTab(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: isActive ? 'linear-gradient(90deg, rgba(242, 107, 58, 0.2), transparent)' : 'transparent',
                    borderLeft: isActive ? '3px solid var(--accent-primary)' : '3px solid transparent',
                    color: isActive ? '#fff' : 'var(--text-secondary)',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: '13px',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                    textAlign: 'left',
                  }}
                >
                  <Icon size={17} color={isActive ? 'var(--accent-primary)' : 'currentColor'} />
                  <span>{item.label}</span>
                </button>
              );
            })}

            <div style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              padding: '18px 12px 6px',
              letterSpacing: '0.06em',
            }}>
              Customer Experience
            </div>
            <button
              id="nav-tab-portal_showroom"
              onClick={() => setActiveTab('portal_showroom')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                width: '100%',
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                background: activeTab === 'portal_showroom' ? 'linear-gradient(90deg, rgba(6, 182, 212, 0.2), transparent)' : 'transparent',
                borderLeft: activeTab === 'portal_showroom' ? '3px solid var(--accent-secondary)' : '3px solid transparent',
                color: activeTab === 'portal_showroom' ? '#fff' : 'var(--text-secondary)',
                fontWeight: activeTab === 'portal_showroom' ? 600 : 500,
                fontSize: '13px',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Compass size={17} color={activeTab === 'portal_showroom' ? 'var(--accent-secondary)' : 'currentColor'} />
              <span>Public Showroom</span>
            </button>
          </>
        )}

        {isCustomer && (
          <>
            <div style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              color: 'var(--accent-primary)',
              padding: '6px 12px',
              letterSpacing: '0.06em',
            }}>
              Customer Portal
            </div>

            {portalItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  id={`nav-tab-${item.id}`}
                  onClick={() => setActiveTab(item.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: isActive ? 'linear-gradient(90deg, rgba(242, 107, 58, 0.2), transparent)' : 'transparent',
                    borderLeft: isActive ? '3px solid var(--accent-primary)' : '3px solid transparent',
                    color: isActive ? '#fff' : 'var(--text-secondary)',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: '13px',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <Icon size={17} color={isActive ? 'var(--accent-primary)' : 'currentColor'} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </>
        )}
      </div>

      {/* User Status Card */}
      <div style={{
        padding: '12px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        marginTop: '20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Active Profile
          </span>
        </div>
        <div style={{ fontWeight: 700, color: '#fff', fontSize: '13px' }}>
          {user?.full_name}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {user?.email}
        </div>
      </div>
    </aside>
  );
}
