import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import {
  MemoryService,
  type CreateEpisodicMemoryDto,
  type UpdateEpisodicMemoryDto,
} from './memory.service.js';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';

@ApiTags('memory')
@Controller('memories')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get()
  @ApiOperation({
    summary: 'List episodic memories for the current user (filtered by sessionId, characterId, or scope)',
  })
  @ApiQuery({ name: 'sessionId', required: false, type: String })
  @ApiQuery({ name: 'characterId', required: false, type: String })
  @ApiQuery({ name: 'scope', required: false, enum: ['session', 'user', 'all'] })
  list(
    @Req() req: AuthenticatedRequest,
    @Query('sessionId') sessionId?: string,
    @Query('characterId') characterId?: string,
    @Query('scope') scope?: 'session' | 'user' | 'all',
  ) {
    return this.memoryService.listMemories(req.user.userId, {
      sessionId,
      characterId,
      scope,
    });
  }

  @Get('search')
  @ApiOperation({
    summary: 'Semantic vector search over episodic memories using local all-MiniLM-L6-v2 embeddings and sqlite-vec',
  })
  @ApiQuery({ name: 'sessionId', required: true, type: String })
  @ApiQuery({ name: 'q', required: true, type: String })
  async search(
    @Req() req: AuthenticatedRequest,
    @Query('sessionId') sessionId: string,
    @Query('q') queryText: string,
  ) {
    return this.memoryService.searchRelevantMemories({
      userId: req.user.userId,
      sessionId,
      queryText: queryText || '',
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create and embed a new episodic memory' })
  async create(@Req() req: AuthenticatedRequest, @Body() dto: CreateEpisodicMemoryDto) {
    return this.memoryService.createMemory(req.user.userId, dto);
  }

  @Post('extract/:sessionId')
  @ApiOperation({
    summary: 'Extract durable episodic memories from recent turns in a session and embed them into sqlite-vec',
  })
  async extractFromSession(
    @Req() req: AuthenticatedRequest,
    @Param('sessionId') sessionId: string,
    @Body() body?: { turnCount?: number },
  ) {
    const extracted = await this.memoryService.extractMemoriesFromRecentTurns({
      sessionId,
      userId: req.user.userId,
      turnCount: body?.turnCount ?? 8,
    });
    return {
      extractedCount: extracted.length,
      memories: extracted,
    };
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Update episodic memory text, importance, or promote/demote scope between session and user-global',
  })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateEpisodicMemoryDto,
  ) {
    return this.memoryService.updateMemory(id, req.user.userId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an episodic memory and its vector embedding' })
  delete(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.memoryService.deleteMemory(id, req.user.userId);
  }
}
