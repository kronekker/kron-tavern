import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { CryptoService, AuthTokenPayload } from './crypto.service.js';

export interface AuthenticatedRequest extends Request {
  user: AuthTokenPayload;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly cryptoService: CryptoService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header.');
    }

    const token = authHeader.slice(7).trim();
    const payload = this.cryptoService.verifyToken(token);

    if (!payload) {
      throw new UnauthorizedException('Token is invalid or has expired.');
    }

    request.user = payload;
    return true;
  }
}
