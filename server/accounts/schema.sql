CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  callsign TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player','owner')),
  must_rotate INTEGER NOT NULL DEFAULT 0 CHECK (must_rotate IN (0,1)),
  suspended INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0,1)),
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp BETWEEN 0 AND 29700),
  credits INTEGER NOT NULL DEFAULT 300 CHECK (credits BETWEEN 0 AND 1000000),
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  matches INTEGER NOT NULL DEFAULT 0,
  loadout TEXT NOT NULL DEFAULT '{}',
  joined INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS one_owner ON accounts(role) WHERE role = 'owner';
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
CREATE TABLE IF NOT EXISTS inventory (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  granted INTEGER NOT NULL,
  PRIMARY KEY (account_id,item)
) STRICT;
CREATE TABLE IF NOT EXISTS match_awards (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  map TEXT NOT NULL,
  won INTEGER NOT NULL,
  kills INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  xp INTEGER NOT NULL,
  credits INTEGER NOT NULL,
  finished INTEGER NOT NULL,
  PRIMARY KEY (account_id,match_id)
) STRICT;
CREATE INDEX IF NOT EXISTS award_history ON match_awards(account_id,finished DESC);
CREATE TABLE IF NOT EXISTS challenge_claims (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  period INTEGER NOT NULL,
  PRIMARY KEY (account_id,challenge,period)
) STRICT;
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  reporter TEXT NOT NULL REFERENCES accounts(id),
  target TEXT NOT NULL REFERENCES accounts(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
  created INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS reports_inbox ON reports(status,created DESC);
CREATE TABLE IF NOT EXISTS live_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS owner_audit (
  id INTEGER PRIMARY KEY,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  created INTEGER NOT NULL
) STRICT;
PRAGMA user_version = 1;
