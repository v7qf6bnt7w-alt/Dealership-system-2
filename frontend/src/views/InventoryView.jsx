import React, { useState, useEffect } from 'react';
import { api, formatCurrency, formatMiles } from '../api';
import { useAuth } from '../context/AuthContext';
import { 
  Search, Plus, Filter, Car, Tag, Sparkles, Check, 
  Eye, RefreshCw, X, Shield, Calendar, Fuel, Gauge
} from 'lucide-react';

export default function InventoryView({ onNavigate }) {
  const { isStaff, user } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [facets, setFacets] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filters
  const [q, setQ] = useState('');
  const [condition, setCondition] = useState('');
  const [status, setStatus] = useState('');
  const [bodyStyle, setBodyStyle] = useState('');
  const [sort, setSort] = useState('newest');

  // Modals
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [showDecodeModal, setShowDecodeModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // VIN Decoder state
  const [vinInput, setVinInput] = useState('1HGCM82633A004352');
  const [decoding, setDecoding] = useState(false);
  const [decodedData, setDecodedData] = useState(null);
  const [decodeError, setDecodeError] = useState(null);

  // Add vehicle form state
  const [newVehicle, setNewVehicle] = useState({
    vin: '',
    condition: 'used',
    status: 'in_stock',
    year: 2023,
    make: '',
    model: '',
    trim: '',
    body_style: 'sedan',
    transmission: 'automatic',
    fuel_type: 'gasoline',
    drivetrain: 'awd',
    price: 3200000,
    cost: 2800000,
    mileage: 18500,
    exterior_color: 'Graphite Grey',
    interior_color: 'Black Leather',
    features: ['Apple CarPlay', 'Heated Seats', 'Backup Camera'],
  });

  async function loadInventory() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (q) params.append('q', q);
      if (condition) params.append('condition', condition);
      if (status) params.append('status', status);
      if (bodyStyle) params.append('body_style', bodyStyle);
      if (sort) params.append('sort', sort);
      params.append('limit', '40');

      const res = await api.get(`/inventory?${params.toString()}`);
      setVehicles(res.items || []);
      setTotal(res.total || 0);

      if (!facets) {
        const f = await api.get('/inventory/facets');
        setFacets(f);
      }
    } catch (e) {
      console.error('Failed to load inventory:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInventory();
  }, [q, condition, status, bodyStyle, sort]);

  async function handleDecodeVin() {
    if (!vinInput || vinInput.length !== 17) {
      setDecodeError('VIN must be exactly 17 characters');
      return;
    }
    try {
      setDecoding(true);
      setDecodeError(null);
      const res = await api.post('/inventory/vin/decode', { vin: vinInput });
      setDecodedData(res);
      // Pre-fill add vehicle form
      if (res.suggested) {
        setNewVehicle((prev) => ({
          ...prev,
          vin: res.vin,
          make: res.suggested.make || prev.make,
          model: res.suggested.model || prev.model,
          trim: res.suggested.trim || prev.trim,
          year: res.suggested.year || prev.year,
          body_style: res.suggested.body_style || prev.body_style,
          transmission: res.suggested.transmission || prev.transmission,
          fuel_type: res.suggested.fuel_type || prev.fuel_type,
          drivetrain: res.suggested.drivetrain || prev.drivetrain,
          features: res.suggested.features || prev.features,
        }));
      }
    } catch (e) {
      setDecodeError(e.message || 'VIN decode failed');
    } finally {
      setDecoding(false);
    }
  }

  async function handleCreateVehicle(e) {
    e.preventDefault();
    try {
      await api.post('/inventory', newVehicle);
      setShowAddModal(false);
      setShowDecodeModal(false);
      loadInventory();
      alert('Vehicle successfully registered in inventory!');
    } catch (err) {
      alert(`Error creating vehicle: ${err.message}`);
    }
  }

  async function handlePatchVehicle(id, changes) {
    try {
      const updated = await api.patch(`/inventory/${id}`, changes);
      setSelectedVehicle(updated);
      loadInventory();
    } catch (err) {
      alert(`Failed to update vehicle: ${err.message}`);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800 }}>Showroom & Vehicle Inventory</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            {total} vehicles currently listed &bull; Sub-millisecond indexed SQL search
          </p>
        </div>

        {isStaff && (
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              id="btn-vin-decoder"
              className="btn btn-secondary"
              onClick={() => {
                setShowDecodeModal(true);
                setDecodedData(null);
                setDecodeError(null);
              }}
            >
              <Sparkles size={15} color="var(--accent-primary)" />
              <span>NHTSA VIN Decoder</span>
            </button>

            <button
              id="btn-add-vehicle"
              className="btn btn-primary"
              onClick={() => setShowAddModal(true)}
            >
              <Plus size={16} />
              <span>Add Vehicle</span>
            </button>
          </div>
        )}
      </div>

      {/* Filter / Search Bar */}
      <div className="glass-panel" style={{ padding: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Search input */}
        <div style={{ position: 'relative', flex: '1', minWidth: '220px' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            id="inventory-search-input"
            type="text"
            className="input-field"
            placeholder="Search make, model, trim, stock# or VIN..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ paddingLeft: '36px' }}
          />
        </div>

        {/* Condition Filter */}
        <select
          id="inventory-filter-condition"
          className="input-field"
          style={{ width: 'auto', minWidth: '130px' }}
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
        >
          <option value="">All Conditions</option>
          <option value="new">Brand New</option>
          <option value="used">Pre-Owned</option>
          <option value="certified">Certified CPO</option>
        </select>

        {/* Status Filter */}
        <select
          id="inventory-filter-status"
          className="input-field"
          style={{ width: 'auto', minWidth: '130px' }}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="in_stock">In Stock</option>
          <option value="reserved">Reserved</option>
          <option value="in_service">In Service</option>
          <option value="incoming">Incoming</option>
          {isStaff && <option value="sold">Sold History</option>}
        </select>

        {/* Body Style Filter */}
        <select
          id="inventory-filter-body"
          className="input-field"
          style={{ width: 'auto', minWidth: '130px' }}
          value={bodyStyle}
          onChange={(e) => setBodyStyle(e.target.value)}
        >
          <option value="">All Body Styles</option>
          <option value="suv">SUV / Crossover</option>
          <option value="sedan">Sedan</option>
          <option value="pickup">Pickup Truck</option>
          <option value="coupe">Coupe / Sport</option>
          <option value="hatchback">Hatchback</option>
          <option value="convertible">Convertible</option>
          <option value="van">Minivan</option>
        </select>

        {/* Sort */}
        <select
          id="inventory-filter-sort"
          className="input-field"
          style={{ width: 'auto', minWidth: '140px' }}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="newest">Recently Acquired</option>
          <option value="price_asc">Price: Low to High</option>
          <option value="price_desc">Price: High to Low</option>
          <option value="year_desc">Year: Newest First</option>
          <option value="mileage_asc">Lowest Mileage</option>
          <option value="aging">Lot Aging (Oldest)</option>
        </select>
      </div>

      {/* Vehicles Grid */}
      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading vehicles...
        </div>
      ) : vehicles.length === 0 ? (
        <div className="glass-panel" style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <Car size={36} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
          <div style={{ fontSize: '16px', fontWeight: 600 }}>No vehicles match your search criteria.</div>
          <button className="btn btn-secondary" style={{ marginTop: '12px' }} onClick={() => { setQ(''); setCondition(''); setStatus(''); setBodyStyle(''); }}>
            Reset Filters
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '20px' }}>
          {vehicles.map((v) => (
            <div
              key={v.id}
              className="glass-panel"
              style={{
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                transition: 'transform var(--transition-fast), box-shadow var(--transition-fast)',
                cursor: 'pointer',
              }}
              onClick={async () => {
                const full = await api.get(`/inventory/${v.id}`);
                setSelectedVehicle(full);
              }}
            >
              {/* Image banner */}
              <div style={{ height: '175px', position: 'relative', background: '#0a0d14' }}>
                <img
                  src={v.photo || '/media/stock/sedan.jpg'}
                  alt={`${v.year} ${v.make} ${v.model}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(e) => { e.target.src = '/media/stock/sedan.jpg'; }}
                />
                <div style={{ position: 'absolute', top: '10px', left: '10px', display: 'flex', gap: '6px' }}>
                  <span className={`badge badge-${v.condition}`}>{v.condition}</span>
                  <span className={`badge badge-${v.status}`}>{v.status?.replace('_', ' ')}</span>
                </div>
                {v.days_in_stock !== null && (
                  <div style={{
                    position: 'absolute',
                    bottom: '8px',
                    right: '8px',
                    background: 'rgba(0,0,0,0.75)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    color: v.days_in_stock > 60 ? '#f43f5e' : '#cbd5e1',
                  }}>
                    {v.days_in_stock}d on lot
                  </div>
                )}
              </div>

              {/* Body Content */}
              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Stock #{v.stock_number} &bull; {v.body_style}
                  </div>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, marginTop: '2px', color: '#fff' }}>
                    {v.year} {v.make} {v.model} {v.trim}
                  </h3>

                  <div style={{ display: 'flex', gap: '12px', color: 'var(--text-secondary)', fontSize: '12px', marginTop: '8px' }}>
                    <span>{formatMiles(v.mileage)}</span>
                    <span>&bull;</span>
                    <span style={{ textTransform: 'capitalize' }}>{v.fuel_type?.replace('_', ' ')}</span>
                    <span>&bull;</span>
                    <span>{v.drivetrain?.toUpperCase()}</span>
                  </div>
                </div>

                <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontSize: '20px', fontWeight: 800, color: 'var(--accent-primary)' }}>
                      {formatCurrency(v.price)}
                    </span>
                    {v.msrp && v.condition === 'new' && (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', textDecoration: 'line-through', marginLeft: '6px' }}>
                        {formatCurrency(v.msrp)}
                      </span>
                    )}
                  </div>

                  {isStaff && v.cost && (
                    <div style={{ fontSize: '11px', color: '#34d399', textAlign: 'right' }}>
                      Margin: {formatCurrency(v.price - v.cost)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Vehicle Detail Slideover / Modal */}
      {selectedVehicle && (
        <div className="modal-backdrop" onClick={() => setSelectedVehicle(null)}>
          <div className="modal-content" style={{ maxWidth: '820px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ position: 'relative', height: '260px', background: '#000' }}>
              <img
                src={selectedVehicle.photos?.[0]?.url || selectedVehicle.photo || '/media/stock/sedan.jpg'}
                alt={selectedVehicle.model}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <button
                onClick={() => setSelectedVehicle(null)}
                style={{
                  position: 'absolute',
                  top: '16px',
                  right: '16px',
                  background: 'rgba(0,0,0,0.7)',
                  borderRadius: '50%',
                  width: '36px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                    <span className={`badge badge-${selectedVehicle.condition}`}>{selectedVehicle.condition}</span>
                    <span className={`badge badge-${selectedVehicle.status}`}>{selectedVehicle.status}</span>
                    {selectedVehicle.condition_grade && (
                      <span className="badge badge-normal">Grade {selectedVehicle.condition_grade}</span>
                    )}
                  </div>
                  <h2 style={{ fontSize: '22px', fontWeight: 800 }}>
                    {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model} {selectedVehicle.trim}
                  </h2>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    VIN: <strong>{selectedVehicle.vin}</strong> &bull; Stock: <strong>{selectedVehicle.stock_number}</strong>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '26px', fontWeight: 800, color: 'var(--accent-primary)' }}>
                    {formatCurrency(selectedVehicle.price)}
                  </div>
                  {isStaff && selectedVehicle.cost && (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      Acquisition Cost: {formatCurrency(selectedVehicle.cost)}
                    </div>
                  )}
                </div>
              </div>

              {/* Description */}
              {selectedVehicle.description && (
                <p style={{ marginTop: '16px', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '1.6' }}>
                  {selectedVehicle.description}
                </p>
              )}

              {/* Specs Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginTop: '20px' }}>
                <div style={{ background: 'var(--bg-secondary)', padding: '10px 14px', borderRadius: 'var(--radius-md)' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Mileage</span>
                  <div style={{ fontWeight: 700, marginTop: '2px' }}>{formatMiles(selectedVehicle.mileage)}</div>
                </div>
                <div style={{ background: 'var(--bg-secondary)', padding: '10px 14px', borderRadius: 'var(--radius-md)' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Engine</span>
                  <div style={{ fontWeight: 700, marginTop: '2px' }}>{selectedVehicle.engine || '—'}</div>
                </div>
                <div style={{ background: 'var(--bg-secondary)', padding: '10px 14px', borderRadius: 'var(--radius-md)' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Horsepower</span>
                  <div style={{ fontWeight: 700, marginTop: '2px' }}>{selectedVehicle.horsepower ? `${selectedVehicle.horsepower} hp` : '—'}</div>
                </div>
                <div style={{ background: 'var(--bg-secondary)', padding: '10px 14px', borderRadius: 'var(--radius-md)' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Transmission</span>
                  <div style={{ fontWeight: 700, marginTop: '2px', textTransform: 'capitalize' }}>{selectedVehicle.transmission}</div>
                </div>
              </div>

              {/* Features list */}
              {selectedVehicle.features && selectedVehicle.features.length > 0 && (
                <div style={{ marginTop: '20px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>
                    Factory Options & Features
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {selectedVehicle.features.map((f, i) => (
                      <span key={i} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: '12px' }}>
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Staff Management Actions */}
              {isStaff && (
                <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {selectedVehicle.status !== 'sold' && (
                    <>
                      <button
                        className="btn btn-secondary"
                        onClick={() => handlePatchVehicle(selectedVehicle.id, {
                          status: selectedVehicle.status === 'reserved' ? 'in_stock' : 'reserved',
                        })}
                      >
                        {selectedVehicle.status === 'reserved' ? 'Unreserve (Set In Stock)' : 'Mark as Reserved'}
                      </button>

                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          const newPrice = prompt('Enter new advertised price in USD:', (selectedVehicle.price / 100).toFixed(0));
                          if (newPrice) {
                            handlePatchVehicle(selectedVehicle.id, { price: Math.round(Number(newPrice) * 100) });
                          }
                        }}
                      >
                        Adjust Price
                      </button>
                    </>
                  )}
                  
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setSelectedVehicle(null);
                      onNavigate('deals');
                    }}
                  >
                    Open Deal Desk for this Unit
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIN Decoder Modal */}
      {showDecodeModal && (
        <div className="modal-backdrop" onClick={() => setShowDecodeModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={20} color="var(--accent-primary)" />
                <h2 style={{ fontSize: '18px', fontWeight: 800 }}>NHTSA & ISO-3779 VIN Decoder</h2>
              </div>
              <button onClick={() => setShowDecodeModal(false)}><X size={18} /></button>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '16px' }}>
              Instantly decode 17-digit VINs via US DOT vPIC API with automatic ISO check digit verification.
            </p>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input
                id="vin-input-field"
                type="text"
                className="input-field"
                placeholder="Enter 17-character VIN..."
                value={vinInput}
                onChange={(e) => setVinInput(e.target.value.toUpperCase())}
                maxLength={17}
                style={{ fontFamily: 'monospace', letterSpacing: '0.08em', fontSize: '15px' }}
              />
              <button
                id="vin-decode-submit-btn"
                className="btn btn-primary"
                onClick={handleDecodeVin}
                disabled={decoding}
              >
                {decoding ? 'Decoding...' : 'Decode'}
              </button>
            </div>

            {/* Quick Demo VINs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
              <span>Try:</span>
              <button
                onClick={() => setVinInput('1HGCM82633A004352')}
                style={{ color: 'var(--accent-primary)', textDecoration: 'underline' }}
              >
                Honda Accord
              </button>
              <span>&bull;</span>
              <button
                onClick={() => setVinInput('1FTFW1ED4KFB12345')}
                style={{ color: 'var(--accent-primary)', textDecoration: 'underline' }}
              >
                Ford F-150
              </button>
            </div>

            {decodeError && (
              <div style={{ padding: '12px', background: 'rgba(244, 63, 94, 0.15)', border: '1px solid rgba(244, 63, 94, 0.3)', borderRadius: 'var(--radius-md)', color: '#fb7185', fontSize: '13px', marginBottom: '16px' }}>
                {decodeError}
              </div>
            )}

            {decodedData && (
              <div style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontWeight: 700, color: '#fff', fontSize: '15px' }}>
                    {decodedData.suggested?.year} {decodedData.suggested?.make} {decodedData.suggested?.model} {decodedData.suggested?.trim}
                  </span>
                  <span className={`badge ${decodedData.check_digit_valid ? 'badge-new' : 'badge-high'}`}>
                    Check Digit: {decodedData.check_digit_valid ? 'VALID' : 'INVALID'}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  <div>Body: <strong style={{ color: '#fff' }}>{decodedData.suggested?.body_style}</strong></div>
                  <div>Fuel: <strong style={{ color: '#fff' }}>{decodedData.suggested?.fuel_type}</strong></div>
                  <div>Transmission: <strong style={{ color: '#fff' }}>{decodedData.suggested?.transmission}</strong></div>
                  <div>Drivetrain: <strong style={{ color: '#fff' }}>{decodedData.suggested?.drivetrain}</strong></div>
                  <div>Engine: <strong style={{ color: '#fff' }}>{decodedData.suggested?.engine || '—'}</strong></div>
                  <div>Horsepower: <strong style={{ color: '#fff' }}>{decodedData.suggested?.horsepower ? `${decodedData.suggested?.horsepower} HP` : '—'}</strong></div>
                </div>

                <button
                  id="vin-populate-add-btn"
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: '16px' }}
                  onClick={() => {
                    setShowDecodeModal(false);
                    setShowAddModal(true);
                  }}
                >
                  Populate & Add into Inventory
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Vehicle Modal */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 800 }}>Register New Vehicle in Inventory</h2>
              <button onClick={() => setShowAddModal(false)}><X size={18} /></button>
            </div>

            <form onSubmit={handleCreateVehicle} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>VIN (17 chars)*</label>
                  <input
                    type="text"
                    required
                    maxLength={17}
                    minLength={17}
                    className="input-field"
                    value={newVehicle.vin}
                    onChange={(e) => setNewVehicle({ ...newVehicle, vin: e.target.value.toUpperCase() })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Condition*</label>
                  <select
                    className="input-field"
                    value={newVehicle.condition}
                    onChange={(e) => setNewVehicle({ ...newVehicle, condition: e.target.value })}
                  >
                    <option value="new">New</option>
                    <option value="used">Used</option>
                    <option value="certified">Certified CPO</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Year*</label>
                  <input
                    type="number"
                    required
                    className="input-field"
                    value={newVehicle.year}
                    onChange={(e) => setNewVehicle({ ...newVehicle, year: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Make*</label>
                  <input
                    type="text"
                    required
                    className="input-field"
                    value={newVehicle.make}
                    onChange={(e) => setNewVehicle({ ...newVehicle, make: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Model*</label>
                  <input
                    type="text"
                    required
                    className="input-field"
                    value={newVehicle.model}
                    onChange={(e) => setNewVehicle({ ...newVehicle, model: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Trim</label>
                  <input
                    type="text"
                    className="input-field"
                    value={newVehicle.trim}
                    onChange={(e) => setNewVehicle({ ...newVehicle, trim: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Body Style</label>
                  <select
                    className="input-field"
                    value={newVehicle.body_style}
                    onChange={(e) => setNewVehicle({ ...newVehicle, body_style: e.target.value })}
                  >
                    <option value="sedan">Sedan</option>
                    <option value="suv">SUV</option>
                    <option value="pickup">Pickup</option>
                    <option value="coupe">Coupe</option>
                    <option value="hatchback">Hatchback</option>
                    <option value="van">Van</option>
                    <option value="convertible">Convertible</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Mileage (mi)</label>
                  <input
                    type="number"
                    className="input-field"
                    value={newVehicle.mileage}
                    onChange={(e) => setNewVehicle({ ...newVehicle, mileage: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Advertised Price ($ USD)*</label>
                  <input
                    type="number"
                    required
                    className="input-field"
                    value={newVehicle.price / 100}
                    onChange={(e) => setNewVehicle({ ...newVehicle, price: Number(e.target.value) * 100 })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Acquisition Cost ($ USD)*</label>
                  <input
                    type="number"
                    required
                    className="input-field"
                    value={newVehicle.cost / 100}
                    onChange={(e) => setNewVehicle({ ...newVehicle, cost: Number(e.target.value) * 100 })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button id="submit-add-vehicle-btn" type="submit" className="btn btn-primary">
                  Save Vehicle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
