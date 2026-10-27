import React, { useState, useEffect } from 'react';
import { api, formatCurrency, formatDate } from '../api';
import { 
  DollarSign, TrendingUp, Car, Award, Clock, ArrowUpRight, 
  CheckCircle, AlertTriangle, Calendar, Activity, Zap
} from 'lucide-react';

export default function DashboardView({ onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadDashboard() {
    try {
      setLoading(true);
      const res = await api.get('/dashboard');
      setData(res);
    } catch (e) {
      console.error('Failed to load dashboard:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  if (loading && !data) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '16px', fontWeight: 600 }}>Loading Executive Dashboard...</div>
      </div>
    );
  }

  const kpis = data?.kpis?.current || {};
  const prevKpis = data?.kpis?.previous || {};
  const inventory = data?.inventory || {};
  const aging = data?.aging || [];
  const pipeline = data?.pipeline || [];
  const leaderboard = data?.leaderboard || [];
  const service = data?.service || {};
  const todayDrives = data?.today_test_drives || [];
  const recent = data?.recent_activity || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Banner & KPI Cards */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800 }}>Dealership Executive Overview</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '2px' }}>
            Real-time telemetry, vehicle velocity and revenue metrics.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            id="dash-run-automation"
            className="btn btn-secondary"
            onClick={async () => {
              const res = await api.post('/automation/run');
              alert(`Automation sweep completed: ${res.tasks_created} follow-up tasks, ${res.reminders_sent} 24h reminders.`);
              loadDashboard();
            }}
          >
            <Zap size={14} color="var(--accent-primary)" />
            <span>Run Follow-up Sweep</span>
          </button>
          <button className="btn btn-primary" onClick={loadDashboard}>
            Refresh
          </button>
        </div>
      </div>

      {/* Primary KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 600 }}>
            <span>DELIVERED UNITS (MTD)</span>
            <Car size={16} color="var(--accent-primary)" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, marginTop: '8px', color: '#fff' }}>
            {kpis.units || 0} <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-muted)' }}>cars</span>
          </div>
          <div style={{ fontSize: '12px', color: '#34d399', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
            <TrendingUp size={13} />
            <span>vs {prevKpis.units || 0} last month</span>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 600 }}>
            <span>TOTAL REVENUE (MTD)</span>
            <DollarSign size={16} color="#34d399" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, marginTop: '8px', color: '#fff' }}>
            {formatCurrency(kpis.revenue)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Out-the-door delivered value
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 600 }}>
            <span>GROSS PROFIT (MTD)</span>
            <Award size={16} color="var(--accent-secondary)" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, marginTop: '8px', color: '#fff' }}>
            {formatCurrency(kpis.gross)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Margin after vehicle cost & accessories
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '12px', fontWeight: 600 }}>
            <span>CONVERSION RATE</span>
            <ArrowUpRight size={16} color="#a78bfa" />
          </div>
          <div style={{ fontSize: '28px', fontWeight: 800, marginTop: '8px', color: '#fff' }}>
            {data?.kpis?.conversion_rate || 0}%
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            {data?.kpis?.new_leads_month || 0} new leads this month
          </div>
        </div>
      </div>

      {/* Middle Grid: Inventory Velocity + Sales Leaderboard */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '20px' }}>
        {/* Inventory Velocity Card */}
        <div className="glass-panel" style={{ padding: '22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700 }}>Inventory Health & Turnover</h2>
            <span className="badge badge-new">{inventory.in_stock || 0} In Stock</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Stock Book Value</div>
              <div style={{ fontSize: '17px', fontWeight: 700, color: '#fff', marginTop: '2px' }}>
                {formatCurrency(inventory.stock_value)}
              </div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Avg Days on Lot</div>
              <div style={{ fontSize: '17px', fontWeight: 700, color: '#fff', marginTop: '2px' }}>
                {inventory.avg_days_in_stock || 0} days
              </div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Turnover Rate</div>
              <div style={{ fontSize: '17px', fontWeight: 700, color: '#34d399', marginTop: '2px' }}>
                {inventory.turnover_rate || 0}x / yr
              </div>
            </div>
          </div>

          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px' }}>
            INVENTORY AGING BRACKETS
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {aging.map((b) => (
              <div key={b.bucket} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px' }}>
                <span style={{ width: '70px', color: 'var(--text-secondary)' }}>{b.bucket} days</span>
                <div style={{ flex: 1, height: '8px', background: 'var(--bg-secondary)', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min((b.count / (inventory.total_units || 1)) * 100 * 2, 100)}%`,
                    height: '100%',
                    background: b.bucket === '90+' ? '#f43f5e' : 'var(--accent-primary)',
                    borderRadius: '4px',
                  }} />
                </div>
                <span style={{ width: '40px', textAlign: 'right', fontWeight: 600 }}>{b.count} cars</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sales Leaderboard */}
        <div className="glass-panel" style={{ padding: '22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700 }}>Sales Rep Leaderboard (90 Days)</h2>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Closed Delivered</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {leaderboard.map((rep, idx) => (
              <div
                key={rep.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: idx === 0 ? '#f59e0b' : idx === 1 ? '#94a3b8' : '#b45309',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '11px',
                  }}>
                    {idx + 1}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, color: '#fff', fontSize: '13px' }}>{rep.full_name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{rep.units} units closed</div>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, color: 'var(--accent-primary)', fontSize: '13px' }}>
                    {formatCurrency(rep.revenue)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#34d399' }}>
                    +{formatCurrency(rep.gross)} gross
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Grid: Today's Test Drives + Service Ops + Live Activity */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        {/* Today's Test Drives */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 700 }}>Today's Scheduled Drives</h2>
            <button 
              onClick={() => onNavigate('test_drives')} 
              style={{ fontSize: '12px', color: 'var(--accent-primary)', cursor: 'pointer' }}
            >
              View All
            </button>
          </div>

          {todayDrives.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '16px 0', textAlign: 'center' }}>
              No test drives remaining today.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {todayDrives.map((td) => (
                <div
                  key={td.id}
                  style={{
                    padding: '10px',
                    background: 'var(--bg-secondary)',
                    borderRadius: 'var(--radius-md)',
                    borderLeft: '3px solid var(--accent-primary)',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: '#fff' }}>{td.vehicle_title}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Client: {td.customer_name}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="badge badge-normal">{td.status}</span>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {new Date(td.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Workshop & Service Summary */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 700 }}>Workshop & Aftersales</h2>
            <button 
              onClick={() => onNavigate('service')} 
              style={{ fontSize: '12px', color: 'var(--accent-primary)', cursor: 'pointer' }}
            >
              Service Bay
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '14px' }}>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Open Repair Orders</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#fff' }}>{service.open_jobs || 0}</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Ready for Pickup</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#34d399' }}>{service.ready || 0}</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Waiting for Parts</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#fbbf24' }}>{service.waiting_parts || 0}</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Parts Below Reorder</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: service.low_stock_parts > 0 ? '#f43f5e' : '#fff' }}>
                {service.low_stock_parts || 0}
              </div>
            </div>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Service Labor & Parts Revenue (MTD): <strong style={{ color: '#fff' }}>{formatCurrency(service.revenue_mtd)}</strong>
          </div>
        </div>

        {/* Live Dealership Timeline */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 700 }}>Real-Time Activity Stream</h2>
            <Activity size={16} color="var(--accent-primary)" />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto' }}>
            {recent.slice(0, 7).map((act) => (
              <div key={act.id} style={{ fontSize: '12px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '6px' }}>
                <div style={{ color: '#fff', fontWeight: 500 }}>{act.summary}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '10px', marginTop: '2px' }}>
                  <span>{act.customer_name ? `Client: ${act.customer_name}` : 'Internal'}</span>
                  <span>{formatDate(act.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
