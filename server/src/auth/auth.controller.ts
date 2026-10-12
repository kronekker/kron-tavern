import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './auth.guard.js';
import type { AuthenticatedRequest } from './auth.guard.js';
import { DatabaseService } from '../database/database.service.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly dbService: DatabaseService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Get instance setup status (e.g. whether any admin has registered)' })
  getStatus() {
    const db = this.dbService.getDb();
    const countRow = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    return {
      hasUsers: countRow.count > 0,
      totalUsers: countRow.count,
    };
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register new user account (The very first registered user becomes Admin)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', example: 'player@example.com' },
        username: { type: 'string', example: 'wanderer' },
        password: { type: 'string', example: 'password123' },
      },
      required: ['email', 'username', 'password'],
    },
  })
  register(@Body() body: { email: string; username: string; password: string }) {
    return this.authService.register(body.email, body.username, body.password);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email/username and password' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        login: { type: 'string', example: 'player@example.com' },
        password: { type: 'string', example: 'password123' },
      },
      required: ['login', 'password'],
    },
  })
  login(@Body() body: { login: string; password: string }) {
    return this.authService.login(body.login, body.password);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retrieve profile and entitlements for current authenticated user' })
  getProfile(@Req() req: AuthenticatedRequest) {
    return this.authService.getUserProfile(req.user.userId);
  }

  @Put('openrouter-key')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Save user personal OpenRouter API key (encrypted at rest)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        apiKey: { type: 'string', example: 'sk-or-v1-...' },
      },
      required: ['apiKey'],
    },
  })
  saveApiKey(@Req() req: AuthenticatedRequest, @Body('apiKey') apiKey: string) {
    return this.authService.setOpenRouterKey(req.user.userId, apiKey);
  }

  @Delete('openrouter-key')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove saved OpenRouter API key' })
  deleteApiKey(@Req() req: AuthenticatedRequest) {
    return this.authService.clearOpenRouterKey(req.user.userId);
  }
}
