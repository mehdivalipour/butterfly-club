-- Run this ONLY if you already created the older database schema.
ALTER TABLE applications ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE applications ADD COLUMN reviewed_at TEXT;

UPDATE applications
SET review_status = CASE
  WHEN status = 'accept' THEN 'pending'
  ELSE 'not_applicable'
END;

CREATE INDEX IF NOT EXISTS idx_applications_review_status
ON applications(review_status);
