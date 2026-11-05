ALTER TABLE inventory_items ADD COLUMN account_id BIGINT;
ALTER TABLE shopping_lists ADD COLUMN account_id BIGINT;
ALTER TABLE shopping_list_items ADD COLUMN account_id BIGINT;

-- Existing prototype rows were shared. Keep them available to the first
-- account created, while all new rows are explicitly account-owned.
UPDATE inventory_items SET account_id = (SELECT MIN(id) FROM accounts) WHERE account_id IS NULL;
UPDATE shopping_lists SET account_id = (SELECT MIN(id) FROM accounts) WHERE account_id IS NULL;
UPDATE shopping_list_items SET account_id = (
    SELECT shopping_lists.account_id FROM shopping_lists WHERE shopping_lists.id = shopping_list_items.shopping_list_id
) WHERE account_id IS NULL;

ALTER TABLE inventory_items ADD CONSTRAINT fk_inventory_account FOREIGN KEY (account_id) REFERENCES accounts(id);
ALTER TABLE shopping_lists ADD CONSTRAINT fk_shopping_list_account FOREIGN KEY (account_id) REFERENCES accounts(id);
ALTER TABLE shopping_list_items ADD CONSTRAINT fk_shopping_list_item_account FOREIGN KEY (account_id) REFERENCES accounts(id);

CREATE INDEX idx_inventory_account ON inventory_items(account_id);
CREATE INDEX idx_shopping_lists_account ON shopping_lists(account_id);
CREATE INDEX idx_shopping_list_items_account ON shopping_list_items(account_id);
