-- The action log table. The app does not create it: in production it is
-- created by hand, in local development by the db service of compose.yaml
-- on its first start.
CREATE TABLE IF NOT EXISTS action_log (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_uid TEXT,
  action TEXT NOT NULL,
  tab_id TEXT,
  course_id TEXT,
  exercise_id TEXT,
  target_user_id TEXT,
  target_answer_id TEXT,
  details JSONB,
  ok BOOLEAN NOT NULL,
  error TEXT
);
