import React, { useState, useEffect } from 'react';
import { api, formatDate, formatDateTime } from '../api';
import { useAuth } from '../context/AuthContext';
import { 
  ShieldCheck, Users, ShieldAlert, FileText, Plus, 
  CheckCircle2, XCircle, Download, Trash2, Key, Eye, X
} from 'lucide-react';

export default function AdminView() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('users'); // 'users' | 'audit' | 'gdpr'
  const [users, setUsers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [gdprRequests, setGdprRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  // New staff user form
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({
    email: '',
    full_name: '',
    role: 'sales',
    phone: '+1 512 555 0199',
    password: 'password123',
  });

  async function loadData() {
    try {
      setLoading(true);
      const [uRes, aRes, gRes] = await Promise.all([
        api.get('/users'),
        api.get('/audit-logs?limit=50'),
        api.get('/gdpr/requests'),
      ]);
      setUsers(uRes || []);
      setAuditLogs(aRes || []);
      setGdprRequests(gRes || []);
    } catch (e) {
      console.error('Failed to load admin data:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleToggleUserStatus(userId, currentActive) {
    try {
      await api.patch(`/users/${userId}`, { is_active: !currentActive });
      loadData();
    } catch (err) {
      alert(`User status change failed: ${err.message}`);
    }
  }

  async function handleCreateUser(e) {
    e.preventDefault();
    try {
      await api.post('/users', newUser);
      setShowAddUser(false);
      loadData();
      alert(`User ${newUser.full_name} created successfully!`);
    } catch (err) {
      alert(`Failed to create user: ${err.message}`);
    }
  }

  async function handleProcessGdpr(reqId, action) {
    try {
      await api.post(`/gdpr/requests/${reqId}`, { action });
      loadData();
      alert(`GDPR request ${action === 'complete' ? 'completed & customer records redacted' : 'rejected'}!`);
    } catch (err) {
      alert(`Failed to process GDPR request: ${err.message}`);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800 }}>Admin & Regulatory Compliance</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Staff access control &bull; Immutable audit logging &bull; GDPR Art. 17/20 Compliance Engine
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          {/* Subtab Toggle */}
          <div style={{ display: 'flex', background: 'var(--bg-secondary)', padding: '3px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <button
              onClick={() => setActiveTab('users')}
              style={{
                padding: '6px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12px',
                fontWeight: 600,
                background: activeTab === 'users' ? 'var(--accent-primary)' : 'transparent',
                color: activeTab === 'users' ? '#fff' : 'var(--text-secondary)',
              }}
            >
              Staff Users ({users.length})
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              style={{
                padding: '6px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12px',
                fontWeight: 600,
                background: activeTab === 'audit' ? 'var(--accent-primary)' : 'transparent',
                color: activeTab === 'audit' ? '#fff' : 'var(--text-secondary)',
              }}
            >
              Audit Trail ({auditLogs.length})
            </button>
            <button
              onClick={() => setActiveTab('gdpr')}
              style={{
                padding: '6px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12px',
                fontWeight: 600,
                background: activeTab === 'gdpr' ? 'var(--accent-primary)' : 'transparent',
                color: activeTab === 'gdpr' ? '#fff' : 'var(--text-secondary)',
              }}
            >
              GDPR Requests ({gdprRequests.length})
            </button>
          </div>

          {activeTab === 'users' && (
            <button
              id="btn-add-staff"
              className="btn btn-primary"
              onClick={() => setShowAddUser(true)}
            >
              <Plus size={16} />
              <span>Add Staff User</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Tab Panels */}
      {activeTab === 'users' && (
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px' }}>Staff Member</th>
                  <th style={{ padding: '12px' }}>Email</th>
                  <th style={{ padding: '12px' }}>Role</th>
                  <th style={{ padding: '12px' }}>Status</th>
                  <th style={{ padding: '12px' }}>Last Login</th>
                  <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: u.avatar_color || '#fff' }} />
                        <span style={{ fontWeight: 600, color: '#fff' }}>{u.full_name}</span>
                      </div>
                    </td>

                    <td style={{ padding: '12px', color: 'var(--text-secondary)' }}>
                      {u.email}
                    </td>

                    <td style={{ padding: '12px' }}>
                      <span className={`badge badge-${u.role === 'admin' ? 'high' : u.role === 'sales' ? 'normal' : 'certified'}`}>
                        {u.role?.toUpperCase()}
                      </span>
                    </td>

                    <td style={{ padding: '12px' }}>
                      <span className={`badge ${u.is_active ? 'badge-new' : 'badge-sold'}`}>
                        {u.is_active ? 'Active' : 'Disabled'}
                      </span>
                    </td>

                    <td style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '12px' }}>
                      {formatDateTime(u.last_login_at)}
                    </td>

                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      {u.id !== user?.id && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '11px' }}
                          onClick={() => handleToggleUserStatus(u.id, u.is_active)}
                        >
                          {u.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px' }}>Timestamp (UTC)</th>
                  <th style={{ padding: '12px' }}>Actor</th>
                  <th style={{ padding: '12px' }}>Action</th>
                  <th style={{ padding: '12px' }}>Entity</th>
                  <th style={{ padding: '12px' }}>IP Address</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '12px' }}>
                      {formatDateTime(log.created_at)}
                    </td>

                    <td style={{ padding: '12px', fontWeight: 600, color: '#fff' }}>
                      {log.user_name || 'System Auto'}
                    </td>

                    <td style={{ padding: '12px' }}>
                      <span className="badge badge-normal">{log.action}</span>
                    </td>

                    <td style={{ padding: '12px', color: 'var(--text-secondary)' }}>
                      {log.entity} {log.entity_id ? `(#${log.entity_id})` : ''}
                    </td>

                    <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-muted)' }}>
                      {log.ip_address || '127.0.0.1'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'gdpr' && (
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px' }}>Request ID</th>
                  <th style={{ padding: '12px' }}>Customer</th>
                  <th style={{ padding: '12px' }}>Request Type</th>
                  <th style={{ padding: '12px' }}>Status</th>
                  <th style={{ padding: '12px' }}>Requested At</th>
                  <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {gdprRequests.map((req) => (
                  <tr key={req.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '12px', fontWeight: 700, color: '#fff' }}>
                      #{req.id}
                    </td>

                    <td style={{ padding: '12px' }}>
                      <div style={{ fontWeight: 600, color: '#fff' }}>{req.customer_name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{req.customer_email}</div>
                    </td>

                    <td style={{ padding: '12px' }}>
                      <span className={`badge badge-${req.type === 'erasure' ? 'high' : 'certified'}`}>
                        {req.type === 'erasure' ? 'Right to Erasure (Art. 17)' : 'Data Portability (Art. 20)'}
                      </span>
                    </td>

                    <td style={{ padding: '12px' }}>
                      <span className={`badge badge-${req.status === 'completed' ? 'new' : req.status === 'pending' ? 'high' : 'low'}`}>
                        {req.status}
                      </span>
                    </td>

                    <td style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '12px' }}>
                      {formatDate(req.created_at)}
                    </td>

                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      {req.status === 'pending' && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                          <button
                            className="btn btn-primary"
                            style={{ padding: '4px 8px', fontSize: '11px', background: '#f43f5e' }}
                            onClick={() => handleProcessGdpr(req.id, 'complete')}
                          >
                            Execute Redaction
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                            onClick={() => handleProcessGdpr(req.id, 'reject')}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Staff User Modal */}
      {showAddUser && (
        <div className="modal-backdrop" onClick={() => setShowAddUser(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800 }}>Create Dealership Staff User</h2>
              <button onClick={() => setShowAddUser(false)}><X size={18} /></button>
            </div>

            <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Full Name*</label>
                <input
                  type="text"
                  required
                  className="input-field"
                  placeholder="e.g. Jordan Vance"
                  value={newUser.full_name}
                  onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Corporate Email*</label>
                <input
                  type="email"
                  required
                  className="input-field"
                  placeholder="e.g. j.vance@meridian.demo"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Operational Role*</label>
                  <select
                    className="input-field"
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  >
                    <option value="sales">Sales Representative</option>
                    <option value="service">Service Advisor</option>
                    <option value="admin">Administrator (Full Access)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Temporary Password*</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    className="input-field"
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddUser(false)}>
                  Cancel
                </button>
                <button id="submit-create-staff-btn" type="submit" className="btn btn-primary">
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
