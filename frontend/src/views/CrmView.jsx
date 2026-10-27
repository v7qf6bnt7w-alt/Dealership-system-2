import React, { useState, useEffect } from 'react';
import { api, formatCurrency, formatDate } from '../api';
import { useAuth } from '../context/AuthContext';
import { 
  GitPullRequest, Plus, User, Phone, Mail, MessageSquare, 
  Car, Clock, CheckCircle2, ChevronRight, X, AlertCircle, Zap
} from 'lucide-react';

const STAGES = [
  { id: 'new', label: 'New Inquiries', color: '#60a5fa' },
  { id: 'contacted', label: 'Contacted', color: '#38bdf8' },
  { id: 'qualified', label: 'Qualified', color: '#a78bfa' },
  { id: 'test_drive', label: 'Test Drive', color: '#f59e0b' },
  { id: 'negotiation', label: 'Negotiation', color: '#f26b3a' },
  { id: 'won', label: 'Won / Closed', color: '#10b981' },
  { id: 'lost', label: 'Lost', color: '#64748b' },
];

export default function CrmView({ onNavigate }) {
  const { user } = useAuth();
  const [leads, setLeads] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [selectedLead, setSelectedLead] = useState(null);

  // New Lead form state
  const [newLead, setNewLead] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    source: 'walk_in',
    budget: 3500000,
    score: 65,
    notes: 'Interested in touring dealership stock',
    preferred_channel: 'whatsapp',
  });

  async function loadData() {
    try {
      setLoading(true);
      const [leadsRes, tasksRes] = await Promise.all([
        api.get('/leads?include_closed_days=30'),
        api.get('/tasks?scope=all&status=open'),
      ]);
      setLeads(leadsRes || []);
      setTasks(tasksRes || []);
    } catch (e) {
      console.error('Failed to load CRM data:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleMoveLead(leadId, targetStage, lostReason = null) {
    try {
      await api.post(`/leads/${leadId}/move`, {
        stage: targetStage,
        lost_reason: lostReason,
      });
      loadData();
    } catch (e) {
      alert(`Error moving lead: ${e.message}`);
    }
  }

  async function handleCompleteTask(taskId) {
    try {
      await api.post(`/tasks/${taskId}/complete`);
      loadData();
    } catch (e) {
      alert(`Error completing task: ${e.message}`);
    }
  }

  async function handleCreateLead(e) {
    e.preventDefault();
    try {
      await api.post('/leads', {
        source: newLead.source,
        budget: newLead.budget,
        score: newLead.score,
        notes: newLead.notes,
        new_customer: {
          first_name: newLead.first_name,
          last_name: newLead.last_name,
          email: newLead.email,
          phone: newLead.phone,
          whatsapp: newLead.phone,
          preferred_channel: newLead.preferred_channel,
          consents: {
            data_processing: true,
            email: true,
            whatsapp: true,
          },
        },
      });
      setShowNewLeadModal(false);
      loadData();
      alert('Lead and customer record created!');
    } catch (err) {
      alert(`Failed to create lead: ${err.message}`);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800 }}>Sales CRM & Kanban Pipeline</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Automated follow-up rules &bull; Multi-channel customer journey &bull; SLA tracking
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            id="crm-run-sweep-btn"
            className="btn btn-secondary"
            onClick={async () => {
              const res = await api.post('/automation/run');
              alert(`Automation sweep triggered: ${res.tasks_created} tasks, ${res.reminders_sent} WhatsApp/Email reminders sent.`);
              loadData();
            }}
          >
            <Zap size={15} color="var(--accent-primary)" />
            <span>Trigger Follow-up Sweep</span>
          </button>

          <button
            id="btn-new-lead"
            className="btn btn-primary"
            onClick={() => setShowNewLeadModal(true)}
          >
            <Plus size={16} />
            <span>New Lead</span>
          </button>
        </div>
      </div>

      {/* Kanban Board Container */}
      {loading && leads.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading CRM pipeline...
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(250px, 1fr))',
          gap: '14px',
          overflowX: 'auto',
          paddingBottom: '16px',
        }}>
          {STAGES.map((col) => {
            const colLeads = leads.filter((l) => l.stage === col.id);
            const totalBudget = colLeads.reduce((acc, curr) => acc + (curr.budget || 0), 0);

            return (
              <div
                key={col.id}
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-lg)',
                  display: 'flex',
                  flexDirection: 'column',
                  maxHeight: 'calc(100vh - 200px)',
                }}
              >
                {/* Column Header */}
                <div style={{
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--border-subtle)',
                  borderTop: `3px solid ${col.color}`,
                  borderTopLeftRadius: 'var(--radius-lg)',
                  borderTopRightRadius: 'var(--radius-lg)',
                  background: 'var(--bg-surface)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 700, fontSize: '13px', color: '#fff' }}>{col.label}</span>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      background: 'var(--bg-secondary)',
                      padding: '2px 7px',
                      borderRadius: 'var(--radius-full)',
                      color: col.color,
                    }}>
                      {colLeads.length}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {formatCurrency(totalBudget)} pipeline
                  </div>
                </div>

                {/* Cards List */}
                <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', flex: 1 }}>
                  {colLeads.map((lead) => (
                    <div
                      key={lead.id}
                      className="glass-panel"
                      style={{
                        padding: '12px',
                        cursor: 'pointer',
                        transition: 'transform 0.15s ease, border-color 0.15s ease',
                      }}
                      onClick={() => setSelectedLead(lead)}
                    >
                      {/* Customer info */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 700, color: '#fff', fontSize: '13px' }}>
                            {lead.customer_name}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {lead.preferred_channel === 'whatsapp' ? (
                              <MessageSquare size={11} color="#10b981" />
                            ) : (
                              <Mail size={11} color="#60a5fa" />
                            )}
                            <span>{lead.customer_phone || lead.customer_email || 'No contact'}</span>
                          </div>
                        </div>

                        {/* Score badge */}
                        <div style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: lead.score >= 70 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                          color: lead.score >= 70 ? '#34d399' : '#fbbf24',
                        }}>
                          {lead.score} pts
                        </div>
                      </div>

                      {/* Vehicle Interest */}
                      {lead.vehicle_title ? (
                        <div style={{
                          marginTop: '10px',
                          padding: '8px',
                          background: 'var(--bg-secondary)',
                          borderRadius: 'var(--radius-sm)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}>
                          <Car size={14} color="var(--accent-primary)" />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '11px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {lead.vehicle_title}
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                              {formatCurrency(lead.vehicle_price)}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                          Budget: {formatCurrency(lead.budget)}
                        </div>
                      )}

                      {/* Rep & Tasks Footer */}
                      <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: lead.assigned_color || 'var(--accent-primary)' }} />
                          <span>{lead.assigned_name || 'Unassigned'}</span>
                        </div>

                        {lead.open_tasks > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '3px', color: '#fb7185', fontWeight: 600 }}>
                            <Clock size={11} />
                            <span>{lead.open_tasks} task</span>
                          </div>
                        )}
                      </div>

                      {/* Stage Advancement Quick Controls */}
                      <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', gap: '6px' }}>
                        {col.id !== 'won' && col.id !== 'lost' && (
                          <>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '3px 8px', fontSize: '10px' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                const nextIndex = STAGES.findIndex((s) => s.id === col.id) + 1;
                                if (nextIndex < STAGES.length - 1) {
                                  handleMoveLead(lead.id, STAGES[nextIndex].id);
                                }
                              }}
                            >
                              Advance &rarr;
                            </button>

                            <button
                              className="btn btn-secondary"
                              style={{ padding: '3px 6px', fontSize: '10px', color: '#fb7185' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                const reason = prompt('Lost reason (e.g. Bought elsewhere, Price too high):', 'Price too high');
                                if (reason) handleMoveLead(lead.id, 'lost', reason);
                              }}
                            >
                              Mark Lost
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Active Tasks & Follow-up Drawer */}
      <div className="glass-panel" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Clock size={18} color="var(--accent-primary)" />
            <h2 style={{ fontSize: '16px', fontWeight: 700 }}>Open Automated Follow-Up Tasks ({tasks.length})</h2>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Idempotent rule engine scheduled
          </span>
        </div>

        {tasks.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '12px 0' }}>
            All customer follow-up tasks are completed!
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
            {tasks.slice(0, 6).map((t) => (
              <div
                key={t.id}
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: '#fff' }}>{t.title}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Assigned to: <strong>{t.assigned_name || 'Staff'}</strong> &bull; Due: {formatDate(t.due_at)}
                  </div>
                </div>

                <button
                  className="btn btn-secondary"
                  style={{ padding: '6px 10px', fontSize: '11px' }}
                  onClick={() => handleCompleteTask(t.id)}
                  title="Mark Completed"
                >
                  <CheckCircle2 size={14} color="#34d399" />
                  <span>Done</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lead Detail Modal */}
      {selectedLead && (
        <div className="modal-backdrop" onClick={() => setSelectedLead(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <span className="badge badge-normal" style={{ marginBottom: '6px' }}>{selectedLead.stage?.toUpperCase()}</span>
                <h2 style={{ fontSize: '20px', fontWeight: 800 }}>{selectedLead.customer_name}</h2>
              </div>
              <button onClick={() => setSelectedLead(null)}><X size={18} /></button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px', marginBottom: '16px' }}>
              <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Phone / WhatsApp</span>
                <div style={{ fontWeight: 600, color: '#fff', marginTop: '2px' }}>{selectedLead.customer_phone || '—'}</div>
              </div>
              <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Email</span>
                <div style={{ fontWeight: 600, color: '#fff', marginTop: '2px' }}>{selectedLead.customer_email || '—'}</div>
              </div>
            </div>

            {selectedLead.vehicle_title && (
              <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Target Vehicle</span>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#fff', marginTop: '2px' }}>
                  {selectedLead.vehicle_title} &bull; {formatCurrency(selectedLead.vehicle_price)}
                </div>
              </div>
            )}

            {selectedLead.notes && (
              <div style={{ marginBottom: '20px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Notes</span>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>{selectedLead.notes}</p>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setSelectedLead(null);
                  onNavigate('comms');
                }}
              >
                Send Message
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setSelectedLead(null);
                  onNavigate('test_drives');
                }}
              >
                Book Test Drive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Lead Modal */}
      {showNewLeadModal && (
        <div className="modal-backdrop" onClick={() => setShowNewLeadModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800 }}>Capture New Inbound Lead</h2>
              <button onClick={() => setShowNewLeadModal(false)}><X size={18} /></button>
            </div>

            <form onSubmit={handleCreateLead} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>First Name*</label>
                  <input
                    type="text"
                    required
                    className="input-field"
                    value={newLead.first_name}
                    onChange={(e) => setNewLead({ ...newLead, first_name: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Last Name*</label>
                  <input
                    type="text"
                    required
                    className="input-field"
                    value={newLead.last_name}
                    onChange={(e) => setNewLead({ ...newLead, last_name: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Phone / WhatsApp*</label>
                  <input
                    type="text"
                    required
                    className="input-field"
                    value={newLead.phone}
                    onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Email Address</label>
                  <input
                    type="email"
                    className="input-field"
                    value={newLead.email}
                    onChange={(e) => setNewLead({ ...newLead, email: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Inquiry Source</label>
                  <select
                    className="input-field"
                    value={newLead.source}
                    onChange={(e) => setNewLead({ ...newLead, source: e.target.value })}
                  >
                    <option value="walk_in">Walk-in Showroom</option>
                    <option value="website">Website Lead Form</option>
                    <option value="phone">Inbound Phone Call</option>
                    <option value="whatsapp">WhatsApp Direct</option>
                    <option value="referral">Client Referral</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Customer Budget ($)</label>
                  <input
                    type="number"
                    className="input-field"
                    value={newLead.budget / 100}
                    onChange={(e) => setNewLead({ ...newLead, budget: Number(e.target.value) * 100 })}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Conversation / Vehicle Notes</label>
                <textarea
                  className="input-field"
                  rows={3}
                  value={newLead.notes}
                  onChange={(e) => setNewLead({ ...newLead, notes: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowNewLeadModal(false)}>
                  Cancel
                </button>
                <button id="submit-create-lead-btn" type="submit" className="btn btn-primary">
                  Create Lead Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
