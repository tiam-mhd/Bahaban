CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL,
  code_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_challenges_phone_created_idx ON otp_challenges(phone_e164, created_at DESC);

CREATE TABLE rate_limits (
  scope text NOT NULL,
  key_hash char(64) NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count >= 0),
  PRIMARY KEY (scope, key_hash)
);

CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE business_memberships (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, user_id)
);
CREATE INDEX business_memberships_user_idx ON business_memberships(user_id, created_at);

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);
CREATE UNIQUE INDEX branches_one_primary_per_business ON branches(business_id) WHERE is_primary;

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  active_branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_expiry_idx ON sessions(user_id, expires_at);

CREATE TABLE branch_settings (
  branch_id uuid NOT NULL,
  business_id uuid NOT NULL,
  margin_rate_bps integer NOT NULL DEFAULT 2000 CHECK (margin_rate_bps BETWEEN 0 AND 9500),
  markup_rate_bps integer NOT NULL DEFAULT 2500 CHECK (markup_rate_bps BETWEEN 0 AND 10000),
  rounding_step bigint NOT NULL DEFAULT 1000 CHECK (rounding_step > 0),
  currency text NOT NULL DEFAULT 'IRR' CHECK (currency = 'IRR'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id),
  FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id) ON DELETE CASCADE
);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  business_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, branch_id, business_id),
  FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id) ON DELETE CASCADE
);
CREATE INDEX suppliers_branch_name_idx ON suppliers(branch_id, name) WHERE archived_at IS NULL;

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  business_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  sku text NOT NULL DEFAULT '',
  barcode text NOT NULL DEFAULT '',
  brand text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT '',
  cost_price_rial bigint CHECK (cost_price_rial IS NULL OR cost_price_rial >= 0),
  sale_price_rial bigint CHECK (sale_price_rial IS NULL OR sale_price_rial >= 0),
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, branch_id, business_id),
  FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id) ON DELETE CASCADE
);
CREATE INDEX products_branch_created_idx ON products(branch_id, created_at DESC);
CREATE INDEX products_branch_sku_idx ON products(branch_id, sku) WHERE sku <> '' AND archived_at IS NULL;
CREATE INDEX products_branch_barcode_idx ON products(branch_id, barcode) WHERE barcode <> '' AND archived_at IS NULL;
CREATE INDEX products_branch_name_idx ON products(branch_id, name) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX products_branch_unique_sku ON products(branch_id, sku) WHERE sku <> '' AND archived_at IS NULL;
CREATE UNIQUE INDEX products_branch_unique_barcode ON products(branch_id, barcode) WHERE barcode <> '' AND archived_at IS NULL;

CREATE TABLE price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  business_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  source_file_name text NOT NULL CHECK (length(source_file_name) <= 240),
  source_hash char(64) NOT NULL,
  source_date date NOT NULL,
  currency text NOT NULL DEFAULT 'IRR' CHECK (currency IN ('IRR', 'IRT')),
  status text NOT NULL DEFAULT 'in_review' CHECK (status IN ('in_review', 'approved', 'cancelled', 'error')),
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  approved_at timestamptz,
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, branch_id, business_id),
  UNIQUE (branch_id, source_hash),
  FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id) ON DELETE CASCADE,
  FOREIGN KEY (supplier_id, branch_id, business_id) REFERENCES suppliers(id, branch_id, business_id) ON DELETE RESTRICT
);
CREATE INDEX price_lists_branch_created_idx ON price_lists(branch_id, created_at DESC);

