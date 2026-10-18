CREATE TABLE product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  business_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  parent_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, branch_id, business_id),
  FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id, branch_id, business_id)
    REFERENCES product_categories(id, branch_id, business_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX product_categories_branch_parent_name_idx
  ON product_categories (branch_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE INDEX product_categories_branch_parent_idx
  ON product_categories (branch_id, parent_id, lower(name));

ALTER TABLE products ADD COLUMN category_id uuid;
ALTER TABLE products ADD CONSTRAINT products_category_scope_fk
  FOREIGN KEY (category_id, branch_id, business_id)
  REFERENCES product_categories(id, branch_id, business_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX products_branch_category_created_idx
  ON products (branch_id, category_id, created_at DESC) WHERE archived_at IS NULL;
