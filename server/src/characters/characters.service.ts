import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { randomBytes } from 'node:crypto';

export interface KeywordSnippet {
  id: string;
  character_id?: string | null;
  persona_id?: string | null;
  user_id: string;
  title: string;
  keywords: string;
  content: string;
  scope: string;
  priority: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CharacterItem {
  id: string;
  creator_id: string;
  creator_name?: string;
  name: string;
  avatar_url: string | null;
  tagline: string | null;
  greeting: string;
  system_prompt: string;
  scenario: string | null;
  dialogue_examples: string | null;
  is_public: number;
  default_model: string | null;
  temperature: number;
  created_at: string;
  updated_at: string;
  snippet_count?: number;
  snippets?: KeywordSnippet[];
}

export class CreateSnippetInput {
  id?: string;
  title!: string;
  keywords!: string;
  content!: string;
  priority?: number;
  is_active?: boolean | number;
}

export class CreateCharacterDto {
  name!: string;
  avatar_url?: string | null;
  tagline?: string | null;
  greeting!: string;
  system_prompt!: string;
  scenario?: string | null;
  dialogue_examples?: string | null;
  is_public?: boolean | number;
  default_model?: string | null;
  temperature?: number;
  snippets?: CreateSnippetInput[];
}

export class UpdateCharacterDto {
  name?: string;
  avatar_url?: string | null;
  tagline?: string | null;
  greeting?: string;
  system_prompt?: string;
  scenario?: string | null;
  dialogue_examples?: string | null;
  is_public?: boolean | number;
  default_model?: string | null;
  temperature?: number;
  snippets?: CreateSnippetInput[];
}

@Injectable()
export class CharactersService {
  constructor(private readonly dbService: DatabaseService) {}

  private get db() {
    return this.dbService.getDb();
  }

  list(userId?: string, scope: 'all' | 'mine' | 'public' = 'all', query?: string): CharacterItem[] {
    let sql = `
      SELECT c.*, u.username as creator_name,
        (SELECT COUNT(*) FROM keyword_memories km WHERE km.character_id = c.id) as snippet_count
      FROM characters c
      LEFT JOIN users u ON c.creator_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (scope === 'mine') {
      if (!userId) return [];
      sql += ` AND c.creator_id = ?`;
      params.push(userId);
    } else if (scope === 'public') {
      sql += ` AND c.is_public = 1`;
    } else {
      // 'all': creator is current user OR character is public
      if (userId) {
        sql += ` AND (c.creator_id = ? OR c.is_public = 1)`;
        params.push(userId);
      } else {
        sql += ` AND c.is_public = 1`;
      }
    }

    if (query && query.trim()) {
      const q = `%${query.trim().toLowerCase()}%`;
      sql += ` AND (LOWER(c.name) LIKE ? OR LOWER(c.tagline) LIKE ? OR LOWER(c.system_prompt) LIKE ?)`;
      params.push(q, q, q);
    }

    sql += ` ORDER BY c.created_at DESC`;

    return this.db.prepare(sql).all(...params) as CharacterItem[];
  }

  get(id: string, userId?: string, isAdmin = false): CharacterItem {
    const row = this.db
      .prepare(
        `SELECT c.*, u.username as creator_name
         FROM characters c
         LEFT JOIN users u ON c.creator_id = u.id
         WHERE c.id = ?`,
      )
      .get(id) as CharacterItem | undefined;

    if (!row) {
      throw new NotFoundException(`Character with ID '${id}' not found.`);
    }

    // Access check: must be public, created by user, or user is admin
    if (!row.is_public && row.creator_id !== userId && !isAdmin) {
      throw new ForbiddenException('You do not have permission to view this private character.');
    }

    // Fetch character's keyword snippets
    const snippets = this.db
      .prepare(
        `SELECT * FROM keyword_memories 
         WHERE character_id = ? 
         ORDER BY priority DESC, created_at ASC`,
      )
      .all(id) as KeywordSnippet[];

    row.snippets = snippets;
    row.snippet_count = snippets.length;
    return row;
  }

  create(userId: string, dto: CreateCharacterDto): CharacterItem {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException('Character name is required.');
    }
    if (!dto.greeting || !dto.greeting.trim()) {
      throw new BadRequestException('Character greeting is required.');
    }
    if (!dto.system_prompt || !dto.system_prompt.trim()) {
      throw new BadRequestException('Character system prompt / personality is required.');
    }

    const charId = `char_${randomBytes(8).toString('hex')}`;
    const now = new Date().toISOString();
    const isPublic = dto.is_public === true || dto.is_public === 1 ? 1 : 0;
    const temp = dto.temperature !== undefined ? Math.min(2, Math.max(0, dto.temperature)) : 0.8;

    const stmt = this.db.prepare(`
      INSERT INTO characters (
        id, creator_id, name, avatar_url, tagline, greeting, system_prompt, 
        scenario, dialogue_examples, is_public, default_model, temperature, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      charId,
      userId,
      dto.name.trim(),
      dto.avatar_url?.trim() || null,
      dto.tagline?.trim() || null,
      dto.greeting.trim(),
      dto.system_prompt.trim(),
      dto.scenario?.trim() || null,
      dto.dialogue_examples?.trim() || null,
      isPublic,
      dto.default_model?.trim() || null,
      temp,
      now,
      now,
    );

    // Save initial snippets if provided
    if (Array.isArray(dto.snippets) && dto.snippets.length > 0) {
      this.syncSnippets(charId, userId, dto.snippets);
    }

    return this.get(charId, userId, true);
  }