CREATE TABLE price_list_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  business_id uuid NOT NULL,
  source_row integer NOT NULL CHECK (source_row > 0),
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_name text NOT NULL DEFAULT '',
  source_sku text NOT NULL DEFAULT '',
  source_barcode text NOT NULL DEFAULT '',
  source_brand text NOT NULL DEFAULT '',
  source_model text NOT NULL DEFAULT '',
  source_unit text NOT NULL DEFAULT '',
  price_rial bigint CHECK (price_rial IS NULL OR price_rial >= 0),
  previous_price_rial bigint CHECK (previous_price_rial IS NULL OR previous_price_rial >= 0),
  expected_product_version integer,
  matched_product_id uuid,
  match_method text NOT NULL DEFAULT 'none' CHECK (match_method IN ('barcode', 'sku', 'name', 'none', 'manual')),
  confidence integer NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
  warning_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  reviewed boolean NOT NULL DEFAULT false,
  skipped boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, branch_id, business_id),
  UNIQUE (price_list_id, source_row),
  FOREIGN KEY (price_list_id, branch_id, business_id) REFERENCES price_lists(id, branch_id, business_id) ON DELETE CASCADE,
  FOREIGN KEY (matched_product_id, branch_id, business_id) REFERENCES products(id, branch_id, business_id) ON DELETE RESTRICT
);
CREATE INDEX price_list_rows_review_idx ON price_list_rows(price_list_id, reviewed, skipped, source_row);

CREATE TABLE match_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id uuid NOT NULL,
  product_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  business_id uuid NOT NULL,
  confidence integer NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  method text NOT NULL CHECK (method IN ('barcode', 'sku', 'name')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (row_id, product_id),
  FOREIGN KEY (row_id, branch_id, business_id) REFERENCES price_list_rows(id, branch_id, business_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id, branch_id, business_id) REFERENCES products(id, branch_id, business_id) ON DELETE CASCADE
);

CREATE TABLE price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  business_id uuid NOT NULL,
  product_id uuid NOT NULL,
  price_list_id uuid NOT NULL,
  row_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  previous_price_rial bigint,
  new_price_rial bigint NOT NULL CHECK (new_price_rial >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id, branch_id, business_id) REFERENCES products(id, branch_id, business_id) ON DELETE RESTRICT,
  FOREIGN KEY (price_list_id, branch_id, business_id) REFERENCES price_lists(id, branch_id, business_id) ON DELETE RESTRICT,
  FOREIGN KEY (row_id, branch_id, business_id) REFERENCES price_list_rows(id, branch_id, business_id) ON DELETE RESTRICT
);
CREATE INDEX price_history_branch_date_idx ON price_history(branch_id, created_at DESC);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 80),
  entity_type text NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 80),
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id) ON DELETE CASCADE
);
CREATE INDEX audit_events_branch_date_idx ON audit_events(branch_id, created_at DESC);

CREATE TABLE import_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  business_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('products', 'price_list')),
  file_name text NOT NULL CHECK (length(file_name) <= 240),
  file_hash char(64) NOT NULL,
  parsed_rows jsonb NOT NULL,
  headers text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id) ON DELETE CASCADE
);
CREATE INDEX import_drafts_expiry_idx ON import_drafts(expires_at);

CREATE FUNCTION enforce_primary_branch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_business uuid;
  primary_count integer;
BEGIN
  IF TG_TABLE_NAME = 'businesses' THEN
    target_business := COALESCE(NEW.id, OLD.id);
  ELSIF TG_OP = 'DELETE' THEN
    target_business := OLD.business_id;
  ELSE
    target_business := NEW.business_id;
  END IF;

  SELECT count(*) INTO primary_count FROM branches WHERE business_id = target_business AND is_primary;
  IF primary_count <> 1 THEN
    RAISE EXCEPTION 'Each business must have exactly one primary branch';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER businesses_require_primary_branch
AFTER INSERT OR UPDATE ON businesses
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_primary_branch();

CREATE CONSTRAINT TRIGGER branches_require_primary_branch
AFTER INSERT OR UPDATE OR DELETE ON branches
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_primary_branch();

CREATE FUNCTION prevent_primary_branch_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_primary THEN
    RAISE EXCEPTION 'Primary branch cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER branches_block_primary_delete BEFORE DELETE ON branches
FOR EACH ROW EXECUTE FUNCTION prevent_primary_branch_delete();
