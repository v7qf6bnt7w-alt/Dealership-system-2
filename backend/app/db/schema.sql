-- =============================================================================
--  Meridian DMS — SQLite3 schema
--  Conventions:
--    * INTEGER PRIMARY KEY  -> rowid alias (fastest lookups)
--    * Money stored as INTEGER cents to avoid float drift
--    * Timestamps stored as ISO-8601 UTC TEXT (sortable, index friendly)
--    * Every column used in WHERE / ORDER BY on hot paths has an index
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- Identity & access
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY,
    email           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash   TEXT    NOT NULL,
    full_name       TEXT    NOT NULL,
    phone           TEXT,
    role            TEXT    NOT NULL CHECK (role IN ('admin','sales','service','customer')),
    is_active       INTEGER NOT NULL DEFAULT 1,
    avatar_color    TEXT,
    last_login_at   TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_users_role_active ON users(role, is_active);

-- -----------------------------------------------------------------------------
-- Customers (360° profile root)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,  -- portal account
    first_name      TEXT    NOT NULL,
    last_name       TEXT    NOT NULL,
    email           TEXT    COLLATE NOCASE,
    phone           TEXT,
    whatsapp        TEXT,
    address         TEXT,
    city            TEXT,
    preferred_channel TEXT  NOT NULL DEFAULT 'email' CHECK (preferred_channel IN ('email','whatsapp','phone')),
    owner_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,          -- assigned rep
    lifetime_value  INTEGER NOT NULL DEFAULT 0,
    tags            TEXT    NOT NULL DEFAULT '[]',                            -- JSON array
    notes           TEXT,
    is_anonymized   INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_customers_email     ON customers(email);
CREATE INDEX IF NOT EXISTS ix_customers_phone     ON customers(phone);
CREATE INDEX IF NOT EXISTS ix_customers_owner     ON customers(owner_id);
CREATE INDEX IF NOT EXISTS ix_customers_name      ON customers(last_name, first_name);

