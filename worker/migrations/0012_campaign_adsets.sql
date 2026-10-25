-- Advanced Meta settings: CBO/ABO budgets, multiple ad sets, placements mode, Advantage+ creative.

ALTER TABLE campaigns ADD COLUMN budget_type TEXT NOT NULL DEFAULT 'CBO';          -- CBO | ABO
ALTER TABLE campaigns ADD COLUMN ad_sets_json TEXT;                                -- [{name, location_type, targeting_type, interest, budget}]
ALTER TABLE campaigns ADD COLUMN placements_type TEXT NOT NULL DEFAULT 'ADVANTAGE'; -- ADVANTAGE | MANUAL
ALTER TABLE campaigns ADD COLUMN advantage_creative INTEGER NOT NULL DEFAULT 0;     -- 0 unless the user ticked it

-- campaigns saved before this migration chose explicit placements
UPDATE campaigns SET placements_type = 'MANUAL' WHERE placements IS NOT NULL AND placements NOT IN ('', '[]');
