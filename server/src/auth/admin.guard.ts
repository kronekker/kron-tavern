import { CanActivate, ExecutionContext, Injectable, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { CryptoService } from './crypto.service.js';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly cryptoService: CryptoService,
    private readonly dbService: DatabaseService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const db = this.dbService.getDb();
    const countRow = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };

    // If no users have been registered yet, allow initial configuration
    if (countRow.count === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication required to access admin endpoints.');
    }

    const token = authHeader.slice(7).trim();
    const payload = this.cryptoService.verifyToken(token);

    if (!payload) {
      throw new UnauthorizedException('Token is invalid or expired.');
    }

    const userRow = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(payload.userId) as any;
    if (!userRow || userRow.is_admin !== 1) {
      throw new ForbiddenException('Admin entitlements required for this action.');
    }

    request.user = { ...payload, isAdmin: true };
    return true;
  }
}
