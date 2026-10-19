-- =====================================================================
-- kron-tavern Relational & Vector Schema
-- =====================================================================

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  openrouter_key_encrypted TEXT,
  wiro_key_encrypted TEXT,
  settings_json TEXT DEFAULT '{}',
  is_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Global App Settings (Key-Value Configuration for System Defaults)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Durable User Personas (Always Private to Creator)
CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  description TEXT NOT NULL,
  speech_style TEXT,
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Characters (AI Companions: Private or Public)
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  avatar_prompt TEXT,
  tagline TEXT,
  greeting TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  scenario TEXT,
  dialogue_examples TEXT,
  is_public INTEGER DEFAULT 0,
  default_model TEXT,
  temperature REAL DEFAULT 0.8,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Tier 1: Keyword Memories (Lorebooks / World Info)
-- Scope: 'session' (originating session), 'character' (character-wide), 'user' (all user's chats)
CREATE TABLE IF NOT EXISTS keyword_memories (
  id TEXT PRIMARY KEY,
  character_id TEXT REFERENCES characters(id) ON DELETE CASCADE,
  persona_id TEXT REFERENCES personas(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  keywords TEXT NOT NULL, -- comma-separated trigger words
  content TEXT NOT NULL,
  scope TEXT DEFAULT 'session', -- 'session', 'character', 'persona', 'user'
  priority INTEGER DEFAULT 10,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Roleplay Sessions & Group Chats (Always Private to User)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT REFERENCES characters(id) ON DELETE CASCADE,
  active_persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  is_group INTEGER DEFAULT 0,
  chat_model TEXT,
  text_to_image_model TEXT,
  image_to_image_model TEXT,
  background_image_url TEXT,
  active_compression_id TEXT REFERENCES session_compressions(id) ON DELETE SET NULL,
  context_strategy TEXT DEFAULT 'episodic_sliding', -- 'episodic_sliding', 'rolling_summary', 'selective_pruning', 'fifo'
  context_threshold_percent INTEGER DEFAULT 75,
  rolling_summary TEXT,
  is_ab_mode INTEGER DEFAULT 0,
  ab_model_a TEXT,
  ab_model_b TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Context Compressions (Preserving Full Chat History while Pruning LLM Context)
CREATE TABLE IF NOT EXISTS session_compressions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  boundary_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  summary_text TEXT NOT NULL,
  token_count_before INTEGER,
  token_count_after INTEGER,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Multi-Character Group Participants
CREATE TABLE IF NOT EXISTS session_participants (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Chat Messages (Always Private within Session)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL, -- 'user', 'character', 'system'
  sender_id TEXT, -- character_id or persona_id
  content TEXT NOT NULL,
  is_canonical INTEGER DEFAULT 1, -- in A/B test, false for rejected candidate
  ab_group_id TEXT, -- groups candidate responses together
  reroll_parent_id TEXT, -- links previous candidate/reroll message
  model_used TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Tier 2: Episodic Memories
-- Scope: 'session' (default, exclusive to conversation) or 'user' (promoted to global across user sessions)
CREATE TABLE IF NOT EXISTS episodic_memories (
  id TEXT PRIMARY KEY,
  character_id TEXT REFERENCES characters(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_text TEXT NOT NULL,
  scope TEXT DEFAULT 'session', -- 'session', 'user'
  importance INTEGER DEFAULT 5,
  source_turn_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Auditing & Traceability: The Turn Inspector Traces
CREATE TABLE IF NOT EXISTS turn_traces (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  model_used TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER,
  context_fill_percent REAL,
  raw_request_json TEXT NOT NULL,
  raw_response_json TEXT NOT NULL,
  triggered_keywords_json TEXT DEFAULT '[]',
  recalled_memories_json TEXT DEFAULT '[]',
  compression_event_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Persistent Generated & Reference Images Store (T2I, I2I, Character Avatars)
CREATE TABLE IF NOT EXISTS generated_images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT REFERENCES characters(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'text-to-image',
  prompt TEXT NOT NULL,
  model_used TEXT NOT NULL,
  file_path TEXT NOT NULL,
  image_url TEXT NOT NULL,
  reference_image_url TEXT,
  aspect_ratio TEXT,
  width INTEGER,
  height INTEGER,
  file_size_bytes INTEGER,
  latency_ms INTEGER,
  raw_response_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Virtual Vector Table for Episodic Memory Embeddings (384 dimensions for all-MiniLM-L6-v2)
CREATE VIRTUAL TABLE IF NOT EXISTS vec_episodic_memories USING vec0(
  memory_id TEXT PRIMARY KEY,
  embedding float[384]
);
