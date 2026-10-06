CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at TEXT,
  reviewed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('accept','reject')),
  review_status TEXT NOT NULL DEFAULT 'pending',
  score INTEGER NOT NULL,
  ai_reason TEXT,
  answer_1 TEXT NOT NULL,
  answer_2 TEXT NOT NULL,
  answer_3 TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  submission_token TEXT
);

CREATE INDEX IF NOT EXISTS idx_applications_created_at
ON applications(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_applications_status
ON applications(status);

CREATE INDEX IF NOT EXISTS idx_applications_review_status
ON applications(review_status);
