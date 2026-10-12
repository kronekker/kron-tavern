import { Module, Global } from '@nestjs/common';
import { CryptoService } from './crypto.service.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AdminGuard } from './admin.guard.js';

@Global()
@Module({
  providers: [CryptoService, AuthService, AuthGuard, AdminGuard],
  controllers: [AuthController],
  exports: [CryptoService, AuthService, AuthGuard, AdminGuard],
})
export class AuthModule {}