-- GDPR: granular, append-only consent ledger (latest row per channel wins)
CREATE TABLE IF NOT EXISTS consents (
    id              INTEGER PRIMARY KEY,
    customer_id     INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    channel         TEXT    NOT NULL CHECK (channel IN ('email','whatsapp','phone','marketing','data_processing')),
    granted         INTEGER NOT NULL,
    source          TEXT    NOT NULL DEFAULT 'staff',     -- portal | staff | import | webhook
    ip_address      TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_consents_customer_channel ON consents(customer_id, channel, created_at DESC);

-- -----------------------------------------------------------------------------
-- Inventory
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
    id              INTEGER PRIMARY KEY,
    vin             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    stock_number    TEXT    NOT NULL UNIQUE,
    condition       TEXT    NOT NULL CHECK (condition IN ('new','used','certified')),
    status          TEXT    NOT NULL DEFAULT 'in_stock'
                    CHECK (status IN ('in_stock','reserved','sold','in_service','incoming')),
    year            INTEGER NOT NULL,
    make            TEXT    NOT NULL,
    model           TEXT    NOT NULL,
    trim            TEXT,
    body_style      TEXT    NOT NULL,       -- sedan | suv | pickup | coupe | hatchback | van | wagon | convertible
    transmission    TEXT    NOT NULL,       -- automatic | manual | cvt | dct
    fuel_type       TEXT    NOT NULL,       -- gasoline | diesel | hybrid | plugin_hybrid | electric
    drivetrain      TEXT,                   -- fwd | rwd | awd | 4wd
    engine          TEXT,
    horsepower      INTEGER,
    doors           INTEGER,
    seats           INTEGER,
    exterior_color  TEXT,
    interior_color  TEXT,
    mileage         INTEGER NOT NULL DEFAULT 0,
    condition_grade TEXT,                   -- A+ .. C (used only)
    price           INTEGER NOT NULL,       -- cents, advertised
    msrp            INTEGER,                -- cents
    cost            INTEGER,                -- cents, acquisition (never exposed to portal)
    features        TEXT    NOT NULL DEFAULT '[]',   -- JSON array
    description     TEXT,
    vin_decoded     TEXT,                   -- JSON blob from decoder
    is_featured     INTEGER NOT NULL DEFAULT 0,
    is_published    INTEGER NOT NULL DEFAULT 1,
    acquired_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    sold_at         TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
-- Hot-path filter indexes (sub-100ms inventory search)
CREATE INDEX IF NOT EXISTS ix_vehicles_status_cond   ON vehicles(status, condition);
CREATE INDEX IF NOT EXISTS ix_vehicles_make_model    ON vehicles(make, model, year);
CREATE INDEX IF NOT EXISTS ix_vehicles_price         ON vehicles(price);
CREATE INDEX IF NOT EXISTS ix_vehicles_year          ON vehicles(year);
CREATE INDEX IF NOT EXISTS ix_vehicles_mileage       ON vehicles(mileage);
CREATE INDEX IF NOT EXISTS ix_vehicles_body          ON vehicles(body_style);
CREATE INDEX IF NOT EXISTS ix_vehicles_fuel_trans    ON vehicles(fuel_type, transmission);
CREATE INDEX IF NOT EXISTS ix_vehicles_published     ON vehicles(is_published, status, price);
CREATE INDEX IF NOT EXISTS ix_vehicles_sold_at       ON vehicles(sold_at) WHERE sold_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS vehicle_photos (
    id              INTEGER PRIMARY KEY,
    vehicle_id      INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    url             TEXT    NOT NULL,
    caption         TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_vehicle_photos_vehicle ON vehicle_photos(vehicle_id, sort_order);

CREATE TABLE IF NOT EXISTS favorites (
    customer_id     INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    vehicle_id      INTEGER NOT NULL REFERENCES vehicles(id)  ON DELETE CASCADE,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    PRIMARY KEY (customer_id, vehicle_id)
) WITHOUT ROWID;

-- Decoder response cache (avoid repeat external API calls)
CREATE TABLE IF NOT EXISTS vin_cache (
    vin             TEXT PRIMARY KEY COLLATE NOCASE,
    provider        TEXT NOT NULL,
    payload         TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
) WITHOUT ROWID;

-- -----------------------------------------------------------------------------
-- CRM: leads, activities, tasks
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
    id              INTEGER PRIMARY KEY,
    customer_id     INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    vehicle_id      INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
    assigned_to     INTEGER REFERENCES users(id)    ON DELETE SET NULL,
    stage           TEXT    NOT NULL DEFAULT 'new'
                    CHECK (stage IN ('new','contacted','qualified','test_drive','negotiation','won','lost')),
    source          TEXT    NOT NULL DEFAULT 'website',
    score           INTEGER NOT NULL DEFAULT 50,          -- 0..100
    budget          INTEGER,                              -- cents
    position        REAL    NOT NULL DEFAULT 0,           -- kanban ordering inside a column
    lost_reason     TEXT,
    notes           TEXT,
    last_activity_at TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_leads_stage_pos     ON leads(stage, position);
CREATE INDEX IF NOT EXISTS ix_leads_assigned      ON leads(assigned_to, stage);
CREATE INDEX IF NOT EXISTS ix_leads_customer      ON leads(customer_id);
CREATE INDEX IF NOT EXISTS ix_leads_last_activity ON leads(last_activity_at);

CREATE TABLE IF NOT EXISTS activities (
    id              INTEGER PRIMARY KEY,
    customer_id     INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    lead_id         INTEGER REFERENCES leads(id)     ON DELETE CASCADE,
    user_id         INTEGER REFERENCES users(id)     ON DELETE SET NULL,
    type            TEXT    NOT NULL,    -- note | call | stage_change | test_drive | deal | service | message | system
    summary         TEXT    NOT NULL,
    meta            TEXT,                -- JSON
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_activities_customer ON activities(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_activities_lead     ON activities(lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
    id              INTEGER PRIMARY KEY,
    title           TEXT    NOT NULL,
    description     TEXT,
    due_at          TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
    priority        TEXT    NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
    lead_id         INTEGER REFERENCES leads(id)     ON DELETE CASCADE,
    customer_id     INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    assigned_to     INTEGER REFERENCES users(id)     ON DELETE SET NULL,
    is_automated    INTEGER NOT NULL DEFAULT 0,
    automation_key  TEXT,                -- idempotency key for rule engine
    completed_at    TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_tasks_assignee_due ON tasks(assigned_to, status, due_at);
CREATE INDEX IF NOT EXISTS ix_tasks_lead         ON tasks(lead_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tasks_automation ON tasks(automation_key) WHERE automation_key IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Sales: test drives & deals
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS test_drives (
    id              INTEGER PRIMARY KEY,
    customer_id     INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    vehicle_id      INTEGER NOT NULL REFERENCES vehicles(id)  ON DELETE CASCADE,
    lead_id         INTEGER REFERENCES leads(id) ON DELETE SET NULL,
    sales_rep_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    scheduled_at    TEXT    NOT NULL,
    duration_min    INTEGER NOT NULL DEFAULT 30,
    status          TEXT    NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested','confirmed','completed','no_show','cancelled')),
    route           TEXT,                -- JSON [[lat,lng],...] logged GPS trace
    distance_km     REAL,
    license_verified INTEGER NOT NULL DEFAULT 0,
    feedback        TEXT,
    reminder_sent   INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_test_drives_schedule ON test_drives(scheduled_at, status);
CREATE INDEX IF NOT EXISTS ix_test_drives_vehicle  ON test_drives(vehicle_id, scheduled_at);
CREATE INDEX IF NOT EXISTS ix_test_drives_customer ON test_drives(customer_id);

CREATE TABLE IF NOT EXISTS deals (
    id              INTEGER PRIMARY KEY,
    deal_number     TEXT    NOT NULL UNIQUE,
    customer_id     INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    vehicle_id      INTEGER NOT NULL REFERENCES vehicles(id)  ON DELETE RESTRICT,
    lead_id         INTEGER REFERENCES leads(id) ON DELETE SET NULL,
    sales_rep_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status          TEXT    NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','quoted','accepted','invoiced','delivered','cancelled')),
    vehicle_price   INTEGER NOT NULL,
    discount        INTEGER NOT NULL DEFAULT 0,
    trade_in_value  INTEGER NOT NULL DEFAULT 0,
    trade_in_payoff INTEGER NOT NULL DEFAULT 0,
    trade_in_desc   TEXT,
    tax_rate        REAL    NOT NULL DEFAULT 0.0825,
    fees            TEXT    NOT NULL DEFAULT '[]',     -- JSON [{label, amount, taxable}]
    accessories     TEXT    NOT NULL DEFAULT '[]',     -- JSON [{label, amount}]
    deposit         INTEGER NOT NULL DEFAULT 0,
    subtotal        INTEGER NOT NULL DEFAULT 0,
    tax_total       INTEGER NOT NULL DEFAULT 0,
    total_otd       INTEGER NOT NULL DEFAULT 0,        -- out-the-door
    gross_profit    INTEGER NOT NULL DEFAULT 0,
    notes           TEXT,
    quoted_at       TEXT,
    invoiced_at     TEXT,
    delivered_at    TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_deals_status_date ON deals(status, delivered_at);
CREATE INDEX IF NOT EXISTS ix_deals_rep         ON deals(sales_rep_id, status);
CREATE INDEX IF NOT EXISTS ix_deals_customer    ON deals(customer_id);
CREATE INDEX IF NOT EXISTS ix_deals_vehicle     ON deals(vehicle_id);

-- -----------------------------------------------------------------------------
-- Service & aftersales
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parts (
    id              INTEGER PRIMARY KEY,
    sku             TEXT    NOT NULL UNIQUE,
    name            TEXT    NOT NULL,
    category        TEXT    NOT NULL,
    qty_on_hand     INTEGER NOT NULL DEFAULT 0,
    qty_reserved    INTEGER NOT NULL DEFAULT 0,
    reorder_level   INTEGER NOT NULL DEFAULT 5,
    unit_cost       INTEGER NOT NULL,
    unit_price      INTEGER NOT NULL,
    bin_location    TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_parts_category ON parts(category);
CREATE INDEX IF NOT EXISTS ix_parts_stock    ON parts(qty_on_hand, reorder_level);

CREATE TABLE IF NOT EXISTS service_jobs (
    id              INTEGER PRIMARY KEY,
    ro_number       TEXT    NOT NULL UNIQUE,
    customer_id     INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    vehicle_id      INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,  -- dealer stock or sold unit
    customer_vehicle TEXT,               -- free text when vehicle isn't in our inventory
    advisor_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    technician      TEXT,
    bay             TEXT,
    status          TEXT    NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','checked_in','in_progress','waiting_parts','quality_check','ready','closed','cancelled')),
    priority        TEXT    NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
    complaint       TEXT    NOT NULL,
    diagnosis       TEXT,
    work_performed  TEXT,
    odometer_in     INTEGER,
    labor_hours     REAL    NOT NULL DEFAULT 0,
    labor_rate      INTEGER NOT NULL DEFAULT 14500,     -- cents/hour
    parts_total     INTEGER NOT NULL DEFAULT 0,
    total           INTEGER NOT NULL DEFAULT 0,
    scheduled_at    TEXT    NOT NULL,
    promised_at     TEXT,
    closed_at       TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_service_status_sched ON service_jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS ix_service_customer     ON service_jobs(customer_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS ix_service_vehicle      ON service_jobs(vehicle_id);

CREATE TABLE IF NOT EXISTS service_job_parts (
    id              INTEGER PRIMARY KEY,
    service_job_id  INTEGER NOT NULL REFERENCES service_jobs(id) ON DELETE CASCADE,
    part_id         INTEGER NOT NULL REFERENCES parts(id) ON DELETE RESTRICT,
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    unit_price      INTEGER NOT NULL,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_sjp_job  ON service_job_parts(service_job_id);
CREATE INDEX IF NOT EXISTS ix_sjp_part ON service_job_parts(part_id);

-- -----------------------------------------------------------------------------
-- Communications (WhatsApp / Email / SMS log)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS communications (
    id              INTEGER PRIMARY KEY,
    customer_id     INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    lead_id         INTEGER REFERENCES leads(id)     ON DELETE SET NULL,
    user_id         INTEGER REFERENCES users(id)     ON DELETE SET NULL,
    channel         TEXT    NOT NULL CHECK (channel IN ('whatsapp','email','sms','call')),
    direction       TEXT    NOT NULL CHECK (direction IN ('outbound','inbound')),
    recipient       TEXT,
    subject         TEXT,
    body            TEXT    NOT NULL,
    template        TEXT,
    status          TEXT    NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','sent','delivered','read','failed','received','simulated','blocked')),
    provider_ref    TEXT,
    error           TEXT,
    is_automated    INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_comms_customer ON communications(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_comms_channel  ON communications(channel, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_comms_provider ON communications(provider_ref);

-- -----------------------------------------------------------------------------
-- Compliance: audit trail + GDPR requests
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action          TEXT    NOT NULL,      -- create | update | delete | login | export | anonymize ...
    entity          TEXT    NOT NULL,
    entity_id       INTEGER,
    details         TEXT,                  -- JSON
    ip_address      TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_entity  ON audit_logs(entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_audit_user    ON audit_logs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gdpr_requests (
    id              INTEGER PRIMARY KEY,
    customer_id     INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    type            TEXT    NOT NULL CHECK (type IN ('export','erasure','rectification')),
    status          TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','rejected')),
    requested_by    TEXT    NOT NULL DEFAULT 'customer',
    notes           TEXT,
    completed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    completed_at    TEXT,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_gdpr_status ON gdpr_requests(status, created_at);
