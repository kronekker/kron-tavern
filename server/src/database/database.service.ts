import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Database, { Database as DatabaseInstance } from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DatabaseStats {
  dbPath: string;
  dbSizeBytes: number;
  walSizeBytes: number;
  sqliteVersion: string;
  sqliteVecVersion: string;
  journalMode: string;
  tableCounts: Record<string, number>;
}

export interface TableColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: any;
  pk: number;
}

const ALLOWED_TABLES = [
  'users',
  'personas',
  'characters',
  'keyword_memories',
  'episodic_memories',
  'sessions',
  'session_participants',
  'messages',
  'turn_traces',
] as const;

export type AllowedTableName = (typeof ALLOWED_TABLES)[number];

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private db!: DatabaseInstance;
  private dbPath!: string;

  onModuleInit() {
    this.initDatabase();
  }

  onModuleDestroy() {
    if (this.db) {
      this.db.close();
      this.logger.log('SQLite database connection closed.');
    }
  }

  private initDatabase() {
    if (process.env.DB_PATH) {
      this.dbPath = resolve(process.env.DB_PATH);
    } else {
      // Locate project root whether running from root or from server/
      const isInsideServer = existsSync(resolve(process.cwd(), 'nest-cli.json'));
      const rootDir = isInsideServer ? resolve(process.cwd(), '..') : process.cwd();
      this.dbPath = resolve(rootDir, 'data/kron-tavern.db');
    }

    const dbDir = dirname(this.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.logger.log(`Opening SQLite database at: ${this.dbPath}`);
    this.db = new Database(this.dbPath);

    // Load sqlite-vec extension
    sqliteVec.load(this.db);

    // Apply performance and consistency pragmas
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    // Run schema migrations
    this.applySchema();

    this.logger.log('Database initialized successfully with WAL mode and sqlite-vec.');
  }

  private applySchema() {
    // Locate schema.sql file
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schemaFileCandidate = resolve(__dirname, 'schema.sql');
    const fallbackSchemaCandidate = resolve(process.cwd(), 'src/database/schema.sql');

    let schemaSql: string;
    if (existsSync(schemaFileCandidate)) {
      schemaSql = readFileSync(schemaFileCandidate, 'utf-8');
    } else if (existsSync(fallbackSchemaCandidate)) {
      schemaSql = readFileSync(fallbackSchemaCandidate, 'utf-8');
    } else {
      schemaSql = this.getDefaultSchemaSql();
    }

    this.db.exec(schemaSql);

    // Apply incremental column migrations for existing databases
    this.ensureColumn('users', 'email', 'TEXT');
    this.ensureColumn('keyword_memories', 'session_id', 'TEXT');
    this.ensureColumn('keyword_memories', 'scope', "TEXT DEFAULT 'session'");
    this.ensureColumn('episodic_memories', 'scope', "TEXT DEFAULT 'session'");
  }

  private ensureColumn(table: string, column: string, columnDef: string) {
    try {
      const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as TableColumnInfo[];
      const exists = columns.some((c) => c.name === column);
      if (!exists) {
        this.logger.log(`Running migration: ALTER TABLE ${table} ADD COLUMN ${column} ${columnDef}`);
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${columnDef}`);
      }
    } catch (e: any) {
      this.logger.warn(`Could not check or add column ${column} to ${table}: ${e.message}`);
    }
  }

  getDb(): DatabaseInstance {
    return this.db;
  }

  getStats(): DatabaseStats {
    const dbSize = existsSync(this.dbPath) ? statSync(this.dbPath).size : 0;
    const walPath = `${this.dbPath}-wal`;
    const walSize = existsSync(walPath) ? statSync(walPath).size : 0;

    const sqliteVersionRow = this.db.prepare('SELECT sqlite_version() AS version').get() as {
      version: string;
    };
    const vecVersionRow = this.db.prepare('SELECT vec_version() AS version').get() as {
      version: string;
    };
    const journalModeRow = this.db.pragma('journal_mode', { simple: true }) as string;

    const tableCounts: Record<string, number> = {};
    for (const table of ALLOWED_TABLES) {
      try {
        const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
          count: number;
        };
        tableCounts[table] = row.count;
      } catch {
        tableCounts[table] = 0;
      }
    }

    return {
      dbPath: this.dbPath,
      dbSizeBytes: dbSize,
      walSizeBytes: walSize,
      sqliteVersion: sqliteVersionRow?.version ?? 'unknown',
      sqliteVecVersion: vecVersionRow?.version ?? 'unknown',
      journalMode: journalModeRow ?? 'WAL',
      tableCounts,
    };
  }

  getTables(): { name: string; count: number }[] {
    const stats = this.getStats();
    return ALLOWED_TABLES.map((table) => ({
      name: table,
      count: stats.tableCounts[table] ?? 0,
    }));
  }

  getTableColumns(tableName: string): TableColumnInfo[] {
    if (!ALLOWED_TABLES.includes(tableName as AllowedTableName)) {
      throw new Error(`Table '${tableName}' is not allowed or does not exist.`);
    }
    return this.db.prepare(`PRAGMA table_info(${tableName})`).all() as TableColumnInfo[];
  }

  getTableData(tableName: string, page = 1, pageSize = 20) {
    if (!ALLOWED_TABLES.includes(tableName as AllowedTableName)) {
      throw new Error(`Table '${tableName}' is not allowed or does not exist.`);
    }

    const offset = Math.max(0, (page - 1) * pageSize);
    const countRow = this.db.prepare(`SELECT COUNT(*) AS total FROM ${tableName}`).get() as {
      total: number;
    };
    const total = countRow.total;

    // Check if table has created_at
    const columns = this.getTableColumns(tableName);
    const hasCreatedAt = columns.some((c) => c.name === 'created_at');
    const orderClause = hasCreatedAt ? 'ORDER BY created_at DESC' : 'ORDER BY rowid DESC';

    const rows = this.db
      .prepare(`SELECT * FROM ${tableName} ${orderClause} LIMIT ? OFFSET ?`)
      .all(pageSize, offset);

    return {
      tableName,
      columns,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      rows,
    };
  }

  deleteTableRow(tableName: string, id: string): boolean {
    if (!ALLOWED_TABLES.includes(tableName as AllowedTableName)) {
      throw new Error(`Table '${tableName}' is not allowed.`);
    }
    const info = this.db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(id);
    return info.changes > 0;
  }

  runVacuum(): void {
    this.logger.log('Executing database VACUUM...');
    this.db.exec('VACUUM;');
  }

  runIntegrityCheck(): any[] {
    return this.db.prepare('PRAGMA integrity_check').all();
  }

  seedDemoData(): { message: string; seeded: Record<string, number> } {
    const now = new Date().toISOString();

    const insertUser = this.db.prepare(`
      INSERT OR IGNORE INTO users (id, email, username, password_hash, is_admin, settings_json, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `);

    const insertPersona = this.db.prepare(`
      INSERT OR IGNORE INTO personas (id, user_id, name, avatar_url, description, speech_style, is_default, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `);

    const insertCharacter = this.db.prepare(`
      INSERT OR IGNORE INTO characters (id, creator_id, name, avatar_url, tagline, greeting, system_prompt, scenario, is_public, default_model, temperature, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `);

    const insertKeyword = this.db.prepare(`
      INSERT OR IGNORE INTO keyword_memories (id, character_id, session_id, user_id, title, keywords, content, scope, priority, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSession = this.db.prepare(`
      INSERT OR IGNORE INTO sessions (id, user_id, title, is_group, active_persona_id, context_strategy, created_at)
      VALUES (?, ?, ?, 0, ?, 'episodic_sliding', ?)
    `);

    const insertMessage = this.db.prepare(`
      INSERT OR IGNORE INTO messages (id, session_id, sender_type, sender_id, content, is_canonical, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `);

    const demoUserId = 'user_demo_01';
    const demoPersonaId = 'persona_demo_01';
    const demoCharId = 'char_lyra_01';
    const demoSessionId = 'session_demo_01';

    const transaction = this.db.transaction(() => {
      insertUser.run(
        demoUserId,
        'adventurer@kron-tavern.local',
        'adventurer',
        '$argon2id$v=19$m=65536,t=3,p=4$demo_salt$demo_hash',
        JSON.stringify({ defaultModel: 'anthropic/claude-3.5-sonnet', theme: 'dark' }),
        now,
      );

      insertPersona.run(
        demoPersonaId,
        demoUserId,
        'Rowan the Explorer',
        'https://api.dicebear.com/7.x/bottts/svg?seed=Rowan',
        'A sharp-witted cartographer and relic hunter from the high crests of Oakhaven.',
        'Articulate, observant, and subtly sarcastic.',
        now,
      );

      insertCharacter.run(
        demoCharId,
        demoUserId,
        'Lyra the Alchemist',
        'https://api.dicebear.com/7.x/bottts/svg?seed=Lyra',
        'Master apothecary seeking forgotten celestial formulas',
        '*Lyra wipes a smear of luminous blue phosphorus from her goggles and looks up as the brass bell chimes above the apothecary door.* "Ah! Careful where you step—the copper solvent on the second flagstone hasn\'t settled yet. What brings you to my workshop today?"',
        'You are Lyra, a brilliant and eccentric alchemist. You speak with infectious curiosity, frequently referencing volatile reagents, astrological alignments, and obscure herbal properties. You are fiercely loyal to close friends and guarded about your past in the Royal Academy.',
        'In the candlelit cellar of the Whispering Flask Apothecary on a stormy dusk.',
        'anthropic/claude-3.5-sonnet',
        0.8,
        now,
      );

      insertKeyword.run(
        'kw_phosphor_01',
        demoCharId,
        null,
        demoUserId,
        'Celestial Phosphorus',
        'blue phosphorus,celestial phosphorus,luminescent reagent',
        'Celestial Phosphorus is a rare, bioluminescent extract gathered only during the new moon. Lyra uses it for stabilizing volatile transmutations.',
        'character',
        15,
        now,
      );

      insertKeyword.run(
        'kw_academy_01',
        demoCharId,
        null,
        demoUserId,
        'The Royal Academy of Spires',
        'royal academy,the spires,grand archivist',
        'Lyra was formerly the youngest Proctor of Transmutation at the Royal Academy of Spires before leaving under suspicious circumstances regarding a forbidden grimoire.',
        'character',
        20,
        now,
      );

      insertSession.run(
        demoSessionId,
        demoUserId,
        'An Evening at the Whispering Flask',
        demoPersonaId,
        now,
      );

      insertMessage.run(
        'msg_greeting_01',
        demoSessionId,
        'character',
        demoCharId,
        '*Lyra wipes a smear of luminous blue phosphorus from her goggles and looks up as the brass bell chimes above the apothecary door.* "Ah! Careful where you step—the copper solvent on the second flagstone hasn\'t settled yet. What brings you to my workshop today?"',
        now,
      );
    });

    transaction();

    const stats = this.getStats();
    return {
      message: 'Demo dataset seeded successfully!',
      seeded: stats.tableCounts,
    };
  }

  private getDefaultSchemaSql(): string {
    return `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        openrouter_key_encrypted TEXT,
        settings_json TEXT DEFAULT '{}',
        is_admin INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
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
      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        avatar_url TEXT,
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
      CREATE TABLE IF NOT EXISTS keyword_memories (
        id TEXT PRIMARY KEY,
        character_id TEXT REFERENCES characters(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        keywords TEXT NOT NULL,
        content TEXT NOT NULL,
        scope TEXT DEFAULT 'session',
        priority INTEGER DEFAULT 10,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        is_group INTEGER DEFAULT 0,
        active_persona_id TEXT REFERENCES personas(id) ON DELETE SET NULL,
        context_strategy TEXT DEFAULT 'episodic_sliding',
        context_threshold_percent INTEGER DEFAULT 75,
        rolling_summary TEXT,
        is_ab_mode INTEGER DEFAULT 0,
        ab_model_a TEXT,
        ab_model_b TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS session_participants (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        sender_type TEXT NOT NULL,
        sender_id TEXT,
        content TEXT NOT NULL,
        is_canonical INTEGER DEFAULT 1,
        ab_group_id TEXT,
        model_used TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS episodic_memories (
        id TEXT PRIMARY KEY,
        character_id TEXT REFERENCES characters(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        memory_text TEXT NOT NULL,
        scope TEXT DEFAULT 'session',
        importance INTEGER DEFAULT 5,
        source_turn_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
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
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_episodic_memories USING vec0(
        memory_id TEXT PRIMARY KEY,
        embedding float[384]
      );
    `;
  }
}
