import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '../database/database.module.js';
import { DatabaseService } from '../database/database.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { ModelsModule } from '../models/models.module.js';
import { SessionsService } from './sessions.service.js';
import { randomBytes } from 'node:crypto';

describe('SessionsService', () => {
  let service: SessionsService;
  let dbService: DatabaseService;
  let testUserId: string;
  let testCharacterId: string;
  let testPersonaId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule, AuthModule, ModelsModule],
      providers: [SessionsService],
    }).compile();

    await module.init();

    service = module.get<SessionsService>(SessionsService);
    dbService = module.get<DatabaseService>(DatabaseService);

    const db = dbService.getDb();
    testUserId = `test_user_${randomBytes(6).toString('hex')}`;
    testCharacterId = `test_char_${randomBytes(6).toString('hex')}`;
    testPersonaId = `test_pers_${randomBytes(6).toString('hex')}`;

    // Seed test user
    db.prepare(`
      INSERT INTO users (id, email, password_hash, username, is_admin, created_at, updated_at)
      VALUES (?, ?, 'hash', 'TestRoleplayer', 0, datetime('now'), datetime('now'))
    `).run(testUserId, `${testUserId}@example.com`);

    // Seed test character
    db.prepare(`
      INSERT INTO characters (id, creator_id, name, tagline, greeting, system_prompt, scenario, is_public, created_at, updated_at)
      VALUES (?, ?, 'Lyra the Alchemist', 'Seeker of celestial truth', 'Greetings, traveler. Mind the phosphorus.', 'You are Lyra.', 'In the laboratory', 1, datetime('now'), datetime('now'))
    `).run(testCharacterId, testUserId);

    // Seed test persona
    db.prepare(`
      INSERT INTO personas (id, user_id, name, description, is_default, created_at, updated_at)
      VALUES (?, ?, 'Valen', 'A pragmatic rogue interested in rare alchemical solvents.', 1, datetime('now'), datetime('now'))
    `).run(testPersonaId, testUserId);

    // Seed keyword memory
    db.prepare(`
      INSERT INTO keyword_memories (id, scope, character_id, user_id, keywords, title, content, priority, is_active, created_at, updated_at)
      VALUES ('kw_test_1', 'character', ?, ?, 'phosphorus,solvent,alchemical', 'Phosphorus Precautions', 'Phosphorus flares violently when exposed to lunar oil.', 80, 1, datetime('now'), datetime('now'))
    `).run(testCharacterId, testUserId);
  });

  afterAll(() => {
    const db = dbService.getDb();
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(testUserId);
    db.prepare('DELETE FROM keyword_memories WHERE character_id = ?').run(testCharacterId);
    db.prepare('DELETE FROM personas WHERE user_id = ?').run(testUserId);
    db.prepare('DELETE FROM characters WHERE id = ?').run(testCharacterId);
    db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
  });

  it('should create a session with initial greeting as canonical turn 0', () => {
    const result = service.createSession(testUserId, {
      characterId: testCharacterId,
      personaId: testPersonaId,
      title: 'Testing the Crucible',
    });

    expect(result.session).toBeDefined();
    expect(result.session.character_name).toBe('Lyra the Alchemist');
    expect(result.session.persona_name).toBe('Valen');
    expect(result.initialMessage).toBeDefined();
    expect(result.initialMessage.sender_type).toBe('character');
    expect(result.initialMessage.content).toBe('Greetings, traveler. Mind the phosphorus.');
    expect(result.initialMessage.is_canonical).toBe(1);

    const details = service.getSessionDetails(result.session.id, testUserId);
    expect(details.messages.length).toBe(1);
    expect(details.messages[0].content).toContain('Mind the phosphorus');
  });

  it('should execute a turn with streaming tokens, lore retrieval, and trace persistence', async () => {
    const { session } = service.createSession(testUserId, {
      characterId: testCharacterId,
      personaId: testPersonaId,
    });

    const tokens: string[] = [];
    const turnResult = await service.executeTurn(
      session.id,
      testUserId,
      'Tell me more about the phosphorus reaction.',
      (token) => tokens.push(token),
    );

    expect(turnResult.message).toBeDefined();
    expect(turnResult.message.sender_type).toBe('character');
    expect(tokens.length).toBeGreaterThan(0);
    expect(turnResult.trace).toBeDefined();
    expect(turnResult.trace.total_tokens).toBeGreaterThan(0);
    expect(turnResult.trace.triggered_keywords_json).toContain('Phosphorus Precautions');

    // Verify trace retrieval
    const fetchedTrace = service.getTurnTrace(session.id, turnResult.message.id, testUserId);
    expect(fetchedTrace).toBeDefined();
    expect(fetchedTrace?.model_used).toBe(session.chat_model);

    // Verify history now has 3 messages (Greeting, User, Companion)
    const details = service.getSessionDetails(session.id, testUserId);
    expect(details.messages.length).toBe(3);
  });

  it('should suggest user reply in persona perspective', async () => {
    const { session } = service.createSession(testUserId, {
      characterId: testCharacterId,
      personaId: testPersonaId,
    });

    const suggestion = await service.suggestUserReply(session.id, testUserId);
    expect(suggestion.suggestedText).toBeDefined();
    expect(suggestion.suggestedText.length).toBeGreaterThan(5);
  });

  it('should edit a message inline', () => {
    const { session, initialMessage } = service.createSession(testUserId, {
      characterId: testCharacterId,
      personaId: testPersonaId,
    });

    const edited = service.editMessage(
      session.id,
      initialMessage.id,
      testUserId,
      'Welcome to the alchemical laboratory, Valen.',
    );

    expect(edited.content).toBe('Welcome to the alchemical laboratory, Valen.');

    const details = service.getSessionDetails(session.id, testUserId);
    expect(details.messages[0].content).toBe('Welcome to the alchemical laboratory, Valen.');
  });

  it('should reroll character turn with guidance and link reroll_parent_id', async () => {
    const { session } = service.createSession(testUserId, {
      characterId: testCharacterId,
      personaId: testPersonaId,
    });

    // Execute first user turn
    const firstTurn = await service.executeTurn(
      session.id,
      testUserId,
      'What reagents do we have?',
      () => {},
    );

    // Now reroll latest character turn
    const rerollTokens: string[] = [];
    const rerollResult = await service.rerollTurn(
      session.id,
      testUserId,
      'Speak in a whisper',
      (t) => rerollTokens.push(t),
    );

    expect(rerollResult.message).toBeDefined();
    expect(rerollResult.message.reroll_parent_id).toBe(firstTurn.message.id);
    expect(rerollTokens.length).toBeGreaterThan(0);

    // Message list should still have exactly 3 canonical messages (Greeting, User, New Companion turn)
    const details = service.getSessionDetails(session.id, testUserId);
    expect(details.messages.length).toBe(3);
    expect(details.messages[2].id).toBe(rerollResult.message.id);
  });

  it('should create context boundary compression and allow editing summary', () => {
    const { session, initialMessage } = service.createSession(testUserId, {
      characterId: testCharacterId,
      personaId: testPersonaId,
    });

    const compression = service.triggerCompression(
      session.id,
      testUserId,
      initialMessage.id,
      'Valen entered the laboratory and met Lyra.',
    );

    expect(compression).toBeDefined();
    expect(compression.summary_text).toBe('Valen entered the laboratory and met Lyra.');
    expect(compression.token_count_after).toBeGreaterThan(0);

    // Verify session updated with active compression
    const details = service.getSessionDetails(session.id, testUserId);
    expect(details.session.active_compression_id).toBe(compression.id);
    expect(details.compression?.summary_text).toBe('Valen entered the laboratory and met Lyra.');

    // Edit compression summary
    const updated = service.updateCompressionSummary(
      session.id,
      compression.id,
      testUserId,
      'Valen and Lyra agreed to collaborate on celestial distillation.',
    );

    expect(updated.summary_text).toBe('Valen and Lyra agreed to collaborate on celestial distillation.');
  });

  it('should rewind conversation to a message, erasing downstream turns', async () => {
    const { session, initialMessage } = service.createSession(testUserId, {
      characterId: testCharacterId,
      personaId: testPersonaId,
    });

    // Add 2 user turns
    await service.executeTurn(session.id, testUserId, 'Turn 1', () => {});
    await service.executeTurn(session.id, testUserId, 'Turn 2', () => {});

    let details = service.getSessionDetails(session.id, testUserId);
    expect(details.messages.length).toBe(5); // Greeting + 2*(User + Assistant)

    // Rewind back to initial greeting
    const rewindRes = service.rewindSession(session.id, initialMessage.id, testUserId);
    expect(rewindRes.success).toBe(true);
    expect(rewindRes.erasedCount).toBe(4);

    details = service.getSessionDetails(session.id, testUserId);
    expect(details.messages.length).toBe(1);
    expect(details.messages[0].id).toBe(initialMessage.id);
  });
});
