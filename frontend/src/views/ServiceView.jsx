import React, { useState, useEffect } from 'react';
import { api, formatCurrency, formatDate } from '../api';
import { useAuth } from '../context/AuthContext';
import { 
  Wrench, Plus, Package, Clock, CheckCircle2, AlertTriangle, 
  Car, User, X, ArrowRight, ShieldCheck, MessageSquare
} from 'lucide-react';

const SERVICE_STATUSES = [
  'scheduled', 'checked_in', 'in_progress', 'waiting_parts', 'quality_check', 'ready', 'closed'
];

export default function ServiceView() {
  const { isStaff, user } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('jobs'); // 'jobs' | 'parts'

  // Modals
  const [selectedJob, setSelectedJob] = useState(null);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [showAddPartToJob, setShowAddPartToJob] = useState(false);

  // New Job form
  const [newJob, setNewJob] = useState({
    customer_id: '',
    customer_vehicle: '2021 Toyota RAV4',
    complaint: 'Routine 30k mile maintenance + brake squeal inspection',
    scheduled_at: new Date().toISOString().slice(0, 16),
    technician: 'J. Park',
    bay: 'Bay 3',
    priority: 'normal',
    labor_hours: 1.5,
  });

  const [availableCustomers, setAvailableCustomers] = useState([]);

  async function loadData() {
    try {
      setLoading(true);
      const [jRes, pRes] = await Promise.all([
        api.get('/service/jobs?include_closed=true'),
        api.get('/parts'),
      ]);
      setJobs(jRes || []);
      setParts(pRes || []);
    } catch (e) {
      console.error('Failed to load service data:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function openCreateModal() {
    setShowCreateJob(true);
    try {
      const cRes = await api.get('/customers?limit=30');
      setAvailableCustomers(cRes || []);
      if (cRes?.[0]) {
        setNewJob((prev) => ({ ...prev, customer_id: cRes[0].id }));
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleCreateJob(e) {
    e.preventDefault();
    try {
      const created = await api.post('/service/jobs', {
        ...newJob,
        customer_id: Number(newJob.customer_id),
        scheduled_at: new Date(newJob.scheduled_at).toISOString(),
        labor_hours: Number(newJob.labor_hours),
      });
      setShowCreateJob(false);
      loadData();
      alert(`Repair order ${created.ro_number} successfully opened!`);
    } catch (err) {
      alert(`Failed to create job: ${err.message}`);
    }
  }

  async function handleUpdateJobStatus(jobId, newStatus, notify = false) {
    try {
      const updated = await api.patch(`/service/jobs/${jobId}`, {
        status: newStatus,
        notify_customer: notify,
        note: `Status updated to ${newStatus.replace('_', ' ')}`,
      });
      loadData();
      setSelectedJob(updated);
      alert(`RO status changed to ${newStatus.toUpperCase()}` + (notify ? ' and client notified!' : ''));
    } catch (err) {
      alert(`Status update failed: ${err.message}`);
    }
  }

  async function handleAddPart(jobId, partId, quantity) {
    try {
      const updated = await api.post(`/service/jobs/${jobId}/parts`, {
        part_id: Number(partId),
        quantity: Number(quantity),
      });
      setSelectedJob(updated);
      loadData();
      setShowAddPartToJob(false);
    } catch (err) {
      alert(`Part addition failed: ${err.message}`);
    }
  }

  async function handleRemovePart(jobId, lineId) {
    try {
      const updated = await api.delete(`/service/jobs/${jobId}/parts/${lineId}`);
      setSelectedJob(updated);
      loadData();
    } catch (err) {
      alert(`Part removal failed: ${err.message}`);
    }
  }

  async function handleAdjustPartStock(partId, delta) {
    try {
      await api.post(`/parts/${partId}/adjust`, { delta });
      loadData();
    } catch (err) {
      alert(`Stock adjust failed: ${err.message}`);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800 }}>Service Workshop & Parts Catalog</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Repair Orders &bull; Technician Bay Scheduling &bull; Automated Client WhatsApp Updates
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          {/* Subtab Toggle */}
          <div style={{ display: 'flex', background: 'var(--bg-secondary)', padding: '3px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <button
              onClick={() => setActiveTab('jobs')}
              style={{
                padding: '6px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12px',
                fontWeight: 600,
                background: activeTab === 'jobs' ? 'var(--accent-primary)' : 'transparent',
                color: activeTab === 'jobs' ? '#fff' : 'var(--text-secondary)',
              }}
            >
              Repair Orders ({jobs.length})
            </button>
            <button
              onClick={() => setActiveTab('parts')}
              style={{
                padding: '6px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '12px',
                fontWeight: 600,
                background: activeTab === 'parts' ? 'var(--accent-primary)' : 'transparent',
                color: activeTab === 'parts' ? '#fff' : 'var(--text-secondary)',
              }}
            >
              Parts Inventory ({parts.length})
            </button>
          </div>

          {isStaff && (
            <button
              id="btn-open-ro"
              className="btn btn-primary"
              onClick={openCreateModal}
            >
              <Plus size={16} />
              <span>Open Repair Order</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === 'jobs' ? (
        <div className="glass-panel" style={{ padding: '20px' }}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading workshop jobs...
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                    <th style={{ padding: '12px' }}>RO Number</th>
                    <th style={{ padding: '12px' }}>Customer</th>
                    <th style={{ padding: '12px' }}>Vehicle</th>
                    <th style={{ padding: '12px' }}>Complaint</th>
                    <th style={{ padding: '12px' }}>Bay & Tech</th>
                    <th style={{ padding: '12px' }}>Status</th>
                    <th style={{ padding: '12px' }}>Total</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr
                      key={j.id}
                      style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background var(--transition-fast)' }}
                    >
                      <td style={{ padding: '12px', fontWeight: 700, color: '#fff' }}>
                        {j.ro_number}
                      </td>

                      <td style={{ padding: '12px' }}>
                        <div style={{ fontWeight: 600, color: '#fff' }}>{j.customer_name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{j.customer_phone}</div>
                      </td>

                      <td style={{ padding: '12px', color: 'var(--text-secondary)' }}>
                        {j.vehicle_title}
                      </td>

                      <td style={{ padding: '12px', maxWidth: '240px' }}>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {j.complaint}
                        </div>
                      </td>

                      <td style={{ padding: '12px' }}>
                        <div style={{ fontWeight: 600, color: '#fff' }}>{j.bay || 'Unassigned'}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{j.technician || 'Pending Tech'}</div>
                      </td>

                      <td style={{ padding: '12px' }}>
                        <span className={`badge badge-${j.status === 'ready' ? 'new' : j.status === 'waiting_parts' ? 'high' : j.status === 'in_progress' ? 'certified' : 'normal'}`}>
                          {j.status?.replace('_', ' ')}
                        </span>
                      </td>

                      <td style={{ padding: '12px', fontWeight: 700, color: 'var(--accent-primary)' }}>
                        {formatCurrency(j.total)}
                      </td>

                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 10px', fontSize: '12px' }}
                          onClick={async () => {
                            const full = await api.get(`/service/jobs/${j.id}`);
                            setSelectedJob(full);
                          }}
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Parts Catalog Grid */
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
            {parts.map((p) => {
              const isLow = p.available <= p.reorder_level;
              return (
                <div
                  key={p.id}
                  style={{
                    background: 'var(--bg-secondary)',
                    border: isLow ? '1px solid rgba(244, 63, 94, 0.4)' : '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{p.sku}</div>
                      <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#fff', marginTop: '2px' }}>{p.name}</h4>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Category: {p.category} &bull; Bin: {p.bin_location}</div>
                    </div>

                    {isLow && (
                      <span className="badge badge-high" style={{ fontSize: '10px' }}>
                        Reorder Alert
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Stock Available</div>
                      <div style={{ fontSize: '16px', fontWeight: 800, color: isLow ? '#f43f5e' : '#fff' }}>
                        {p.available} units <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 400 }}>({p.qty_reserved} reserved)</span>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Price</div>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--accent-primary)' }}>
                        {formatCurrency(p.unit_price)}
                      </div>
                    </div>
                  </div>

                  {isStaff && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '10px' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '3px 8px', fontSize: '11px' }}
                        onClick={() => handleAdjustPartStock(p.id, 5)}
                      >
                        +5 Stock
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Repair Order Slideover / Modal */}
      {selectedJob && (
        <div className="modal-backdrop" onClick={() => setSelectedJob(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '26px', maxWidth: '750px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '14px' }}>
              <div>
                <span className={`badge badge-${selectedJob.status}`} style={{ marginBottom: '6px' }}>
                  {selectedJob.status?.toUpperCase()}
                </span>
                <h2 style={{ fontSize: '20px', fontWeight: 800 }}>Repair Order {selectedJob.ro_number}</h2>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Customer: <strong>{selectedJob.customer_name}</strong> &bull; Vehicle: <strong>{selectedJob.vehicle_title}</strong>
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--accent-primary)' }}>
                  {formatCurrency(selectedJob.total)}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Parts: {formatCurrency(selectedJob.parts_total)} &bull; Labor: {selectedJob.labor_hours}h @ $145/h
                </div>
              </div>
            </div>

            {/* Complaint & Diagnosis */}
            <div style={{ margin: '18px 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Customer Complaint</span>
                <p style={{ color: '#fff', fontSize: '13px', marginTop: '3px' }}>{selectedJob.complaint}</p>
              </div>

              {selectedJob.work_performed && (
                <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                  <span style={{ fontSize: '11px', color: '#34d399', fontWeight: 700, textTransform: 'uppercase' }}>Work Completed</span>
                  <p style={{ color: '#fff', fontSize: '13px', marginTop: '3px' }}>{selectedJob.work_performed}</p>
                </div>
              )}
            </div>

            {/* Allocated Parts */}
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Allocated Parts & Consumables
                </span>
                {selectedJob.status !== 'closed' && (
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '3px 8px', fontSize: '11px' }}
                    onClick={() => setShowAddPartToJob(true)}
                  >
                    + Add Part
                  </button>
                )}
              </div>

              {selectedJob.parts?.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  No parts billed to this order yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {selectedJob.parts?.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        padding: '8px 12px',
                        background: 'var(--bg-secondary)',
                        borderRadius: 'var(--radius-sm)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '12px',
                      }}
                    >
                      <div>
                        <strong>{p.quantity}x {p.name}</strong> <span style={{ color: 'var(--text-muted)' }}>({p.sku})</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span>{formatCurrency(p.unit_price * p.quantity)}</span>
                        {selectedJob.status !== 'closed' && (
                          <button
                            onClick={() => handleRemovePart(selectedJob.id, p.id)}
                            style={{ color: '#fb7185', cursor: 'pointer' }}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Status Advance Buttons */}
            {isStaff && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
                <button className="btn btn-secondary" onClick={() => setSelectedJob(null)}>
                  Close
                </button>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {selectedJob.status === 'scheduled' && (
                    <button className="btn btn-primary" onClick={() => handleUpdateJobStatus(selectedJob.id, 'checked_in')}>
                      Check-in Vehicle
                    </button>
                  )}
                  {selectedJob.status === 'checked_in' && (
                    <button className="btn btn-primary" onClick={() => handleUpdateJobStatus(selectedJob.id, 'in_progress')}>
                      Begin Labor (In Progress)
                    </button>
                  )}
                  {selectedJob.status === 'in_progress' && (
                    <>
                      <button className="btn btn-secondary" onClick={() => handleUpdateJobStatus(selectedJob.id, 'waiting_parts')}>
                        Hold for Parts
                      </button>
                      <button className="btn btn-primary" onClick={() => handleUpdateJobStatus(selectedJob.id, 'ready', true)}>
                        Complete & Notify Client
                      </button>
                    </>
                  )}
                  {selectedJob.status === 'waiting_parts' && (
                    <button className="btn btn-primary" onClick={() => handleUpdateJobStatus(selectedJob.id, 'in_progress')}>
                      Resume Labor
                    </button>
                  )}
                  {selectedJob.status === 'ready' && (
                    <button className="btn btn-primary" style={{ background: '#10b981' }} onClick={() => handleUpdateJobStatus(selectedJob.id, 'closed', true)}>
                      <CheckCircle2 size={15} />
                      <span>Deliver & Close RO</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Part to Job Picker */}
      {showAddPartToJob && (
        <div className="modal-backdrop" onClick={() => setShowAddPartToJob(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '20px', maxWidth: '440px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 800, marginBottom: '14px' }}>Add Part to RO</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
              {parts.filter((p) => p.available > 0).map((p) => (
                <div
                  key={p.id}
                  style={{
                    padding: '8px 10px',
                    background: 'var(--bg-secondary)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                  onClick={() => handleAddPart(selectedJob.id, p.id, 1)}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '12px' }}>{p.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{p.available} in stock</div>
                  </div>
                  <strong style={{ color: 'var(--accent-primary)', fontSize: '12px' }}>{formatCurrency(p.unit_price)}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Open Repair Order Modal */}
      {showCreateJob && (
        <div className="modal-backdrop" onClick={() => setShowCreateJob(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800 }}>Open New Service Repair Order</h2>
              <button onClick={() => setShowCreateJob(false)}><X size={18} /></button>
            </div>

            <form onSubmit={handleCreateJob} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Customer*</label>
                <select
                  required
                  className="input-field"
                  value={newJob.customer_id}
                  onChange={(e) => setNewJob({ ...newJob, customer_id: e.target.value })}
                >
                  {availableCustomers.map((c) => (
                    <option key={c.id} value={c.id}>{c.first_name} {c.last_name} &bull; {c.phone}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Customer Vehicle*</label>
                <input
                  type="text"
                  required
                  className="input-field"
                  value={newJob.customer_vehicle}
                  onChange={(e) => setNewJob({ ...newJob, customer_vehicle: e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Service Bay</label>
                  <select
                    className="input-field"
                    value={newJob.bay}
                    onChange={(e) => setNewJob({ ...newJob, bay: e.target.value })}
                  >
                    <option value="Bay 1">Bay 1 (Fast Lube)</option>
                    <option value="Bay 2">Bay 2 (Brakes & Align)</option>
                    <option value="Bay 3">Bay 3 (Engine Diagnostic)</option>
                    <option value="Bay 4">Bay 4 (Transmission)</option>
                    <option value="Bay 5">Bay 5 (Electrical/EV)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Assigned Technician</label>
                  <select
                    className="input-field"
                    value={newJob.technician}
                    onChange={(e) => setNewJob({ ...newJob, technician: e.target.value })}
                  >
                    <option value="J. Park">J. Park (Master Tech)</option>
                    <option value="R. Okafor">R. Okafor (Electrical/HVAC)</option>
                    <option value="T. Lindqvist">T. Lindqvist (Chassis)</option>
                    <option value="M. Santos">M. Santos (Engine/Drivetrain)</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Customer Complaint & Work Requested*</label>
                <textarea
                  required
                  rows={3}
                  className="input-field"
                  value={newJob.complaint}
                  onChange={(e) => setNewJob({ ...newJob, complaint: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateJob(false)}>
                  Cancel
                </button>
                <button id="submit-create-ro-btn" type="submit" className="btn btn-primary">
                  Open Repair Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
