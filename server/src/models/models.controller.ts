import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { ModelsService } from './models.service.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { AuthService } from '../auth/auth.service.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';

@ApiTags('models')
@Controller('models')
export class ModelsController {
  constructor(
    private readonly modelsService: ModelsService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Browse shared Wiro.ai models catalog (filtered by category or search)' })
  @ApiQuery({ name: 'type', required: false, enum: ['all', 'chat', 'text-to-image', 'image-to-image', 'video', 'voice', 'other'] })
  @ApiQuery({ name: 'q', required: false, type: String, description: 'Search title, provider, or description' })
  getCatalog(@Query('type') type?: string, @Query('q') query?: string) {
    return this.modelsService.getCatalog(type, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get total models count and category breakdown' })
  getStats() {
    return this.modelsService.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get detailed model configuration, parameter schema, and documentation' })
  getModelDetails(@Param('id') id: string) {
    return this.modelsService.getModelDetails(id);
  }

  @Post('refresh')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin only: Synchronize and refresh available models from Wiro.ai using Admin API key' })
  async refreshCatalog(@Req() req: AuthenticatedRequest) {
    const adminApiKey = this.authService.getDecryptedWiroKey(req.user.userId);
    if (!adminApiKey) {
      throw new HttpException(
        'Admin Wiro.ai API key is missing. Please save your personal Wiro.ai API key in your profile first.',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      return await this.modelsService.refreshCatalog(adminApiKey);
    } catch (err: any) {
      throw new HttpException(`Failed to refresh Wiro.ai models: ${err.message}`, HttpStatus.BAD_GATEWAY);
    }
  }
}
