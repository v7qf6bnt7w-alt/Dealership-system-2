import React, { useState, useEffect } from 'react';
import { api, formatCurrency, formatDate } from '../api';
import { useAuth } from '../context/AuthContext';
import { 
  FileSpreadsheet, Plus, DollarSign, Calculator, CheckCircle2, 
  Car, User, ArrowRight, X, Printer, Send
} from 'lucide-react';

export default function DealsView() {
  const { isStaff, user } = useAuth();
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [showDeskModal, setShowDeskModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Desking live calculator state
  const [calcInputs, setCalcInputs] = useState({
    vehicle_price: 3890000,
    discount: 100000,
    trade_in_value: 800000,
    trade_in_payoff: 500000,
    tax_rate: 0.0825,
    deposit: 100000,
    fees: [
      { label: 'Documentation fee', amount: 15000, taxable: true },
      { label: 'Title & registration', amount: 33500, taxable: false },
      { label: 'Dealer prep & detailing', amount: 29500, taxable: true },
    ],
    accessories: [
      { label: 'All-weather floor mats', amount: 22500, taxable: true },
      { label: 'Ceramic paint protection', amount: 89500, taxable: true },
    ],
  });

  const [calcResult, setCalcResult] = useState(null);

  // New deal form
  const [newDealData, setNewDealData] = useState({
    customer_id: '',
    vehicle_id: '',
    discount: 0,
    trade_in_value: 0,
    trade_in_payoff: 0,
    trade_in_desc: '',
    deposit: 0,
  });

  const [availableVehicles, setAvailableVehicles] = useState([]);
  const [availableCustomers, setAvailableCustomers] = useState([]);

  async function loadDeals() {
    try {
      setLoading(true);
      const res = await api.get('/deals');
      setDeals(res || []);
    } catch (e) {
      console.error('Failed to load deals:', e);
    } finally {
      setLoading(false);
    }
  }

  async function recalculate() {
    try {
      const res = await api.post('/deals/calculate', calcInputs);
      setCalcResult(res);
    } catch (e) {
      console.error('Calculator error:', e);
    }
  }

  useEffect(() => {
    loadDeals();
    recalculate();
  }, []);

  useEffect(() => {
    recalculate();
  }, [calcInputs]);

  async function openCreateDeal() {
    setShowCreateModal(true);
    try {
      const [vRes, cRes] = await Promise.all([
        api.get('/inventory?status=in_stock&limit=30'),
        api.get('/customers?limit=30'),
      ]);
      setAvailableVehicles(vRes.items || []);
      setAvailableCustomers(cRes || []);
      if (vRes.items?.[0] && cRes?.[0]) {
        setNewDealData((prev) => ({
          ...prev,
          vehicle_id: vRes.items[0].id,
          customer_id: cRes[0].id,
        }));
      }
    } catch (e) {
      console.error('Error prefetching deals form:', e);
    }
  }

  async function handleCreateDealSubmit(e) {
    e.preventDefault();
    try {
      const created = await api.post('/deals', {
        customer_id: Number(newDealData.customer_id),
        vehicle_id: Number(newDealData.vehicle_id),
        discount: Number(newDealData.discount),
        trade_in_value: Number(newDealData.trade_in_value),
        trade_in_payoff: Number(newDealData.trade_in_payoff),
        trade_in_desc: newDealData.trade_in_desc || null,
        deposit: Number(newDealData.deposit),
      });
      setShowCreateModal(false);
      loadDeals();
      const full = await api.get(`/deals/${created.id}`);
      setSelectedDeal(full);
      alert(`Deal ${created.deal_number} created successfully!`);
    } catch (err) {
      alert(`Failed to create deal: ${err.message}`);
    }
  }

  async function handleUpdateStatus(dealId, newStatus, sendNotification = false) {
    try {
      await api.post(`/deals/${dealId}/status`, {
        status: newStatus,
        send_to_customer: sendNotification,
      });
      loadDeals();
      const updated = await api.get(`/deals/${dealId}`);
      setSelectedDeal(updated);
      alert(`Deal updated to ${newStatus.toUpperCase()}` + (sendNotification ? ' and sent to customer via email!' : ''));
    } catch (err) {
      alert(`Status transition failed: ${err.message}`);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800 }}>Deal Desking & Out-The-Door Math</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Integer-cents precision desking &bull; Automated trade-in tax credits &bull; Full lifecycle ledger
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            id="btn-open-calculator"
            className="btn btn-secondary"
            onClick={() => setShowDeskModal(true)}
          >
            <Calculator size={15} color="var(--accent-primary)" />
            <span>Interactive Desking Simulator</span>
          </button>

          {isStaff && (
            <button
              id="btn-create-deal"
              className="btn btn-primary"
              onClick={openCreateDeal}
            >
              <Plus size={16} />
              <span>Open New Deal</span>
            </button>
          )}
        </div>
      </div>

      {/* Deals Ledger Table */}
      <div className="glass-panel" style={{ padding: '20px' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading deals ledger...
          </div>
        ) : deals.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No deals found in this pipeline.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase' }}>
                  <th style={{ padding: '12px' }}>Deal #</th>
                  <th style={{ padding: '12px' }}>Customer</th>
                  <th style={{ padding: '12px' }}>Vehicle</th>
                  <th style={{ padding: '12px' }}>Sales Rep</th>
                  <th style={{ padding: '12px' }}>Status</th>
                  <th style={{ padding: '12px' }}>Out-The-Door Total</th>
                  <th style={{ padding: '12px' }}>Gross Profit</th>
                  <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => (
                  <tr
                    key={d.id}
                    style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background var(--transition-fast)' }}
                  >
                    <td style={{ padding: '12px', fontWeight: 700, color: '#fff' }}>
                      {d.deal_number}
                    </td>

                    <td style={{ padding: '12px' }}>
                      <div style={{ fontWeight: 600, color: '#fff' }}>{d.customer_name}</div>
                    </td>

                    <td style={{ padding: '12px', color: 'var(--text-secondary)' }}>
                      {d.vehicle_title}
                    </td>

                    <td style={{ padding: '12px' }}>
                      {d.rep_name || 'Staff'}
                    </td>

                    <td style={{ padding: '12px' }}>
                      <span className={`badge badge-${d.status === 'delivered' ? 'new' : d.status === 'invoiced' ? 'certified' : d.status === 'quoted' ? 'normal' : 'low'}`}>
                        {d.status}
                      </span>
                    </td>

                    <td style={{ padding: '12px', fontWeight: 800, color: 'var(--accent-primary)', fontSize: '14px' }}>
                      {formatCurrency(d.total_otd)}
                    </td>

                    <td style={{ padding: '12px', fontWeight: 700, color: '#34d399' }}>
                      +{formatCurrency(d.gross_profit)}
                    </td>

                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '4px 10px', fontSize: '12px' }}
                        onClick={async () => {
                          const full = await api.get(`/deals/${d.id}`);
                          setSelectedDeal(full);
                        }}
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Deal Full Invoice & Workflow Modal */}
      {selectedDeal && (
        <div className="modal-backdrop" onClick={() => setSelectedDeal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '28px', maxWidth: '780px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '16px' }}>
              <div>
                <span className={`badge badge-${selectedDeal.status}`} style={{ marginBottom: '6px' }}>
                  {selectedDeal.status?.toUpperCase()}
                </span>
                <h2 style={{ fontSize: '22px', fontWeight: 800 }}>Deal {selectedDeal.deal_number}</h2>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Customer: <strong>{selectedDeal.customer_name}</strong> &bull; Rep: <strong>{selectedDeal.rep_name}</strong>
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--accent-primary)' }}>
                  {formatCurrency(selectedDeal.total_otd)}
                </div>
                <div style={{ fontSize: '12px', color: '#34d399' }}>
                  Projected Gross: {formatCurrency(selectedDeal.gross_profit)}
                </div>
              </div>
            </div>

            {/* Vehicle specs summary */}
            <div style={{ display: 'flex', gap: '14px', alignItems: 'center', padding: '14px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', margin: '18px 0' }}>
              <Car size={24} color="var(--accent-primary)" />
              <div>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#fff' }}>
                  {selectedDeal.year} {selectedDeal.make} {selectedDeal.model} {selectedDeal.trim}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  VIN: {selectedDeal.vin} &bull; Stock #{selectedDeal.stock_number} &bull; Color: {selectedDeal.exterior_color}
                </div>
              </div>
            </div>

            {/* Detailed Line Item Table */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>Vehicle Base Price:</span>
                <strong>{formatCurrency(selectedDeal.vehicle_price)}</strong>
              </div>

              {selectedDeal.discount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#34d399', padding: '4px 0' }}>
                  <span>Dealer Discount:</span>
                  <strong>-{formatCurrency(selectedDeal.discount)}</strong>
                </div>
              )}

              {selectedDeal.trade_in_value > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#60a5fa', padding: '4px 0' }}>
                  <span>Trade-in Allowance ({selectedDeal.trade_in_desc || 'Vehicle'}):</span>
                  <strong>-{formatCurrency(selectedDeal.trade_in_value)}</strong>
                </div>
              )}

              {selectedDeal.trade_in_payoff > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#fb7185', padding: '4px 0' }}>
                  <span>Trade-in Payoff Lien Balance:</span>
                  <strong>+{formatCurrency(selectedDeal.trade_in_payoff)}</strong>
                </div>
              )}

              {/* Accessories breakdown */}
              {selectedDeal.accessories && selectedDeal.accessories.length > 0 && (
                <div style={{ borderTop: '1px dashed var(--border-subtle)', paddingTop: '6px', margin: '4px 0' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>ADD-ONS & ACCESSORIES</div>
                  {selectedDeal.accessories.map((acc, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '2px 0' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>+ {acc.label}</span>
                      <span>{formatCurrency(acc.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Fees breakdown */}
              {selectedDeal.fees && selectedDeal.fees.length > 0 && (
                <div style={{ borderTop: '1px dashed var(--border-subtle)', paddingTop: '6px', margin: '4px 0' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>GOVERNMENT & DEALER FEES</div>
                  {selectedDeal.fees.map((fee, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '2px 0' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>+ {fee.label}</span>
                      <span>{formatCurrency(fee.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px' }}>
                <span>Sales Tax (8.25% after trade-in credit):</span>
                <strong>{formatCurrency(selectedDeal.tax_total)}</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 800, color: '#fff', borderTop: '2px solid var(--accent-primary)', paddingTop: '8px' }}>
                <span>Total Out-The-Door:</span>
                <span style={{ color: 'var(--accent-primary)' }}>{formatCurrency(selectedDeal.total_otd)}</span>
              </div>
            </div>

            {/* Workflow Action Buttons */}
            {isStaff && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                <button className="btn btn-secondary" onClick={() => setSelectedDeal(null)}>
                  Close
                </button>

                <div style={{ display: 'flex', gap: '8px' }}>
                  {selectedDeal.status === 'draft' && (
                    <button
                      className="btn btn-primary"
                      onClick={() => handleUpdateStatus(selectedDeal.id, 'quoted', true)}
                    >
                      <Send size={14} />
                      <span>Publish Quote & Email Client</span>
                    </button>
                  )}

                  {selectedDeal.status === 'quoted' && (
                    <button
                      className="btn btn-primary"
                      onClick={() => handleUpdateStatus(selectedDeal.id, 'accepted')}
                    >
                      <span>Mark Quote Accepted (Reserve Car)</span>
                    </button>
                  )}

                  {selectedDeal.status === 'accepted' && (
                    <button
                      className="btn btn-primary"
                      onClick={() => handleUpdateStatus(selectedDeal.id, 'invoiced')}
                    >
                      <span>Generate Final Invoice</span>
                    </button>
                  )}

                  {selectedDeal.status === 'invoiced' && (
                    <button
                      className="btn btn-primary"
                      style={{ background: '#10b981' }}
                      onClick={() => handleUpdateStatus(selectedDeal.id, 'delivered')}
                    >
                      <CheckCircle2 size={15} />
                      <span>Mark Delivered & Handover Keys</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live Desking Simulator Modal */}
      {showDeskModal && (
        <div className="modal-backdrop" onClick={() => setShowDeskModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '24px', maxWidth: '720px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calculator size={20} color="var(--accent-primary)" />
                <h2 style={{ fontSize: '18px', fontWeight: 800 }}>Live Deal Desking Calculator</h2>
              </div>
              <button onClick={() => setShowDeskModal(false)}><X size={18} /></button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
              {/* Inputs */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Vehicle Advertised Price ($)</label>
                  <input
                    type="number"
                    className="input-field"
                    value={calcInputs.vehicle_price / 100}
                    onChange={(e) => setCalcInputs({ ...calcInputs, vehicle_price: Number(e.target.value) * 100 })}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Dealer Discount ($)</label>
                  <input
                    type="number"
                    className="input-field"
                    value={calcInputs.discount / 100}
                    onChange={(e) => setCalcInputs({ ...calcInputs, discount: Number(e.target.value) * 100 })}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Trade-In Allowance ($)</label>
                  <input
                    type="number"
                    className="input-field"
                    value={calcInputs.trade_in_value / 100}
                    onChange={(e) => setCalcInputs({ ...calcInputs, trade_in_value: Number(e.target.value) * 100 })}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Trade-In Lien Payoff ($)</label>
                  <input
                    type="number"
                    className="input-field"
                    value={calcInputs.trade_in_payoff / 100}
                    onChange={(e) => setCalcInputs({ ...calcInputs, trade_in_payoff: Number(e.target.value) * 100 })}
                  />
                </div>
              </div>

              {/* Live Output */}
              {calcResult && (
                <div style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Selling Price:</span>
                      <strong>{formatCurrency(calcResult.selling_price)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Accessories Total:</span>
                      <strong>{formatCurrency(calcResult.accessories_total)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Fees Total:</span>
                      <strong>{formatCurrency(calcResult.fees_total)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Taxable Base:</span>
                      <strong>{formatCurrency(calcResult.taxable_base)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Sales Tax:</span>
                      <strong>{formatCurrency(calcResult.tax_total)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Net Trade Equity:</span>
                      <strong style={{ color: calcResult.net_trade >= 0 ? '#34d399' : '#fb7185' }}>
                        {formatCurrency(calcResult.net_trade)}
                      </strong>
                    </div>
                  </div>

                  <div style={{ borderTop: '2px solid var(--accent-primary)', paddingTop: '12px', marginTop: '12px' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Out-The-Door Total
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--accent-primary)' }}>
                      {formatCurrency(calcResult.total_otd)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Deal Modal */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800 }}>Open Deal for Client</h2>
              <button onClick={() => setShowCreateModal(false)}><X size={18} /></button>
            </div>

            <form onSubmit={handleCreateDealSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Select Customer*</label>
                <select
                  required
                  className="input-field"
                  value={newDealData.customer_id}
                  onChange={(e) => setNewDealData({ ...newDealData, customer_id: e.target.value })}
                >
                  {availableCustomers.map((c) => (
                    <option key={c.id} value={c.id}>{c.first_name} {c.last_name} &bull; {c.email || c.phone}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Select Vehicle*</label>
                <select
                  required
                  className="input-field"
                  value={newDealData.vehicle_id}
                  onChange={(e) => setNewDealData({ ...newDealData, vehicle_id: e.target.value })}
                >
                  {availableVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.year} {v.make} {v.model} &bull; {formatCurrency(v.price)} (#{v.stock_number})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Discount ($)</label>
                  <input
                    type="number"
                    className="input-field"
                    value={newDealData.discount / 100}
                    onChange={(e) => setNewDealData({ ...newDealData, discount: Number(e.target.value) * 100 })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Trade-in Value ($)</label>
                  <input
                    type="number"
                    className="input-field"
                    value={newDealData.trade_in_value / 100}
                    onChange={(e) => setNewDealData({ ...newDealData, trade_in_value: Number(e.target.value) * 100 })}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Trade-in Description</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. 2017 Honda Accord EX, 85k mi"
                  value={newDealData.trade_in_desc}
                  onChange={(e) => setNewDealData({ ...newDealData, trade_in_desc: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button id="submit-create-deal-btn" type="submit" className="btn btn-primary">
                  Draft Deal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
