import React, { useState, useEffect } from 'react';
import { api, formatCurrency, formatMiles, formatDate, formatDateTime } from '../api';
import { useAuth } from '../context/AuthContext';
import { 
  Car, Heart, Calendar, Wrench, Shield, Download, 
  Trash2, Clock, CheckCircle2, AlertCircle, ArrowRight, X
} from 'lucide-react';

export default function PortalView({ viewMode = 'portal_garage', onNavigate }) {
  const { user } = useAuth();
  const [garageData, setGarageData] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [testDrives, setTestDrives] = useState([]);
  const [consents, setConsents] = useState({});
  const [loading, setLoading] = useState(true);

  // Booking form
  const [bookingVehicleId, setBookingVehicleId] = useState('');
  const [bookingTime, setBookingTime] = useState('');
  const [bookingMessage, setBookingMessage] = useState('Looking forward to driving this car!');

  async function loadCustomerData() {
    try {
      setLoading(true);
      const [gRes, fRes, vRes, tdRes, meRes] = await Promise.all([
        api.get('/portal/garage').catch(() => ({ vehicles: [], service_jobs: [], quotes: [] })),
        api.get('/portal/favorites').catch(() => []),
        api.get('/inventory?limit=24').catch(() => ({ items: [] })),
        api.get('/portal/test-drives').catch(() => []),
        api.get('/portal/me').catch(() => ({ consents: {} })),
      ]);
      setGarageData(gRes);
      setFavorites(fRes || []);
      setVehicles(vRes.items || []);
      setTestDrives(tdRes || []);
      setConsents(meRes.consents || {});

      if (vRes.items?.[0]) {
        setBookingVehicleId(vRes.items[0].id);
        const nextDay = new Date();
        nextDay.setDate(nextDay.getDate() + 2);
        nextDay.setHours(11, 0, 0, 0);
        setBookingTime(nextDay.toISOString().slice(0, 16));
      }
    } catch (e) {
      console.error('Failed to load customer portal:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCustomerData();
  }, [viewMode]);

  async function handleToggleFavorite(vehicleId) {
    try {
      await api.post(`/portal/favorites/${vehicleId}`);
      loadCustomerData();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleBookTestDrive(e) {
    e.preventDefault();
    try {
      await api.post('/portal/test-drives', {
        vehicle_id: Number(bookingVehicleId),
        scheduled_at: new Date(bookingTime).toISOString(),
        message: bookingMessage,
      });
      alert('Test drive requested! A sales advisor will confirm your slot shortly.');
      loadCustomerData();
    } catch (err) {
      alert(`Booking error: ${err.message}`);
    }
  }

  async function handleCancelDrive(driveId) {
    try {
      await api.post(`/portal/test-drives/${driveId}/cancel`);
      loadCustomerData();
      alert('Test drive cancelled.');
    } catch (err) {
      alert(`Cancel error: ${err.message}`);
    }
  }

  async function handleToggleConsent(channel, currentVal) {
    try {
      const updated = await api.post('/portal/consents', {
        channel,
        granted: !currentVal,
      });
      setConsents(updated);
    } catch (err) {
      alert(`Consent error: ${err.message}`);
    }
  }

  async function handleDownloadExport() {
    try {
      const data = await api.get('/portal/privacy/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `meridian-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export error: ${err.message}`);
    }
  }

  async function handleRequestErasure() {
    const reason = prompt('Please specify a reason for data erasure (optional):', 'No longer using service');
    if (reason !== null) {
      try {
        const res = await api.post('/portal/privacy/erasure', { reason });
        alert(res.message || 'Erasure request submitted to compliance team.');
      } catch (err) {
        alert(`Erasure request error: ${err.message}`);
      }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Banner */}
      <div style={{
        padding: '24px',
        background: 'linear-gradient(135deg, rgba(242, 107, 58, 0.15), rgba(15, 19, 28, 0.9))',
        border: '1px solid rgba(242, 107, 58, 0.3)',
        borderRadius: 'var(--radius-xl)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-primary)', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>
            <Car size={16} />
            <span>Meridian Customer Portal</span>
          </div>
          <h1 style={{ fontSize: '26px', fontWeight: 800, marginTop: '4px' }}>
            Welcome back, {user?.full_name || 'Valued Guest'}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '4px' }}>
            Manage your garage, track workshop service orders, and schedule VIP test drives.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className={`btn ${viewMode === 'portal_garage' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onNavigate('portal_garage')}
          >
            My Garage
          </button>
          <button
            className={`btn ${viewMode === 'portal_showroom' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onNavigate('portal_showroom')}
          >
            Browse Cars
          </button>
          <button
            className={`btn ${viewMode === 'portal_booking' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onNavigate('portal_booking')}
          >
            Book Drive
          </button>
          <button
            className={`btn ${viewMode === 'portal_privacy' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onNavigate('portal_privacy')}
          >
            Privacy
          </button>
        </div>
      </div>

      {/* View Mode 1: Garage & Active Service Tracker */}
      {viewMode === 'portal_garage' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Active Service Repair Order Live Tracker */}
          <div className="glass-panel" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Wrench size={20} color="var(--accent-primary)" />
                <h2 style={{ fontSize: '18px', fontWeight: 800 }}>Live Service & Workshop Status</h2>
              </div>
              <span className="badge badge-normal">Live Telemetry</span>
            </div>

            {garageData?.service_jobs?.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '16px 0', textAlign: 'center' }}>
                No active repair orders in progress. Your vehicles are all up to date!
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {garageData?.service_jobs?.map((job) => (
                  <div
                    key={job.id}
                    style={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      padding: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <span className={`badge badge-${job.status === 'ready' ? 'new' : job.status === 'closed' ? 'sold' : 'certified'}`}>
                          {job.status?.toUpperCase()?.replace('_', ' ')}
                        </span>
                        <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginTop: '6px' }}>
                          RO #{job.ro_number} &bull; {job.vehicle_title}
                        </h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: '2px' }}>
                          Work: {job.complaint}
                        </p>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--accent-primary)' }}>
                          {formatCurrency(job.total)}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Est. Completion: {formatDate(job.promised_at || job.scheduled_at)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Owned Vehicles List */}
          <div className="glass-panel" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '16px' }}>
              My Registered Vehicles ({garageData?.vehicles?.length || 0})
            </h2>

            {garageData?.vehicles?.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '16px 0', textAlign: 'center' }}>
                You have no purchased vehicles registered yet.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                {garageData?.vehicles?.map((v) => (
                  <div
                    key={v.id}
                    style={{
                      background: 'var(--bg-secondary)',
                      borderRadius: 'var(--radius-md)',
                      overflow: 'hidden',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ height: '160px', background: '#000' }}>
                      <img
                        src={v.photo || '/media/stock/sedan.jpg'}
                        alt={v.model}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    </div>
                    <div style={{ padding: '16px' }}>
                      <h4 style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>
                        {v.year} {v.make} {v.model} {v.trim}
                      </h4>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        VIN: {v.vin} &bull; Delivered: {formatDate(v.delivered_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* View Mode 2: Public Showroom */}
      {viewMode === 'portal_showroom' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="glass-panel" style={{ padding: '20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
              {vehicles.map((v) => {
                const isFav = favorites.some((f) => f.id === v.id);
                return (
                  <div
                    key={v.id}
                    className="glass-panel"
                    style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}
                  >
                    <div style={{ height: '170px', position: 'relative', background: '#000' }}>
                      <img
                        src={v.photo || '/media/stock/sedan.jpg'}
                        alt={v.model}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      <button
                        onClick={() => handleToggleFavorite(v.id)}
                        style={{
                          position: 'absolute',
                          top: '10px',
                          right: '10px',
                          background: 'rgba(0,0,0,0.6)',
                          borderRadius: '50%',
                          width: '32px',
                          height: '32px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <Heart size={16} color={isFav ? '#f43f5e' : '#fff'} fill={isFav ? '#f43f5e' : 'none'} />
                      </button>
                    </div>

                    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
                      <div>
                        <span className={`badge badge-${v.condition}`}>{v.condition}</span>
                        <h3 style={{ fontSize: '15px', fontWeight: 700, marginTop: '6px', color: '#fff' }}>
                          {v.year} {v.make} {v.model} {v.trim}
                        </h3>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          {formatMiles(v.mileage)} &bull; {v.transmission} &bull; {v.fuel_type}
                        </div>
                      </div>

                      <div style={{ marginTop: '16px', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '18px', fontWeight: 800, color: 'var(--accent-primary)' }}>
                          {formatCurrency(v.price)}
                        </span>

                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 10px', fontSize: '11px' }}
                          onClick={() => {
                            setBookingVehicleId(v.id);
                            onNavigate('portal_booking');
                          }}
                        >
                          Book Drive
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* View Mode 3: Book Test Drive Online */}
      {viewMode === 'portal_booking' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
          {/* Booking Form */}
          <div className="glass-panel" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '16px' }}>Reserve Your Drive Online</h2>
            
            <form onSubmit={handleBookTestDrive} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Choose Vehicle</label>
                <select
                  required
                  className="input-field"
                  value={bookingVehicleId}
                  onChange={(e) => setBookingVehicleId(e.target.value)}
                >
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.year} {v.make} {v.model} {v.trim} ({formatCurrency(v.price)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Preferred Date & Slot</label>
                <input
                  type="datetime-local"
                  required
                  className="input-field"
                  value={bookingTime}
                  onChange={(e) => setBookingTime(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Note / Questions for your Specialist</label>
                <textarea
                  rows={3}
                  className="input-field"
                  value={bookingMessage}
                  onChange={(e) => setBookingMessage(e.target.value)}
                />
              </div>

              <button id="submit-portal-booking-btn" type="submit" className="btn btn-primary" style={{ marginTop: '10px' }}>
                Confirm Reservation Request
              </button>
            </form>
          </div>

          {/* Active Test Drive Bookings */}
          <div className="glass-panel" style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '16px' }}>My Appointments</h2>
            {testDrives.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                No active test drive appointments.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {testDrives.map((td) => (
                  <div
                    key={td.id}
                    style={{
                      background: 'var(--bg-secondary)',
                      padding: '14px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <span className={`badge badge-${td.status === 'confirmed' ? 'new' : 'normal'}`}>{td.status}</span>
                      <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#fff', marginTop: '4px' }}>{td.vehicle_title}</h4>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Time: {formatDateTime(td.scheduled_at)} &bull; Advisor: {td.rep_name || 'Assigned on arrival'}
                      </div>
                    </div>

                    {td.status !== 'cancelled' && (
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '4px 8px', fontSize: '11px', color: '#fb7185' }}
                        onClick={() => handleCancelDrive(td.id)}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* View Mode 4: Saved Favorites */}
      {viewMode === 'portal_favorites' && (
        <div className="glass-panel" style={{ padding: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '16px' }}>
            My Saved Vehicles ({favorites.length})
          </h2>

          {favorites.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '24px 0' }}>
              You haven't saved any vehicles yet. Explore the showroom to add your favorites!
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
              {favorites.map((v) => (
                <div key={v.id} style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ height: '160px', background: '#000' }}>
                    <img src={v.photo || '/media/stock/sedan.jpg'} alt={v.model} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  <div style={{ padding: '14px' }}>
                    <h4 style={{ fontWeight: 700, color: '#fff' }}>{v.year} {v.make} {v.model}</h4>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--accent-primary)', marginTop: '6px' }}>
                      {formatCurrency(v.price)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* View Mode 5: Privacy & GDPR Rights */}
      {viewMode === 'portal_privacy' && (
        <div className="glass-panel" style={{ padding: '24px', maxWidth: '720px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Shield size={22} color="var(--accent-primary)" />
            <h2 style={{ fontSize: '18px', fontWeight: 800 }}>Privacy & Data Sovereignty Center</h2>
          </div>

          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '20px' }}>
            Meridian Motors enforces zero-leak GDPR compliance. You have sovereign control over communication channels, data portability, and the right to erasure.
          </p>

          <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#fff', marginBottom: '10px' }}>
            Channel Permissions & Consents
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
            {['email', 'whatsapp', 'marketing'].map((ch) => {
              const isGranted = consents[ch]?.granted;
              return (
                <div
                  key={ch}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    background: 'var(--bg-secondary)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: '#fff', textTransform: 'capitalize' }}>
                      {ch === 'marketing' ? 'Promotions & Seasonal Inventory Drops' : `${ch.toUpperCase()} Transactional Messages`}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Status: {isGranted ? 'Active Consent on File' : 'Withdrawn / Blocked'}
                    </div>
                  </div>

                  <button
                    className={`btn ${isGranted ? 'btn-secondary' : 'btn-primary'}`}
                    style={{ fontSize: '11px', padding: '4px 12px' }}
                    onClick={() => handleToggleConsent(ch, isGranted)}
                  >
                    {isGranted ? 'Revoke Consent' : 'Grant Consent'}
                  </button>
                </div>
              );
            })}
          </div>

          <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#fff', marginBottom: '10px' }}>
            GDPR Art. 17 & 20 Rights
          </h3>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={handleDownloadExport}>
              <Download size={14} />
              <span>Download My Data (GDPR Art. 20 Export)</span>
            </button>

            <button className="btn btn-danger" onClick={handleRequestErasure}>
              <Trash2 size={14} />
              <span>Request Right to Erasure (Art. 17)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
