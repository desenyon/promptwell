CREATE SCHEMA IF NOT EXISTS promptwell;

CREATE TABLE IF NOT EXISTS promptwell.profiles (
  user_id text PRIMARY KEY,
  email text NOT NULL,
  onboarding_completed boolean NOT NULL DEFAULT false,
  platforms text[] NOT NULL DEFAULT '{}',
  tools text[] NOT NULL DEFAULT '{}',
  instruction_files text[] NOT NULL DEFAULT '{}',
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promptwell.workspaces (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES promptwell.profiles(user_id) ON DELETE CASCADE,
  name text NOT NULL,
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS promptwell.sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES promptwell.profiles(user_id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES promptwell.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  prompt text NOT NULL,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  research_brief jsonb NOT NULL DEFAULT '{}'::jsonb,
  compiled_prompt text NOT NULL DEFAULT '',
  stage text NOT NULL CHECK (stage IN ('questions', 'result')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS promptwell_sessions_user_updated_idx
  ON promptwell.sessions (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS promptwell_workspaces_user_idx
  ON promptwell.workspaces (user_id, updated_at DESC);
