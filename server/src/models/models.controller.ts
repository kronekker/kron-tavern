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
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { ModelsService, BILLING_METHODS_REFERENCE } from './models.service.js';
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

  @Get('billing-reference')
  @ApiOperation({ summary: 'Get reference guide and explanations for all Wiro billing methods (cpr, cps, cpo, cpt, etc.)' })
  getBillingReference() {
    return {
      methods: BILLING_METHODS_REFERENCE,
    };
  }

  @Get('cached-slugs')
  @ApiOperation({ summary: 'Get list of model slugs currently cached on local disk in data/models/' })
  getCachedSlugs() {
    return {
      cachedSlugs: this.modelsService.getCachedSlugs(),
    };
  }

  @Get('detail')
  @ApiOperation({
    summary:
      'Get full details for a model by slugowner and slugproject. Caches result to data/models/{owner}/{project}.json on disk. If cached, serves from disk unless refresh=true.',
  })
  @ApiQuery({ name: 'slugowner', required: true, type: String, example: 'google' })
  @ApiQuery({ name: 'slugproject', required: true, type: String, example: 'nano-banana-2-lite' })
  @ApiQuery({ name: 'refresh', required: false, type: Boolean, example: false })
  async getModelDetail(
    @Query('slugowner') slugowner: string,
    @Query('slugproject') slugproject: string,
    @Query('refresh') refresh?: string | boolean,
  ) {
    if (!slugowner || !slugproject) {
      throw new BadRequestException('Both slugowner and slugproject query parameters are required.');
    }

    const shouldRefresh = refresh === true || refresh === 'true' || refresh === '1';

    try {
      return await this.modelsService.getOrFetchDetail(slugowner, slugproject, shouldRefresh);
    } catch (err: any) {
      throw new HttpException(
        `Failed to retrieve model detail for '${slugowner}/${slugproject}': ${err.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get detailed model configuration by ID' })
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
