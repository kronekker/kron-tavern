import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { randomBytes } from 'node:crypto';
import type { KeywordSnippet, CreateSnippetInput } from '../characters/characters.service.js';

export interface PersonaItem {
  id: string;
  user_id: string;
  name: string;
  avatar_url: string | null;
  description: string;
  speech_style: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
  snippet_count?: number;
  snippets?: KeywordSnippet[];
}

export class CreatePersonaDto {
  name!: string;
  avatar_url?: string | null;
  description!: string;
  speech_style?: string | null;
  is_default?: boolean | number;
  snippets?: CreateSnippetInput[];
}

export class UpdatePersonaDto {
  name?: string;
  avatar_url?: string | null;
  description?: string;
  speech_style?: string | null;
  is_default?: boolean | number;
  snippets?: CreateSnippetInput[];
}

@Injectable()
export class PersonasService {
  constructor(private readonly dbService: DatabaseService) {}

  private get db() {
    return this.dbService.getDb();
  }

  list(userId: string): PersonaItem[] {
    const personas = this.db
      .prepare(
        `SELECT p.*,
          (SELECT COUNT(*) FROM keyword_memories km WHERE km.persona_id = p.id) as snippet_count
         FROM personas p
         WHERE p.user_id = ?
         ORDER BY p.is_default DESC, p.created_at DESC`,
      )
      .all(userId) as PersonaItem[];

    return personas;
  }

  get(id: string, userId: string): PersonaItem {
    const row = this.db
      .prepare(`SELECT * FROM personas WHERE id = ? AND user_id = ?`)
      .get(id, userId) as PersonaItem | undefined;

    if (!row) {
      throw new NotFoundException(`Persona '${id}' not found or belongs to another user.`);
    }

    const snippets = this.db
      .prepare(
        `SELECT * FROM keyword_memories 
         WHERE persona_id = ? 
         ORDER BY priority DESC, created_at ASC`,
      )
      .all(id) as KeywordSnippet[];

    row.snippets = snippets;
    row.snippet_count = snippets.length;
    return row;
  }

  create(userId: string, dto: CreatePersonaDto): PersonaItem {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException('Persona name is required.');
    }
    if (!dto.description || !dto.description.trim()) {
      throw new BadRequestException('Persona description is required.');
    }

    const personaId = `persona_${randomBytes(8).toString('hex')}`;
    const now = new Date().toISOString();

    // Check if this is the user's first persona, or if is_default is true
    const existingCount = this.db
      .prepare(`SELECT COUNT(*) as count FROM personas WHERE user_id = ?`)
      .get(userId) as { count: number };

    const shouldBeDefault = dto.is_default === true || dto.is_default === 1 || existingCount.count === 0;

    if (shouldBeDefault) {
      this.db.prepare(`UPDATE personas SET is_default = 0 WHERE user_id = ?`).run(userId);
    }

    this.db
      .prepare(
        `INSERT INTO personas (
          id, user_id, name, avatar_url, description, speech_style, is_default, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        personaId,
        userId,
        dto.name.trim(),
        dto.avatar_url?.trim() || null,
        dto.description.trim(),
        dto.speech_style?.trim() || null,
        shouldBeDefault ? 1 : 0,
        now,
        now,
      );

    if (Array.isArray(dto.snippets) && dto.snippets.length > 0) {
      this.syncSnippets(personaId, userId, dto.snippets);
    }

    return this.get(personaId, userId);
  }

  update(id: string, userId: string, dto: UpdatePersonaDto): PersonaItem {
    const existing = this.db.prepare(`SELECT * FROM personas WHERE id = ? AND user_id = ?`).get(id, userId) as PersonaItem | undefined;
    if (!existing) {
      throw new NotFoundException(`Persona '${id}' not found.`);
    }

    const now = new Date().toISOString();
    const name = dto.name !== undefined ? dto.name.trim() : existing.name;
    const avatar_url = dto.avatar_url !== undefined ? (dto.avatar_url ? dto.avatar_url.trim() : null) : existing.avatar_url;
    const description = dto.description !== undefined ? dto.description.trim() : existing.description;
    const speech_style = dto.speech_style !== undefined ? (dto.speech_style ? dto.speech_style.trim() : null) : existing.speech_style;

    let isDefault = existing.is_default;
    if (dto.is_default !== undefined) {
      const wantDefault = dto.is_default === true || dto.is_default === 1 ? 1 : 0;
      if (wantDefault === 1) {
        this.db.prepare(`UPDATE personas SET is_default = 0 WHERE user_id = ?`).run(userId);
        isDefault = 1;
      } else {
        isDefault = 0;
      }
    }

    this.db.prepare(`
      UPDATE personas SET
        name = ?, avatar_url = ?, description = ?, speech_style = ?, is_default = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(name, avatar_url, description, speech_style, isDefault, now, id, userId);

    if (Array.isArray(dto.snippets)) {
      this.syncSnippets(id, userId, dto.snippets);
    }

    return this.get(id, userId);
  }

