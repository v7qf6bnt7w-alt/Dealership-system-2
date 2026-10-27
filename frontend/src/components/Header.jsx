import React, { useState } from 'react';
import { useAuth, DEMO_PERSONAS } from '../context/AuthContext';
import { 
  Car, Bell, Users, Shield, LogOut, ChevronDown, 
  Sparkles, RefreshCw, CheckCircle2, MessageSquare
} from 'lucide-react';

export default function Header({ activeTab, setActiveTab }) {
  const { user, logout, quickLogin, onlineStaff, notifications, clearNotifications } = useAuth();
  const [showPersonaMenu, setShowPersonaMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <header style={{
      height: '64px',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border-subtle)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 24px',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      {/* Brand logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{
          width: '38px',
          height: '38px',
          background: 'linear-gradient(135deg, #f26b3a, #991b1b)',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 0 16px rgba(242, 107, 58, 0.35)',
        }}>
          <Car size={22} color="#fff" />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              fontFamily: 'var(--font-heading)',
              fontSize: '18px',
              fontWeight: 800,
              letterSpacing: '0.04em',
              background: 'linear-gradient(90deg, #ffffff, #cbd5e1)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              MERIDIAN
            </span>
            <span style={{
              color: 'var(--accent-primary)',
              fontWeight: 700,
              fontSize: '12px',
              letterSpacing: '0.15em',
              background: 'rgba(242, 107, 58, 0.12)',
              padding: '2px 6px',
              borderRadius: '4px',
              border: '1px solid rgba(242, 107, 58, 0.25)',
            }}>
              DMS 2.0
            </span>
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Austin Flagship &bull; Performance Core
          </span>
        </div>
      </div>

      {/* Right controls: Demo Persona Switcher, Presence, Notifications, User */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        
        {/* Live Presence indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-full)',
          fontSize: '12px',
          color: 'var(--text-secondary)',
        }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: onlineStaff.length > 0 ? '#10b981' : '#64748b',
            boxShadow: onlineStaff.length > 0 ? '0 0 8px #10b981' : 'none',
          }} />
          <Users size={13} />
          <span>{onlineStaff.length} Staff Online</span>
        </div>

        {/* Demo Persona Switcher Menu */}
        <div style={{ position: 'relative' }}>
          <button
            id="persona-switch-btn"
            onClick={() => setShowPersonaMenu(!showPersonaMenu)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 14px',
              background: 'rgba(242, 107, 58, 0.12)',
              border: '1px solid rgba(242, 107, 58, 0.35)',
              borderRadius: 'var(--radius-md)',
              color: '#f8fafc',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Sparkles size={15} color="var(--accent-primary)" />
            <span>Switch Role: <strong style={{ color: 'var(--accent-primary)' }}>{user?.full_name || 'Select'}</strong></span>
            <ChevronDown size={14} />
          </button>

          {showPersonaMenu && (
            <div
              className="glass-panel-elevated"
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                width: '320px',
                padding: '12px',
                zIndex: 200,
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px', padding: '0 4px' }}>
                Instant Demo Role Switcher
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {DEMO_PERSONAS.map((p) => {
                  const isCurrent = user?.email === p.email;
                  return (
                    <div
                      key={p.email}
                      onClick={async () => {
                        setShowPersonaMenu(false);
                        await quickLogin(p.email);
                        if (p.role === 'customer') {
                          setActiveTab('portal_garage');
                        } else {
                          setActiveTab('dashboard');
                        }
                      }}
                      style={{
                        padding: '10px 12px',
                        background: isCurrent ? 'rgba(242, 107, 58, 0.15)' : 'var(--bg-secondary)',
                        border: isCurrent ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: p.color }} />
                          <strong style={{ fontSize: '13px', color: '#fff' }}>{p.name}</strong>
                        </div>
                        <span className={`badge badge-${p.role === 'admin' ? 'high' : p.role === 'sales' ? 'normal' : 'low'}`} style={{ fontSize: '10px' }}>
                          {p.role}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.3' }}>
                        {p.desc}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Realtime Notification Bell */}
        <div style={{ position: 'relative' }}>
          <button
            id="notifications-bell-btn"
            onClick={() => setShowNotifications(!showNotifications)}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
              position: 'relative',
              cursor: 'pointer',
            }}
          >
            <Bell size={17} />
            {notifications.length > 0 && (
              <span style={{
                position: 'absolute',
                top: '-3px',
                right: '-3px',
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                background: 'var(--accent-primary)',
                color: '#fff',
                fontSize: '10px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 8px rgba(242, 107, 58, 0.6)',
              }}>
                {notifications.length}
              </span>
            )}
          </button>

          {showNotifications && (
            <div
              className="glass-panel-elevated"
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                width: '340px',
                padding: '14px',
                zIndex: 200,
                maxHeight: '400px',
                overflowY: 'auto',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span style={{ fontWeight: 700, fontSize: '13px' }}>Live Realtime Stream</span>
                {notifications.length > 0 && (
                  <button
                    onClick={clearNotifications}
                    style={{ fontSize: '11px', color: 'var(--accent-primary)', cursor: 'pointer' }}
                  >
                    Clear All
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                  No new events. Events from CRM, inventory, service and chat appear here live.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      style={{
                        padding: '8px 10px',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '12px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-primary)', fontWeight: 600, fontSize: '11px' }}>
                        <CheckCircle2 size={12} />
                        <span>{n.event}</span>
                      </div>
                      <div style={{ color: 'var(--text-primary)', marginTop: '2px' }}>{n.message}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '10px', marginTop: '4px' }}>
                        {new Date(n.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* User Avatar & Logout */}
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              background: user.avatar_color || 'var(--accent-primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '14px',
              color: '#fff',
            }}>
              {user.full_name?.charAt(0) || 'U'}
            </div>
            <button
              id="logout-btn"
              onClick={logout}
              title="Sign out"
              style={{
                width: '34px',
                height: '34px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
