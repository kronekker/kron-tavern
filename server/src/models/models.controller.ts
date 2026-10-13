import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpException,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import {
  ModelsService,
  BILLING_METHODS_REFERENCE,
  type DefaultModelsConfig,
  type UserPreferredModels,
} from './models.service.js';
import { AdminGuard } from '../auth/admin.guard.js';
import { AuthService } from '../auth/auth.service.js';
import {
  AuthGuard,
  OptionalAuthGuard,
  type AuthenticatedRequest,
  type OptionalAuthenticatedRequest,
} from '../auth/auth.guard.js';

export class UpdateSystemDefaultsDto {
  chatModel?: string;
  textToImageModel?: string;
  imageToImageModel?: string;
}

export class UpdateUserPreferredModelsDto {
  chatModel?: string | null;
  textToImageModel?: string | null;
  imageToImageModel?: string | null;
}

@ApiTags('models')
@Controller('models')
export class ModelsController {
  constructor(
    private readonly modelsService: ModelsService,
    private readonly authService: AuthService,
  ) {}

  @Get('defaults')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary:
      'Get resolved multimodal default models (Chat, Avatar T2I, Scenes I2I) combining tavern admin defaults and user personal overrides',
  })
  getDefaults(@Req() req: OptionalAuthenticatedRequest) {
    return this.modelsService.getActiveModels(req.user?.userId);
  }

  @Put('defaults/system')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Admin only: Update tavern-wide default AI models for Chat LLM, Text-to-Image avatar, and Image-to-Image scenes',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        chatModel: { type: 'string', example: 'openai/gpt-6.1-sol' },
        textToImageModel: { type: 'string', example: 'google/nano banana 2.1 advanced' },
        imageToImageModel: { type: 'string', example: 'wiro-partners/qwen image edit uncensored' },
      },
    },
  })
  updateSystemDefaults(@Body() body: UpdateSystemDefaultsDto) {
    return this.modelsService.setSystemDefaultModels(body);
  }

  @Put('defaults/user')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'User preferred AI models: set personal preferred model overrides (pass null or empty string to revert to tavern admin default)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        chatModel: { type: 'string', nullable: true, example: 'claude/opus 5.5' },
        textToImageModel: { type: 'string', nullable: true, example: null },
        imageToImageModel: { type: 'string', nullable: true, example: null },
      },
    },
  })
  updateUserDefaults(@Req() req: AuthenticatedRequest, @Body() body: UpdateUserPreferredModelsDto) {
    this.authService.updatePreferredModels(req.user.userId, body);
    return this.modelsService.getActiveModels(req.user.userId);
  }


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

  @Get('categories')
  @ApiOperation({ summary: 'Get selected and all available categories for model synchronization' })
  getCategories() {
    return this.modelsService.getCategoryMetadata();
  }

  @Put('categories')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin only: Update selected categories to include in synchronization' })
  updateCategories(@Body() body: { categories: string[] }) {
    if (!body || !Array.isArray(body.categories) || body.categories.length === 0) {
      throw new BadRequestException('A non-empty "categories" array of strings is required.');
    }
    return this.modelsService.updateSelectedCategories(body.categories);
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
  async refreshCatalog(
    @Req() req: AuthenticatedRequest,
    @Body() body?: { categories?: string[] },
  ) {
    const adminApiKey = this.authService.getDecryptedWiroKey(req.user.userId);
    if (!adminApiKey) {
      throw new HttpException(
        'Admin Wiro.ai API key is missing. Please save your personal Wiro.ai API key in your profile first.',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      return await this.modelsService.refreshCatalog(adminApiKey, body?.categories);
    } catch (err: any) {
      throw new HttpException(`Failed to refresh Wiro.ai models: ${err.message}`, HttpStatus.BAD_GATEWAY);
    }
  }
}
