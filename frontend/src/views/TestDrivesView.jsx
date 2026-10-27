import React, { useState, useEffect } from 'react';
import { api, formatDate, formatDateTime } from '../api';
import { useAuth } from '../context/AuthContext';
import { 
  Calendar, Clock, Plus, Car, User, Navigation, 
  CheckCircle, AlertCircle, MapPin, X, FileCheck
} from 'lucide-react';

export default function TestDrivesView() {
  const { isStaff, user } = useAuth();
  const [drives, setDrives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDrive, setSelectedDrive] = useState(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [customers, setCustomers] = useState([]);

  // Schedule form
  const [formData, setFormData] = useState({
    customer_id: '',
    vehicle_id: '',
    scheduled_at: '',
    duration_min: 30,
    status: 'confirmed',
    notify: true,
  });

  async function loadData() {
    try {
      setLoading(true);
      const res = await api.get('/test-drives');
      setDrives(res || []);
    } catch (e) {
      console.error('Failed to load test drives:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function openScheduleModal() {
    setShowScheduleModal(true);
    // Pre-populate customers & vehicles for easy selection
    try {
      const [vRes, cRes] = await Promise.all([
        api.get('/inventory?status=in_stock&limit=30'),
        api.get('/customers?limit=30'),
      ]);
      setVehicles(vRes.items || []);
      setCustomers(cRes || []);
      if (vRes.items?.[0] && cRes?.[0]) {
        // Default to tomorrow 10am
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(10, 0, 0, 0);
        setFormData({
          customer_id: cRes[0].id,
          vehicle_id: vRes.items[0].id,
          scheduled_at: tomorrow.toISOString().slice(0, 16),
          duration_min: 30,
          status: 'confirmed',
          notify: true,
        });
      }
    } catch (e) {
      console.error('Error prefetching dropdowns:', e);
    }
  }

  async function handleScheduleSubmit(e) {
    e.preventDefault();
    try {
      const isoTime = new Date(formData.scheduled_at).toISOString();
      await api.post('/test-drives', {
        customer_id: Number(formData.customer_id),
        vehicle_id: Number(formData.vehicle_id),
        scheduled_at: isoTime,
        duration_min: Number(formData.duration_min),
        status: formData.status,
        notify: formData.notify,
      });
      setShowScheduleModal(false);
      loadData();
      alert('Test drive confirmed! Automated confirmation sent to client.');
    } catch (err) {
      alert(`Scheduling failed: ${err.message}`);
    }
  }

  async function handlePatchStatus(id, newStatus) {
    try {
      await api.patch(`/test-drives/${id}`, { status: newStatus });
      loadData();
      if (selectedDrive && selectedDrive.id === id) {
        setSelectedDrive({ ...selectedDrive, status: newStatus });
      }
    } catch (err) {
      alert(`Failed to update status: ${err.message}`);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800 }}>Test Drives & GPS Telematics</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Smart conflict prevention &bull; Telemetry trace tracking &bull; Automated client reminders
          </p>
        </div>

        {isStaff && (
          <button
            id="btn-schedule-test-drive"
            className="btn btn-primary"
            onClick={openScheduleModal}
          >
            <Plus size={16} />
            <span>Schedule Test Drive</span>
          </button>
        )}
      </div>

      {/* Drives Table */}
      <div className="glass-panel" style={{ padding: '20px' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading test drives...
          </div>
        ) : drives.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No test drives scheduled.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px' }}>Client</th>
                  <th style={{ padding: '12px' }}>Vehicle</th>
                  <th style={{ padding: '12px' }}>Scheduled Time</th>
                  <th style={{ padding: '12px' }}>Sales Rep</th>
                  <th style={{ padding: '12px' }}>Status</th>
                  <th style={{ padding: '12px' }}>Telemetry</th>
                  <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {drives.map((td) => (
                  <tr
                    key={td.id}
                    style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background var(--transition-fast)' }}
                  >
                    <td style={{ padding: '12px' }}>
                      <div style={{ fontWeight: 600, color: '#fff' }}>{td.customer_name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{td.customer_phone}</div>
                    </td>

                    <td style={{ padding: '12px' }}>
                      <div style={{ fontWeight: 600, color: '#fff' }}>{td.vehicle_title}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Stock #{td.stock_number}</div>
                    </td>

                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)' }}>
                        <Clock size={13} color="var(--accent-primary)" />
                        <span>{formatDateTime(td.scheduled_at)}</span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{td.duration_min} min slot</div>
                    </td>

                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: td.rep_color || 'var(--accent-primary)' }} />
                        <span>{td.rep_name || 'Unassigned'}</span>
                      </div>
                    </td>

                    <td style={{ padding: '12px' }}>
                      <span className={`badge badge-${td.status === 'confirmed' ? 'new' : td.status === 'completed' ? 'certified' : 'normal'}`}>
                        {td.status}
                      </span>
                    </td>

                    <td style={{ padding: '12px' }}>
                      {td.distance_km ? (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '11px', gap: '4px' }}
                          onClick={() => setSelectedDrive(td)}
                        >
                          <Navigation size={12} color="var(--accent-secondary)" />
                          <span>{td.distance_km} km trace</span>
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Pending drive</span>
                      )}
                    </td>

                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      {td.status === 'confirmed' && (
                        <button
                          className="btn btn-primary"
                          style={{ padding: '4px 10px', fontSize: '11px' }}
                          onClick={() => handlePatchStatus(td.id, 'completed')}
                        >
                          Complete
                        </button>
                      )}
                      {td.status === 'requested' && (
                        <button
                          className="btn btn-primary"
                          style={{ padding: '4px 10px', fontSize: '11px' }}
                          onClick={() => handlePatchStatus(td.id, 'confirmed')}
                        >
                          Confirm
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* GPS Route Visualizer Modal */}
      {selectedDrive && (
        <div className="modal-backdrop" onClick={() => setSelectedDrive(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '24px', maxWidth: '640px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: 800 }}>GPS Telematics Trace</h2>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {selectedDrive.vehicle_title} &bull; Driver: {selectedDrive.customer_name}
                </div>
              </div>
              <button onClick={() => setSelectedDrive(null)}><X size={18} /></button>
            </div>

            {/* Simulated Map Canvas */}
            <div style={{
              height: '280px',
              background: '#090d16',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              position: 'relative',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              {/* Radar Grid Backdrop */}
              <div style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: 'linear-gradient(rgba(38, 45, 64, 0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(38, 45, 64, 0.4) 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }} />

              {/* Waypoint Route SVG */}
              <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
                <polyline
                  points="80,180 120,130 180,90 260,110 320,80 390,140 340,210 240,220 160,200 80,180"
                  fill="none"
                  stroke="#f26b3a"
                  strokeWidth="3"
                  strokeDasharray="4 2"
                />
                <circle cx="80" cy="180" r="7" fill="#10b981" />
                <circle cx="390" cy="140" r="6" fill="#f59e0b" />
              </svg>

              <div style={{
                position: 'absolute',
                bottom: '12px',
                left: '12px',
                background: 'rgba(0,0,0,0.85)',
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '11px',
                color: '#fff',
                display: 'flex',
                gap: '12px',
              }}>
                <span>Total Distance: <strong style={{ color: 'var(--accent-primary)' }}>{selectedDrive.distance_km} km</strong></span>
                <span>Avg Speed: <strong>48 km/h</strong></span>
                <span>Coordinates: <strong>30.2465° N, 97.7810° W</strong></span>
              </div>
            </div>

            {selectedDrive.feedback && (
              <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                  Customer Feedback
                </span>
                <p style={{ fontSize: '13px', color: '#fff', marginTop: '4px' }}>
                  "{selectedDrive.feedback}"
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Schedule Modal */}
      {showScheduleModal && (
        <div className="modal-backdrop" onClick={() => setShowScheduleModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800 }}>Schedule Customer Test Drive</h2>
              <button onClick={() => setShowScheduleModal(false)}><X size={18} /></button>
            </div>

            <form onSubmit={handleScheduleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Select Customer*</label>
                <select
                  required
                  className="input-field"
                  value={formData.customer_id}
                  onChange={(e) => setFormData({ ...formData, customer_id: e.target.value })}
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.first_name} {c.last_name} &bull; {c.phone}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Select In-Stock Vehicle*</label>
                <select
                  required
                  className="input-field"
                  value={formData.vehicle_id}
                  onChange={(e) => setFormData({ ...formData, vehicle_id: e.target.value })}
                >
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.year} {v.make} {v.model} {v.trim} (#{v.stock_number})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Date & Time*</label>
                  <input
                    type="datetime-local"
                    required
                    className="input-field"
                    value={formData.scheduled_at}
                    onChange={(e) => setFormData({ ...formData, scheduled_at: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Duration (minutes)</label>
                  <select
                    className="input-field"
                    value={formData.duration_min}
                    onChange={(e) => setFormData({ ...formData, duration_min: Number(e.target.value) })}
                  >
                    <option value={15}>15 Minutes (Express)</option>
                    <option value={30}>30 Minutes (Standard)</option>
                    <option value={60}>60 Minutes (Extended)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                <input
                  type="checkbox"
                  id="notify-client"
                  checked={formData.notify}
                  onChange={(e) => setFormData({ ...formData, notify: e.target.checked })}
                />
                <label htmlFor="notify-client" style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                  Send automated WhatsApp / Email appointment confirmation & 24h reminder
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowScheduleModal(false)}>
                  Cancel
                </button>
                <button id="submit-schedule-test-drive-btn" type="submit" className="btn btn-primary">
                  Confirm Booking
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
