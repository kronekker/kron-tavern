import { Injectable, ConflictException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service.js';
import { CryptoService, AuthTokenPayload } from './crypto.service.js';

export interface UserResponse {
  id: string;
  email: string;
  username: string;
  isAdmin: boolean;
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

    // First registered user is automatically Admin!
    const userCountRow = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    const isAdmin = userCountRow.count === 0 ? 1 : 0;

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

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        isAdmin,
        hasOpenRouterKey: !!user.openrouter_key_encrypted,
        settings,
        createdAt: user.created_at,
      },
    };
  }

  getUserProfile(userId: string): UserResponse {
    const db = this.dbService.getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    let settings = {};
    try {
      settings = JSON.parse(user.settings_json || '{}');
    } catch {
      settings = {};
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      isAdmin: user.is_admin === 1,
      hasOpenRouterKey: !!user.openrouter_key_encrypted,
      settings,
      createdAt: user.created_at,
    };
  }

  setOpenRouterKey(userId: string, apiKey: string): { success: boolean; message: string } {
    const db = this.dbService.getDb();
    const encrypted = this.cryptoService.encrypt(apiKey.trim());

    db.prepare('UPDATE users SET openrouter_key_encrypted = ?, updated_at = datetime("now") WHERE id = ?').run(
      encrypted,
      userId,
    );

    return { success: true, message: 'OpenRouter API key encrypted and saved.' };
  }

  clearOpenRouterKey(userId: string): { success: boolean; message: string } {
    const db = this.dbService.getDb();
    db.prepare('UPDATE users SET openrouter_key_encrypted = NULL, updated_at = datetime("now") WHERE id = ?').run(
      userId,
    );
    return { success: true, message: 'OpenRouter API key removed.' };
  }

  getDecryptedOpenRouterKey(userId: string): string | null {
    const db = this.dbService.getDb();
    const row = db.prepare('SELECT openrouter_key_encrypted FROM users WHERE id = ?').get(userId) as any;
    if (!row || !row.openrouter_key_encrypted) return null;
    return this.cryptoService.decrypt(row.openrouter_key_encrypted);
  }
}
