ALTER TABLE inventory_items ADD COLUMN revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0);

-- NULL revisions deliberately leave historical adjustments ineligible for undo.
ALTER TABLE inventory_adjustments ADD COLUMN inventory_revision BIGINT;
ALTER TABLE inventory_adjustments ADD COLUMN undo_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE inventory_adjustments ADD COLUMN undone_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE inventory_adjustments ADD COLUMN undo_revision BIGINT;
