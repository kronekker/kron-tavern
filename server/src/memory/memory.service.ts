import { Injectable, Logger, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { ModelsService } from '../models/models.service.js';
import { AuthService } from '../auth/auth.service.js';
import { randomBytes } from 'node:crypto';
import { pipeline } from '@xenova/transformers';

export interface EpisodicMemoryItem {
  id: string;
  character_id?: string | null;
  character_name?: string | null;
  session_id?: string | null;
  session_title?: string | null;
  user_id: string;
  memory_text: string;
  scope: 'session' | 'user';
  importance: number;
  source_turn_id?: string | null;
  created_at: string;
  similarity?: number | null;
  memory_type?: string;
}

export interface CreateEpisodicMemoryDto {
  sessionId?: string | null;
  characterId?: string | null;
  memoryText: string;
  scope?: 'session' | 'user';
  importance?: number;
  sourceTurnId?: string | null;
}

export interface UpdateEpisodicMemoryDto {
  memoryText?: string;
  scope?: 'session' | 'user';
  importance?: number;
}

@Injectable()
export class MemoryService implements OnModuleInit {
  private readonly logger = new Logger(MemoryService.name);
  private embedderPromise: Promise<any> | null = null;
  private readonly embeddingModelId = 'Xenova/all-MiniLM-L6-v2';

  constructor(
    private readonly dbService: DatabaseService,
    private readonly modelsService: ModelsService,
    private readonly authService: AuthService,
  ) {}

  private get db() {
    return this.dbService.getDb();
  }

  onModuleInit() {
    // Warm up the local ONNX embedding pipeline asynchronously in the background
    // and backfill any existing episodic_memories rows missing a vector in vec_episodic_memories.
    setTimeout(() => {
      void this.ensureBackfilledVectors();
    }, 1500);
  }

  // --- 1. Local In-Process Embedding Engine (@xenova/transformers) ---

  private async getEmbedder(): Promise<any> {
    if (!this.embedderPromise) {
      this.logger.log(`Initializing local ONNX embedding pipeline (${this.embeddingModelId}, 384d)...`);
      this.embedderPromise = pipeline('feature-extraction', this.embeddingModelId)
        .then((pipe) => {
          this.logger.log(`Local ONNX embedding pipeline (${this.embeddingModelId}) ready.`);
          return pipe;
        })
        .catch((err) => {
          this.logger.error(`Failed to initialize local embedding pipeline: ${err.message}`);
          this.embedderPromise = null;
          throw err;
        });
    }
    return this.embedderPromise;
  }

  async generateEmbeddingBuffer(text: string): Promise<Buffer> {
    const cleanText = (text || '').trim();
    if (!cleanText) {
      return Buffer.from(new Float32Array(384).buffer);
    }

    const embedder = await this.getEmbedder();
    const output = await embedder(cleanText, { pooling: 'mean', normalize: true });
    const floatArray = new Float32Array(output.data);
    return Buffer.from(floatArray.buffer);
  }

  private async ensureBackfilledVectors(): Promise<void> {
    try {
      const missingRows = this.db
        .prepare(
          `
        SELECT em.id, em.memory_text
        FROM episodic_memories em
        LEFT JOIN vec_episodic_memories vem ON vem.memory_id = em.id
        WHERE vem.memory_id IS NULL
      `,
        )
        .all() as { id: string; memory_text: string }[];

      if (missingRows.length === 0) return;

      this.logger.log(`Backfilling ${missingRows.length} episodic memory vector(s) into vec_episodic_memories...`);
      for (const row of missingRows) {
        try {
          const vecBuf = await this.generateEmbeddingBuffer(row.memory_text);
          this.db
            .prepare('INSERT OR REPLACE INTO vec_episodic_memories (memory_id, embedding) VALUES (?, ?)')
            .run(row.id, vecBuf);
        } catch (err: any) {
          this.logger.warn(`Failed backfilling vector for memory ${row.id}: ${err.message}`);
        }
      }
    } catch (err: any) {
      this.logger.warn(`Vector backfill check error: ${err.message}`);
    }
  }

  // --- 2. Semantic Vector Search via sqlite-vec ---

  async searchRelevantMemories(params: {
    userId: string;
    sessionId: string;
    characterId?: string | null;
    queryText: string;
    topK?: number;
    minSimilarity?: number;
  }): Promise<EpisodicMemoryItem[]> {
    const topK = params.topK ?? 6;
    const minSimilarity = params.minSimilarity ?? 0.22;

    try {
      const queryVecBuf = await this.generateEmbeddingBuffer(params.queryText);

      // Query sqlite-vec cosine similarity across memories that belong to:
      // 1) This specific session (scope = 'session' AND session_id = :sessionId)
      // 2) User-Global promoted memories (scope = 'user' AND user_id = :userId)
      const rows = this.db
        .prepare(
          `
        SELECT 
          em.*,
          c.name AS character_name,
          s.title AS session_title,
          (1.0 - vec_distance_cosine(vem.embedding, ?)) AS similarity
        FROM episodic_memories em
        JOIN vec_episodic_memories vem ON vem.memory_id = em.id
        LEFT JOIN characters c ON c.id = em.character_id
        LEFT JOIN sessions s ON s.id = em.session_id
        WHERE em.user_id = ?
          AND (
            (em.scope = ? AND em.session_id = ?)
            OR (em.scope = ?)
          )
        ORDER BY similarity DESC, em.importance DESC
        LIMIT ?
      `,
        )
        .all(
          queryVecBuf,
          params.userId,
          'session',
          params.sessionId,
          'user',
          topK * 2,
        ) as EpisodicMemoryItem[];

      const filtered = rows
        .filter((r) => typeof r.similarity === 'number' && r.similarity >= minSimilarity)
        .slice(0, topK)
        .map((r) => ({
          ...r,
          similarity: Number((r.similarity ?? 0).toFixed(4)),
          memory_type: r.scope === 'user' ? 'User-Global Semantic' : 'Session Episodic',
        }));

      return filtered;
    } catch (err: any) {
      this.logger.warn(`Semantic vector search failed (${err.message}); falling back to importance query.`);
      try {
        const fallbackRows = this.db
          .prepare(
            `
          SELECT em.*, c.name AS character_name, s.title AS session_title
          FROM episodic_memories em
          LEFT JOIN characters c ON c.id = em.character_id
          LEFT JOIN sessions s ON s.id = em.session_id
          WHERE em.user_id = ?
            AND (
              (em.scope = 'session' AND em.session_id = ?)
              OR (em.scope = 'user')
            )
          ORDER BY em.importance DESC, em.created_at DESC
          LIMIT ?
        `,
          )
          .all(params.userId, params.sessionId, topK) as EpisodicMemoryItem[];

        return fallbackRows.map((r) => ({
          ...r,
          similarity: null,
          memory_type: r.scope === 'user' ? 'User-Global' : 'Session Episodic',
        }));
      } catch {
        return [];
      }
    }
  }

  // --- 3. CRUD & Scope Promotion (session <-> user) ---

  listMemories(
    userId: string,
    filters?: { sessionId?: string; characterId?: string; scope?: 'session' | 'user' | 'all' },
  ): EpisodicMemoryItem[] {
    let sql = `
      SELECT 
        em.*,
        c.name AS character_name,
        s.title AS session_title
      FROM episodic_memories em
      LEFT JOIN characters c ON c.id = em.character_id
      LEFT JOIN sessions s ON s.id = em.session_id
      WHERE em.user_id = ?
    `;
    const sqlParams: any[] = [userId];

    if (filters?.scope === 'session' && filters.sessionId) {
      sql += ` AND em.scope = 'session' AND em.session_id = ?`;
      sqlParams.push(filters.sessionId);
    } else if (filters?.scope === 'user') {
      sql += ` AND em.scope = 'user'`;
    } else if (filters?.sessionId) {
      // Return both session-scoped memories for this session AND user-global memories
      sql += ` AND ((em.scope = 'session' AND em.session_id = ?) OR em.scope = 'user')`;
      sqlParams.push(filters.sessionId);
    }

    if (filters?.characterId) {
      sql += ` AND em.character_id = ?`;
      sqlParams.push(filters.characterId);
    }

    sql += ` ORDER BY em.created_at DESC, em.importance DESC`;

    const rows = this.db.prepare(sql).all(...sqlParams) as EpisodicMemoryItem[];
    return rows.map((r) => ({
      ...r,
      memory_type: r.scope === 'user' ? 'User-Global' : 'Session Episodic',
    }));
  }

  async createMemory(userId: string, dto: CreateEpisodicMemoryDto): Promise<EpisodicMemoryItem> {
    const text = (dto.memoryText || '').trim();
    if (!text) {
      throw new BadRequestException('memoryText is required.');
    }

    let characterId = dto.characterId || null;
    if (dto.sessionId && !characterId) {
      const sess = this.db
        .prepare('SELECT character_id FROM sessions WHERE id = ? AND user_id = ?')
        .get(dto.sessionId, userId) as { character_id?: string } | undefined;
      if (sess?.character_id) {
        characterId = sess.character_id;
      }
    }

    // Check for near-duplicate memory text in the same session/user scope
    const vecBuf = await this.generateEmbeddingBuffer(text);
    try {
      const existingDup = this.db
        .prepare(
          `
        SELECT em.id, em.memory_text, (1.0 - vec_distance_cosine(vem.embedding, ?)) AS similarity
        FROM episodic_memories em
        JOIN vec_episodic_memories vem ON vem.memory_id = em.id
        WHERE em.user_id = ?
          AND (em.session_id = ? OR em.scope = 'user')
        ORDER BY similarity DESC
        LIMIT 1
      `,
        )
        .get(vecBuf, userId, dto.sessionId || null) as
        | { id: string; memory_text: string; similarity: number }
        | undefined;

      if (existingDup && existingDup.similarity >= 0.91) {
        this.logger.debug(
          `Skipping near-duplicate episodic memory (similarity=${existingDup.similarity.toFixed(3)}): "${text}"`,
        );
        const existingItem = this.db
          .prepare(
            `
          SELECT em.*, c.name AS character_name, s.title AS session_title
          FROM episodic_memories em
          LEFT JOIN characters c ON c.id = em.character_id
          LEFT JOIN sessions s ON s.id = em.session_id
          WHERE em.id = ?
        `,
          )
          .get(existingDup.id) as EpisodicMemoryItem;
        return existingItem;
      }
    } catch {}

    const id = `mem_${randomBytes(12).toString('hex')}`;
    const scope: 'session' | 'user' = dto.scope === 'user' ? 'user' : 'session';
    const importance = Math.max(1, Math.min(10, Math.round(dto.importance ?? 6)));
    const now = new Date().toISOString();

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `
        INSERT INTO episodic_memories (
          id, character_id, session_id, user_id, memory_text,
          scope, importance, source_turn_id, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          id,
          characterId,
          dto.sessionId || null,
          userId,
          text,
          scope,
          importance,
          dto.sourceTurnId || null,
          now,
        );

      this.db
        .prepare('INSERT OR REPLACE INTO vec_episodic_memories (memory_id, embedding) VALUES (?, ?)')
        .run(id, vecBuf);
    });

    tx();

    const created = this.db
      .prepare(
        `
      SELECT em.*, c.name AS character_name, s.title AS session_title
      FROM episodic_memories em
      LEFT JOIN characters c ON c.id = em.character_id
      LEFT JOIN sessions s ON s.id = em.session_id
      WHERE em.id = ?
    `,
      )
      .get(id) as EpisodicMemoryItem;

    return {
      ...created,
      memory_type: created.scope === 'user' ? 'User-Global' : 'Session Episodic',
    };
  }

  async updateMemory(
    memoryId: string,
    userId: string,
    dto: UpdateEpisodicMemoryDto,
  ): Promise<EpisodicMemoryItem> {
    const existing = this.db
      .prepare('SELECT * FROM episodic_memories WHERE id = ? AND user_id = ?')
      .get(memoryId, userId) as EpisodicMemoryItem | undefined;

    if (!existing) {
      throw new NotFoundException(`Episodic memory '${memoryId}' not found.`);
    }

    const newText = dto.memoryText !== undefined ? dto.memoryText.trim() : existing.memory_text;
    if (!newText) {
      throw new BadRequestException('memoryText cannot be empty.');
    }

    const newScope: 'session' | 'user' =
      dto.scope === 'user' || dto.scope === 'session' ? dto.scope : existing.scope;
    const newImportance =
      dto.importance !== undefined
        ? Math.max(1, Math.min(10, Math.round(dto.importance)))
        : existing.importance;

    const textChanged = newText !== existing.memory_text;
    const newVecBuf = textChanged ? await this.generateEmbeddingBuffer(newText) : null;

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `
        UPDATE episodic_memories
        SET memory_text = ?, scope = ?, importance = ?
        WHERE id = ? AND user_id = ?
      `,
        )
        .run(newText, newScope, newImportance, memoryId, userId);

      if (newVecBuf) {
        this.db
          .prepare('INSERT OR REPLACE INTO vec_episodic_memories (memory_id, embedding) VALUES (?, ?)')
          .run(memoryId, newVecBuf);
      }
    });

    tx();

    const updated = this.db
      .prepare(
        `
      SELECT em.*, c.name AS character_name, s.title AS session_title
      FROM episodic_memories em
      LEFT JOIN characters c ON c.id = em.character_id
      LEFT JOIN sessions s ON s.id = em.session_id
      WHERE em.id = ?
    `,
      )
      .get(memoryId) as EpisodicMemoryItem;

    return {
      ...updated,
      memory_type: updated.scope === 'user' ? 'User-Global' : 'Session Episodic',
    };
  }

  deleteMemory(memoryId: string, userId: string): { success: boolean } {
    const existing = this.db
      .prepare('SELECT id FROM episodic_memories WHERE id = ? AND user_id = ?')
      .get(memoryId, userId);

    if (!existing) {
      throw new NotFoundException(`Episodic memory '${memoryId}' not found.`);
    }

    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM episodic_memories WHERE id = ?').run(memoryId);
      try {
        this.db.prepare('DELETE FROM vec_episodic_memories WHERE memory_id = ?').run(memoryId);
      } catch {}
    });

    tx();
    return { success: true };
  }

  // --- 4. Automated Episodic Memory Extraction (Background & On-Demand) ---

  async extractMemoriesFromRecentTurns(params: {
    sessionId: string;
    userId: string;
    sourceTurnId?: string;
    turnCount?: number;
  }): Promise<EpisodicMemoryItem[]> {
    const session = this.db
      .prepare(
        `
      SELECT s.*, c.name AS character_name, p.name AS persona_name
      FROM sessions s
      JOIN characters c ON c.id = s.character_id
      LEFT JOIN personas p ON p.id = s.active_persona_id
      WHERE s.id = ? AND s.user_id = ?
    `,
      )
      .get(params.sessionId, params.userId) as any;

    if (!session) {
      throw new NotFoundException(`Session '${params.sessionId}' not found.`);
    }

    const limit = params.turnCount ?? 8;
    const recentMsgs = this.db
      .prepare(
        `
      SELECT m.*,
        CASE 
          WHEN m.sender_type = 'character' THEN c.name
          WHEN m.sender_type = 'user' THEN p.name
          ELSE 'System'
        END AS sender_name
      FROM messages m
      LEFT JOIN characters c ON m.sender_id = c.id
      LEFT JOIN personas p ON m.sender_id = p.id
      WHERE m.session_id = ? AND m.is_canonical = 1
      ORDER BY m.created_at DESC
      LIMIT ?
    `,
      )
      .all(params.sessionId, limit) as any[];

    if (recentMsgs.length === 0) {
      return [];
    }

    const chronological = [...recentMsgs].reverse();
    const latestTurnId = params.sourceTurnId || chronological[chronological.length - 1]?.id || null;

    // Gather existing memories in this session to avoid re-extracting known facts
    const existingMemories = this.db
      .prepare(
        `
      SELECT memory_text FROM episodic_memories
      WHERE user_id = ? AND (session_id = ? OR scope = 'user')
      ORDER BY created_at DESC LIMIT 20
    `,
      )
      .all(params.userId, params.sessionId) as { memory_text: string }[];

    const existingListText =
      existingMemories.length > 0
        ? existingMemories.map((m) => `- ${m.memory_text}`).join('\n')
        : '(None yet)';

    const transcriptText = chronological
      .map((m) => `${m.sender_name || m.sender_type}: ${m.content}`)
      .join('\n\n');

    const charName = session.character_name || 'Companion';
    const personaName = session.persona_name || 'User';

    const extractionPrompt = `
You are an episodic memory extraction engine for a roleplay session between ${personaName} (the user persona) and ${charName} (the AI character).

EXISTING MEMORIES ALREADY RECORDED:
${existingListText}

RECENT CONVERSATION TURNS:
${transcriptText}

TASK:
Extract 1 to 3 NEW, durable episodic memories from the recent conversation turns above.
Focus on:
1. Important facts, secrets, personal history, or preferences revealed by ${personaName} or ${charName}.
2. Significant plot developments, promises, quests, locations visited, or items acquired/used.
3. Shifts in relationship dynamics, trust, or emotional milestones between ${personaName} and ${charName}.

RULES:
- Write each memory as a concise, standalone third-person factual statement (1 sentence, 10 to 35 words) explicitly naming ${personaName} and/or ${charName}.
- Do NOT duplicate facts already listed in EXISTING MEMORIES.
- Assign an importance score from 1 (minor detail) to 10 (critical plot/relationship milestone).
- Respond ONLY with a valid JSON array of objects in this exact format:
[
  { "memory_text": "...", "importance": 7 }
]
If no new durable facts occurred, return an empty JSON array: []
`.trim();

    let extractedCandidates: { memory_text: string; importance: number }[] = [];

    // 1. Try LLM extraction (Local llama.cpp or Wiro Chat Model)
    try {
      const rawLlmOutput = await this.runExtractionLlm(session.chat_model, extractionPrompt, params.userId);
      extractedCandidates = this.parseExtractedMemoriesJson(rawLlmOutput);
    } catch (err: any) {
      this.logger.warn(`LLM memory extraction fallback triggered: ${err.message}`);
    }

    // 2. Deterministic Heuristic Extraction Fallback if LLM returned nothing or was unavailable
    if (extractedCandidates.length === 0) {
      extractedCandidates = this.heuristicExtractFromTurns(chronological, personaName, charName);
    }

    const savedMemories: EpisodicMemoryItem[] = [];
    for (const candidate of extractedCandidates.slice(0, 3)) {
      const cleanFact = (candidate.memory_text || '').trim();
      if (cleanFact.length < 12) continue;

      try {
        const created = await this.createMemory(params.userId, {
          sessionId: params.sessionId,
          characterId: session.character_id,
          memoryText: cleanFact,
          scope: 'session',
          importance: candidate.importance ?? 6,
          sourceTurnId: latestTurnId,
        });
        savedMemories.push(created);
      } catch (err: any) {
        this.logger.warn(`Could not store extracted memory "${cleanFact}": ${err.message}`);
      }
    }

    if (savedMemories.length > 0) {
      this.logger.log(
        `[Episodic Memory] Extracted & embedded ${savedMemories.length} memory item(s) for session ${params.sessionId}.`,
      );
    }

    return savedMemories;
  }

  private async runExtractionLlm(
    chatModel: string,
    prompt: string,
    userId: string,
  ): Promise<string> {
    // Prefer local llama.cpp if active model is local
    if (this.modelsService.isLocalLlmModel(chatModel)) {
      const baseUrl = this.modelsService.getLocalLlmBaseUrl();
      const resolvedModelId = this.modelsService.resolveLocalModelId(chatModel);
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: resolvedModelId,
          messages: [
            {
              role: 'system',
              content:
                'You extract concise third-person episodic memories from roleplay dialogue and output strictly valid JSON arrays.',
            },
            { role: 'user', content: prompt },
          ],
          stream: false,
          temperature: 0.3,
        }),
      });

      if (!res.ok) {
        throw new Error(`Local llama.cpp status ${res.status}`);
      }
      const data = await res.json();
      return data?.choices?.[0]?.message?.content || '';
    }

    // Otherwise check if local llama.cpp is available on localhost:8080 as a zero-cost background extractor
    try {
      const baseUrl = this.modelsService.getLocalLlmBaseUrl();
      const modelsRes = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(1500) });
      if (modelsRes.ok) {
        const modelsData = await modelsRes.json();
        const firstLocalModel = modelsData?.data?.[0]?.id;
        if (firstLocalModel) {
          const res = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: firstLocalModel,
              messages: [
                {
                  role: 'system',
                  content:
                    'You extract concise third-person episodic memories from roleplay dialogue and output strictly valid JSON arrays.',
                },
                { role: 'user', content: prompt },
              ],
              stream: false,
              temperature: 0.3,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            const content = data?.choices?.[0]?.message?.content;
            if (typeof content === 'string' && content.trim()) {
              return content.trim();
            }
          }
        }
      }
    } catch {}

    // Fallback to Wiro API if user has a Wiro key
    const apiKey = this.authService.getDecryptedWiroKey(userId);
    if (!apiKey) {
      throw new Error('No Wiro API key configured for LLM extraction');
    }

    const [slugowner, slugproject] = chatModel.includes('/')
      ? chatModel.split('/')
      : ['openai', chatModel];
    const url = `https://api.wiro.ai/v1/Run/${encodeURIComponent(slugowner)}/${encodeURIComponent(slugproject)}/sync`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey.trim(),
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content:
              'You extract concise third-person episodic memories from roleplay dialogue and output strictly valid JSON arrays.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`Wiro extraction HTTP ${res.status}`);
    }
    const data = await res.json();
    const task = data?.tasklist?.[0];
    const outContent = task?.outputs?.[0]?.content;
    if (typeof outContent === 'string') return outContent;
    if (outContent?.raw) return outContent.raw;
    if (Array.isArray(outContent?.answer)) return outContent.answer.join('\n');
    if (typeof task?.debugoutput === 'string') return task.debugoutput;
    return JSON.stringify(data);
  }

  private parseExtractedMemoriesJson(rawText: string): { memory_text: string; importance: number }[] {
    if (!rawText) return [];
    const cleaned = rawText
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    const startIdx = cleaned.indexOf('[');
    const endIdx = cleaned.lastIndexOf(']');
    if (startIdx !== -1 && endIdx > startIdx) {
      try {
        const arr = JSON.parse(cleaned.slice(startIdx, endIdx + 1));
        if (Array.isArray(arr)) {
          return arr
            .filter((item) => item && typeof (item.memory_text || item.fact || item.text) === 'string')
            .map((item) => ({
              memory_text: String(item.memory_text || item.fact || item.text).trim(),
              importance: Number(item.importance) || 6,
            }));
        }
      } catch {}
    }

    return [];
  }

  private heuristicExtractFromTurns(
    turns: any[],
    personaName: string,
    charName: string,
  ): { memory_text: string; importance: number }[] {
    const results: { memory_text: string; importance: number }[] = [];
    const lastTwo = turns.slice(-2);

    for (const t of lastTwo) {
      const speaker = t.sender_type === 'user' ? personaName : charName;
      const listener = t.sender_type === 'user' ? charName : personaName;
      const raw = String(t.content || '').replace(/\s+/g, ' ').trim();
      if (raw.length < 20) continue;

      // Extract actions inside *...* or spoken sentences inside "..."
      const actionMatch = raw.match(/\*([^*]{15,140})\*/);
      const quoteMatch = raw.match(/(?:“|")([^“”"]{15,160})(?:”|")/);

      if (quoteMatch && quoteMatch[1]) {
        const snippet = quoteMatch[1].trim();
        results.push({
          memory_text: `${speaker} told ${listener}: "${snippet}"`,
          importance: t.sender_type === 'user' ? 7 : 6,
        });
      } else if (actionMatch && actionMatch[1]) {
        results.push({
          memory_text: `${speaker} ${actionMatch[1].trim()} during their interaction with ${listener}.`,
          importance: 5,
        });
      } else {
        const clipped = raw.length > 140 ? `${raw.slice(0, 137)}...` : raw;
        results.push({
          memory_text: `${speaker} shared with ${listener}: ${clipped}`,
          importance: 6,
        });
      }
    }

    return results.slice(0, 2);
  }
}