  delete(id: string, userId: string): { success: boolean; id: string } {
    const existing = this.db.prepare(`SELECT * FROM personas WHERE id = ? AND user_id = ?`).get(id, userId) as PersonaItem | undefined;
    if (!existing) {
      throw new NotFoundException(`Persona '${id}' not found.`);
    }

    this.db.prepare(`DELETE FROM personas WHERE id = ? AND user_id = ?`).run(id, userId);

    // If deleted persona was default, promote another persona if available
    if (existing.is_default) {
      const next = this.db
        .prepare(`SELECT id FROM personas WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`)
        .get(userId) as { id: string } | undefined;
      if (next) {
        this.db.prepare(`UPDATE personas SET is_default = 1 WHERE id = ?`).run(next.id);
      }
    }

    return { success: true, id };
  }

  setDefault(id: string, userId: string): PersonaItem {
    const existing = this.db.prepare(`SELECT * FROM personas WHERE id = ? AND user_id = ?`).get(id, userId) as PersonaItem | undefined;
    if (!existing) {
      throw new NotFoundException(`Persona '${id}' not found.`);
    }

    this.db.prepare(`UPDATE personas SET is_default = 0 WHERE user_id = ?`).run(userId);
    this.db.prepare(`UPDATE personas SET is_default = 1, updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);

    return this.get(id, userId);
  }

  // --- Persona Keyword Snippets (Traits & Facts) ---

  private syncSnippets(personaId: string, userId: string, snippets: CreateSnippetInput[]) {
    this.db.prepare(`DELETE FROM keyword_memories WHERE persona_id = ?`).run(personaId);

    const insertStmt = this.db.prepare(`
      INSERT INTO keyword_memories (
        id, persona_id, user_id, title, keywords, content, scope, priority, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'persona', ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    for (const s of snippets) {
      if (!s.title?.trim() || !s.keywords?.trim() || !s.content?.trim()) continue;
      const snippetId = s.id && s.id.startsWith('km_') ? s.id : `km_${randomBytes(8).toString('hex')}`;
      const isActive = s.is_active === false || s.is_active === 0 ? 0 : 1;
      const priority = Number(s.priority) || 10;
      insertStmt.run(
        snippetId,
        personaId,
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

  getSnippets(personaId: string, userId: string): KeywordSnippet[] {
    this.get(personaId, userId);

    return this.db
      .prepare(
        `SELECT * FROM keyword_memories 
         WHERE persona_id = ? 
         ORDER BY priority DESC, created_at ASC`,
      )
      .all(personaId) as KeywordSnippet[];
  }

  addSnippet(personaId: string, userId: string, snippet: CreateSnippetInput): KeywordSnippet {
    this.get(personaId, userId);

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
          id, persona_id, user_id, title, keywords, content, scope, priority, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'persona', ?, ?, ?, ?)`,
      )
      .run(
        snippetId,
        personaId,
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
    personaId: string,
    snippetId: string,
    userId: string,
    snippet: Partial<CreateSnippetInput>,
  ): KeywordSnippet {
    this.get(personaId, userId);

    const existing = this.db.prepare(`SELECT * FROM keyword_memories WHERE id = ? AND persona_id = ?`).get(snippetId, personaId) as KeywordSnippet | undefined;
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

  deleteSnippet(personaId: string, snippetId: string, userId: string): { success: boolean; id: string } {
    this.get(personaId, userId);

    const info = this.db.prepare(`DELETE FROM keyword_memories WHERE id = ? AND persona_id = ?`).run(snippetId, personaId);
    if (info.changes === 0) {
      throw new NotFoundException(`Snippet '${snippetId}' not found.`);
    }
    return { success: true, id: snippetId };
  }
}
