import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  SessionsService,
  CreateSessionDto,
  EditMessageDto,
  RerollTurnDto,
  RewindDto,
  CompressSessionDto,
  UpdateCompressionDto,
} from './sessions.service.js';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';

@ApiTags('sessions')
@Controller('sessions')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  @ApiOperation({ summary: 'List chat sessions for the current user' })
  list(@Req() req: AuthenticatedRequest) {
    return this.sessionsService.listSessions(req.user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new chat session with character greeting' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateSessionDto) {
    return this.sessionsService.createSession(req.user.userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get session details, character, persona, history, and active compression' })
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.sessionsService.getSessionDetails(id, req.user.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a chat session and its message history' })
  delete(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.sessionsService.deleteSession(id, req.user.userId);
  }

  @Put(':id/models')
  @ApiOperation({ summary: 'Update session active multimodal models' })
  updateModels(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() models: { chatModel?: string; textToImageModel?: string; imageToImageModel?: string },
  ) {
    return this.sessionsService.updateSessionModels(id, req.user.userId, models);
  }

  @Put(':id/background')
  @ApiOperation({ summary: 'Update session background image (character avatar, image store URL, or null for default)' })
  updateBackground(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { backgroundImageUrl?: string | null },
  ) {
    return this.sessionsService.updateSessionBackground(id, req.user.userId, body.backgroundImageUrl ?? null);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Send user message and stream character response via SSE' })
  async sendMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: { content: string },
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    try {
      const result = await this.sessionsService.executeTurn(
        id,
        req.user.userId,
        body.content || '',
        (token: string) => {
          res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
          (res as any).flush?.();
        },
      );

      res.write(`data: ${JSON.stringify({ type: 'complete', message: result.message, trace: result.trace })}\n\n`);
      (res as any).flush?.();
      res.end();
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message || 'Turn execution failed' })}\n\n`);
      (res as any).flush?.();
      res.end();
    }
  }

  @Post(':id/reroll')
  @ApiOperation({ summary: 'Reroll latest character turn with optional suggestion directive via SSE' })
  async rerollTurn(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: RerollTurnDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    try {
      const result = await this.sessionsService.rerollTurn(
        id,
        req.user.userId,
        body.suggestion,
        (token: string) => {
          res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
          (res as any).flush?.();
        },
      );

      res.write(`data: ${JSON.stringify({ type: 'complete', message: result.message, trace: result.trace })}\n\n`);
      (res as any).flush?.();
      res.end();
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message || 'Reroll failed' })}\n\n`);
      (res as any).flush?.();
      res.end();
    }
  }

  @Post(':id/suggest-reply')
  @ApiOperation({ summary: 'Auto-generate suggested user reply in persona voice' })
  suggestReply(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.sessionsService.suggestUserReply(id, req.user.userId);
  }

  @Post(':id/rewind')
  @ApiOperation({ summary: 'Rewind conversation to a previous message, pruning future turns' })
  rewind(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: RewindDto,
  ) {
    return this.sessionsService.rewindSession(id, dto.messageId, req.user.userId);
  }

  @Put(':id/messages/:msgId')
  @ApiOperation({ summary: 'Edit any message content inline' })
  editMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('msgId') msgId: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.sessionsService.editMessage(id, msgId, req.user.userId, dto.content);
  }

  @Post(':id/compress')
  @ApiOperation({ summary: 'Create boundary compression for context pruning' })
  compress(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CompressSessionDto,
  ) {
    return this.sessionsService.triggerCompression(id, req.user.userId, dto.boundaryMessageId, dto.customSummary);
  }

  @Put(':id/compressions/:cId')
  @ApiOperation({ summary: 'Edit active compression summary narrative' })
  updateCompression(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('cId') cId: string,
    @Body() dto: UpdateCompressionDto,
  ) {
    return this.sessionsService.updateCompressionSummary(id, cId, req.user.userId, dto.summaryText);
  }

  @Get(':id/traces/:msgId')
  @ApiOperation({ summary: 'Get Turn Inspector trace details for a specific message turn' })
  getTrace(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('msgId') msgId: string,
  ) {
    return this.sessionsService.getTurnTrace(id, msgId, req.user.userId);
  }
}