  update(id: string, userId: string, dto: UpdateCharacterDto, isAdmin = false): CharacterItem {
    const existing = this.db.prepare(`SELECT * FROM characters WHERE id = ?`).get(id) as CharacterItem | undefined;
    if (!existing) {
      throw new NotFoundException(`Character with ID '${id}' not found.`);
    }

    if (existing.creator_id !== userId && !isAdmin) {
      throw new ForbiddenException('You can only edit characters you created.');
    }

    const now = new Date().toISOString();
    const name = dto.name !== undefined ? dto.name.trim() : existing.name;
    const avatar_url = dto.avatar_url !== undefined ? (dto.avatar_url ? dto.avatar_url.trim() : null) : existing.avatar_url;
    const tagline = dto.tagline !== undefined ? (dto.tagline ? dto.tagline.trim() : null) : existing.tagline;
    const greeting = dto.greeting !== undefined ? dto.greeting.trim() : existing.greeting;
    const system_prompt = dto.system_prompt !== undefined ? dto.system_prompt.trim() : existing.system_prompt;
    const scenario = dto.scenario !== undefined ? (dto.scenario ? dto.scenario.trim() : null) : existing.scenario;
    const dialogue_examples = dto.dialogue_examples !== undefined ? (dto.dialogue_examples ? dto.dialogue_examples.trim() : null) : existing.dialogue_examples;
    const is_public = dto.is_public !== undefined ? (dto.is_public === true || dto.is_public === 1 ? 1 : 0) : existing.is_public;
    const default_model = dto.default_model !== undefined ? (dto.default_model ? dto.default_model.trim() : null) : existing.default_model;
    const temperature = dto.temperature !== undefined ? Math.min(2, Math.max(0, dto.temperature)) : existing.temperature;

    this.db.prepare(`
      UPDATE characters SET 
        name = ?, avatar_url = ?, tagline = ?, greeting = ?, system_prompt = ?,
        scenario = ?, dialogue_examples = ?, is_public = ?, default_model = ?, 
        temperature = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name,
      avatar_url,
      tagline,
      greeting,
      system_prompt,
      scenario,
      dialogue_examples,
      is_public,
      default_model,
      temperature,
      now,
      id,
    );

    // If snippets are provided in update payload, sync them
    if (Array.isArray(dto.snippets)) {
      this.syncSnippets(id, existing.creator_id, dto.snippets);
    }

    return this.get(id, userId, isAdmin);
  }

  delete(id: string, userId: string, isAdmin = false): { success: boolean; id: string } {
    const existing = this.db.prepare(`SELECT * FROM characters WHERE id = ?`).get(id) as CharacterItem | undefined;
    if (!existing) {
      throw new NotFoundException(`Character with ID '${id}' not found.`);
    }

    if (existing.creator_id !== userId && !isAdmin) {
      throw new ForbiddenException('You can only delete characters you created.');
    }

    // Cascade delete handles keyword_memories and session_participants
    this.db.prepare(`DELETE FROM characters WHERE id = ?`).run(id);
    return { success: true, id };
  }

  // --- Keyword Snippets / Lorebook CRUD ---

  private syncSnippets(characterId: string, userId: string, snippets: CreateSnippetInput[]) {
    // Delete existing snippets for this character
    this.db.prepare(`DELETE FROM keyword_memories WHERE character_id = ?`).run(characterId);

    const insertStmt = this.db.prepare(`
      INSERT INTO keyword_memories (
        id, character_id, user_id, title, keywords, content, scope, priority, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'character', ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    for (const s of snippets) {
      if (!s.title?.trim() || !s.keywords?.trim() || !s.content?.trim()) continue;
      const snippetId = s.id && s.id.startsWith('km_') ? s.id : `km_${randomBytes(8).toString('hex')}`;
      const isActive = s.is_active === false || s.is_active === 0 ? 0 : 1;
      const priority = Number(s.priority) || 10;
      insertStmt.run(
        snippetId,
        characterId,
        userId,
        s.title.trim(),
        s.keywords.trim(),
        s.content.trim(),
        priority,
        isActive,
        now,
        now,
      );
    }
  }

  getSnippets(characterId: string, userId?: string, isAdmin = false): KeywordSnippet[] {
    // Check access to character
    this.get(characterId, userId, isAdmin);

    return this.db
      .prepare(
        `SELECT * FROM keyword_memories 
         WHERE character_id = ? 
         ORDER BY priority DESC, created_at ASC`,
      )
      .all(characterId) as KeywordSnippet[];
  }

  addSnippet(characterId: string, userId: string, snippet: CreateSnippetInput, isAdmin = false): KeywordSnippet {
    const char = this.db.prepare(`SELECT * FROM characters WHERE id = ?`).get(characterId) as CharacterItem | undefined;
    if (!char) {
      throw new NotFoundException(`Character '${characterId}' not found.`);
    }
    if (char.creator_id !== userId && !isAdmin) {
      throw new ForbiddenException('Only the character creator can add lore snippets.');
    }

    if (!snippet.title?.trim() || !snippet.keywords?.trim() || !snippet.content?.trim()) {
      throw new BadRequestException('Title, keywords, and content are required.');
    }

    const snippetId = `km_${randomBytes(8).toString('hex')}`;
    const now = new Date().toISOString();
    const isActive = snippet.is_active === false || snippet.is_active === 0 ? 0 : 1;
    const priority = Number(snippet.priority) || 10;

    this.db
      .prepare(
        `INSERT INTO keyword_memories (
          id, character_id, user_id, title, keywords, content, scope, priority, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'character', ?, ?, ?, ?)`,
      )
      .run(
        snippetId,
        characterId,
        userId,
        snippet.title.trim(),
        snippet.keywords.trim(),
        snippet.content.trim(),
        priority,
        isActive,
        now,
        now,
      );

    return this.db.prepare(`SELECT * FROM keyword_memories WHERE id = ?`).get(snippetId) as KeywordSnippet;
  }

  updateSnippet(
    characterId: string,
    snippetId: string,
    userId: string,
    snippet: Partial<CreateSnippetInput>,
    isAdmin = false,
  ): KeywordSnippet {
    const char = this.db.prepare(`SELECT * FROM characters WHERE id = ?`).get(characterId) as CharacterItem | undefined;
    if (!char) {
      throw new NotFoundException(`Character '${characterId}' not found.`);
    }
    if (char.creator_id !== userId && !isAdmin) {
      throw new ForbiddenException('Only the character creator can edit lore snippets.');
    }

    const existing = this.db.prepare(`SELECT * FROM keyword_memories WHERE id = ? AND character_id = ?`).get(snippetId, characterId) as KeywordSnippet | undefined;
    if (!existing) {
      throw new NotFoundException(`Snippet '${snippetId}' not found.`);
    }

    const now = new Date().toISOString();
    const title = snippet.title !== undefined ? snippet.title.trim() : existing.title;
    const keywords = snippet.keywords !== undefined ? snippet.keywords.trim() : existing.keywords;
    const content = snippet.content !== undefined ? snippet.content.trim() : existing.content;
    const priority = snippet.priority !== undefined ? Number(snippet.priority) : existing.priority;
    const isActive = snippet.is_active !== undefined ? (snippet.is_active === false || snippet.is_active === 0 ? 0 : 1) : existing.is_active;

    this.db.prepare(`
      UPDATE keyword_memories SET
        title = ?, keywords = ?, content = ?, priority = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(title, keywords, content, priority, isActive, now, snippetId);

    return this.db.prepare(`SELECT * FROM keyword_memories WHERE id = ?`).get(snippetId) as KeywordSnippet;
  }

  deleteSnippet(characterId: string, snippetId: string, userId: string, isAdmin = false): { success: boolean; id: string } {
    const char = this.db.prepare(`SELECT * FROM characters WHERE id = ?`).get(characterId) as CharacterItem | undefined;
    if (!char) {
      throw new NotFoundException(`Character '${characterId}' not found.`);
    }
    if (char.creator_id !== userId && !isAdmin) {
      throw new ForbiddenException('Only the character creator can delete lore snippets.');
    }

    const info = this.db.prepare(`DELETE FROM keyword_memories WHERE id = ? AND character_id = ?`).run(snippetId, characterId);
    if (info.changes === 0) {
      throw new NotFoundException(`Snippet '${snippetId}' not found.`);
    }
    return { success: true, id: snippetId };
  }
}
