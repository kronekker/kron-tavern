import { Injectable } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';

export interface AuthTokenPayload {
  userId: string;
  email: string;
  username: string;
  isAdmin: boolean;
  exp: number;
}

@Injectable()
export class CryptoService {
  private readonly jwtSecret: Buffer;
  private readonly encryptionSecret: Buffer;

  constructor() {
    // Load or generate deterministic secrets for JWT and at-rest key encryption
    const secretEnv = process.env.APP_SECRET || 'kron-tavern-default-super-secret-key-32b!';
    // Ensure 32 bytes for AES-256 and HMAC
    this.jwtSecret = scryptSync(secretEnv, 'jwt-salt', 32);
    this.encryptionSecret = scryptSync(secretEnv, 'aes-salt', 32);
  }

  // --- Password Hashing with scrypt ---
  hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${derivedKey}`;
  }

  verifyPassword(password: string, storedHash: string): boolean {
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) return false;
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedBuffer = scryptSync(password, salt, 64);
    return timingSafeEqual(keyBuffer, derivedBuffer);
  }

  // --- Zero-Dependency HMAC-SHA256 JWT Tokens ---
  generateToken(payload: Omit<AuthTokenPayload, 'exp'>, expiresInSeconds = 7 * 24 * 3600): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');

    const signature = this.hmacSign(`${header}.${body}`);
    return `${header}.${body}.${signature}`;
  }

  verifyToken(token: string): AuthTokenPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [header, body, signature] = parts;

      const expectedSignature = this.hmacSign(`${header}.${body}`);
      const sigBuf = Buffer.from(signature);
      const expSigBuf = Buffer.from(expectedSignature);

      if (sigBuf.length !== expSigBuf.length || !timingSafeEqual(sigBuf, expSigBuf)) {
        return null;
      }

      const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as AuthTokenPayload;
      if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
        return null; // Expired
      }
      return decoded;
    } catch {
      return null;
    }
  }

  private hmacSign(data: string): string {
    const crypto = Buffer.from(
      scryptSync(data, this.jwtSecret, 32).toString('base64url'),
    );
    return crypto.toString('base64url');
  }

  // --- AES-256-GCM Encryption for API Keys at Rest ---
  encrypt(text: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionSecret, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  decrypt(encryptedData: string): string {
    const [ivHex, authTagHex, encryptedText] = encryptedData.split(':');
    if (!ivHex || !authTagHex || !encryptedText) {
      throw new Error('Malformed encrypted data.');
    }
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionSecret, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
