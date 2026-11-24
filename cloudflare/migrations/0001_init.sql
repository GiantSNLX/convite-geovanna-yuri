CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  message TEXT NOT NULL CHECK(length(message) BETWEEN 3 AND 600),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','archived')),
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rsvps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  age INTEGER CHECK(age IS NULL OR (typeof(age) = 'integer' AND age BETWEEN 0 AND 120)),
  response TEXT NOT NULL CHECK(response IN ('yes','no')),
  companions INTEGER NOT NULL CHECK(typeof(companions) = 'integer' AND companions BETWEEN 0 AND 20),
  guests_json TEXT NOT NULL DEFAULT '[]',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  invite_token TEXT NOT NULL DEFAULT '',
  absence_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  family_name TEXT NOT NULL CHECK(length(family_name) BETWEEN 1 AND 120),
  max_guests INTEGER NOT NULL CHECK(typeof(max_guests) = 'integer' AND max_guests BETWEEN 1 AND 30),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','yes','no')),
  respondent_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  confirmed_guests_json TEXT NOT NULL DEFAULT '[]',
  confirmed_count INTEGER NOT NULL DEFAULT 0,
  absence_note TEXT NOT NULL DEFAULT '',
  last_request_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invite_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invite_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  respondent_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  confirmed_guests_json TEXT NOT NULL,
  confirmed_count INTEGER NOT NULL,
  absence_note TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'guest',
  created_at TEXT NOT NULL
);
