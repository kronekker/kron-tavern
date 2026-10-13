import { Injectable, ConflictException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { CryptoService, AuthTokenPayload } from './crypto.service.js';

export interface UserResponse {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
  hasWiroKey: boolean;
  hasOpenRouterKey: boolean;
  settings: Record<string, any>;
  createdAt: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly cryptoService: CryptoService,
  ) {}

  register(email: string, username: string, password: string): { token: string; user: UserResponse } {
    const db = this.dbService.getDb();
    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim();

    if (!cleanEmail || !cleanUsername || !password) {
      throw new ConflictException('Email, username, and password are required.');
    }

    if (password.length < 6) {
      throw new ConflictException('Password must be at least 6 characters.');
    }

    // Check if email or username exists
    const existing = db
      .prepare('SELECT id FROM users WHERE email = ? OR username = ?')
      .get(cleanEmail, cleanUsername);

    if (existing) {
      throw new ConflictException('An account with this email or username already exists.');
    }

    // First registered real user (ignoring demo fixtures) is automatically Admin!
    const adminCountRow = db
      .prepare("SELECT COUNT(*) AS count FROM users WHERE is_admin = 1 AND id NOT LIKE 'user_demo_%'")
      .get() as { count: number };
    const isAdmin = adminCountRow.count === 0 ? 1 : 0;

    const id = `user_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const passwordHash = this.cryptoService.hashPassword(password);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO users (id, email, username, password_hash, is_admin, settings_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '{}', ?, ?)
    `).run(id, cleanEmail, cleanUsername, passwordHash, isAdmin, now, now);

    const token = this.cryptoService.generateToken({
      userId: id,
      email: cleanEmail,
      username: cleanUsername,
      isAdmin: isAdmin === 1,
    });

    return {
      token,
      user: {
        id,
        email: cleanEmail,
        username: cleanUsername,
        isAdmin: isAdmin === 1,
        hasWiroKey: false,
        hasOpenRouterKey: false,
        settings: {},
        createdAt: now,
      },
    };
  }

  login(loginHandle: string, password: string): { token: string; user: UserResponse } {
    const db = this.dbService.getDb();
    const cleanHandle = loginHandle.trim().toLowerCase();

    const user = db
      .prepare('SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?')
      .get(cleanHandle, cleanHandle) as any;

    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const isValid = this.cryptoService.verifyPassword(password, user.password_hash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const isAdmin = user.is_admin === 1;
    const token = this.cryptoService.generateToken({
      userId: user.id,
      email: user.email,
      username: user.username,
      isAdmin,
    });

    let settings = {};
    try {
      settings = JSON.parse(user.settings_json || '{}');
    } catch {
      settings = {};
    }

    const hasKey = !!(user.wiro_key_encrypted || user.openrouter_key_encrypted);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        isAdmin,
        hasWiroKey: hasKey,
        hasOpenRouterKey: hasKey,
        settings,
        createdAt: user.created_at,
      },
    };
  }

  getUserProfile(userId: string): UserResponse {
    const db = this.dbService.getDb();
    let user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    // Self-healing: if no real admin exists in instance, automatically promote this real user
    const adminCountRow = db
      .prepare("SELECT COUNT(*) AS count FROM users WHERE is_admin = 1 AND id NOT LIKE 'user_demo_%'")
      .get() as { count: number };
    if (adminCountRow.count === 0 && !userId.startsWith('user_demo_')) {
      db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(userId);
      user.is_admin = 1;
    }

    let settings = {};
    try {
      settings = JSON.parse(user.settings_json || '{}');
    } catch {
      settings = {};
    }

    const hasKey = !!(user.wiro_key_encrypted || user.openrouter_key_encrypted);

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      isAdmin: user.is_admin === 1,
      hasWiroKey: hasKey,
      hasOpenRouterKey: hasKey,
      settings,
      createdAt: user.created_at,
    };
  }

  setWiroKey(userId: string, apiKey: string): { success: boolean; message: string } {
    const db = this.dbService.getDb();
    const encrypted = this.cryptoService.encrypt(apiKey.trim());

    db.prepare('UPDATE users SET wiro_key_encrypted = ?, openrouter_key_encrypted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      encrypted,
      encrypted,
      userId,
    );

    return { success: true, message: 'Wiro.ai API key encrypted and saved.' };
  }

  clearWiroKey(userId: string): { success: boolean; message: string } {
    const db = this.dbService.getDb();
    db.prepare('UPDATE users SET wiro_key_encrypted = NULL, openrouter_key_encrypted = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      userId,
    );
    return { success: true, message: 'Wiro.ai API key removed.' };
  }

  getDecryptedWiroKey(userId: string): string | null {
    const db = this.dbService.getDb();
    const row = db.prepare('SELECT wiro_key_encrypted, openrouter_key_encrypted FROM users WHERE id = ?').get(userId) as any;
    if (!row) return null;
    const key = row.wiro_key_encrypted || row.openrouter_key_encrypted;
    if (!key) return null;
    return this.cryptoService.decrypt(key);
  }

  setOpenRouterKey(userId: string, apiKey: string) {
    return this.setWiroKey(userId, apiKey);
  }

  clearOpenRouterKey(userId: string) {
    return this.clearWiroKey(userId);
  }

  getDecryptedOpenRouterKey(userId: string) {
    return this.getDecryptedWiroKey(userId);
  }

  updatePreferredModels(
    userId: string,
    preferred: { chatModel?: string | null; textToImageModel?: string | null; imageToImageModel?: string | null },
  ): UserResponse {
    const db = this.dbService.getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    let settings: Record<string, any> = {};
    try {
      settings = JSON.parse(user.settings_json || '{}');
    } catch {
      settings = {};
    }

    const currentPreferred = (settings.preferredModels as Record<string, any>) || {};
    const newPreferred: Record<string, string | null> = { ...currentPreferred };

    if (preferred.chatModel !== undefined) {
      newPreferred['chatModel'] = preferred.chatModel ? preferred.chatModel.trim() : null;
    }
    if (preferred.textToImageModel !== undefined) {
      newPreferred['textToImageModel'] = preferred.textToImageModel ? preferred.textToImageModel.trim() : null;
    }
    if (preferred.imageToImageModel !== undefined) {
      newPreferred['imageToImageModel'] = preferred.imageToImageModel ? preferred.imageToImageModel.trim() : null;
    }

    settings.preferredModels = newPreferred;
    const settingsJson = JSON.stringify(settings);

    db.prepare('UPDATE users SET settings_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      settingsJson,
      userId,
    );

    return this.getUserProfile(userId);
  }
}

