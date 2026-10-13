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
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import {
  CharactersService,
  CreateCharacterDto,
  UpdateCharacterDto,
  CreateSnippetInput,
} from './characters.service.js';
import { AuthGuard, OptionalAuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest, OptionalAuthenticatedRequest } from '../auth/auth.guard.js';

@ApiTags('characters')
@Controller('characters')
export class CharactersController {
  constructor(private readonly charactersService: CharactersService) {}

  @Get()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'List characters: filtered by scope (all, mine, public) and search query' })
  @ApiQuery({ name: 'scope', required: false, enum: ['all', 'mine', 'public'] })
  @ApiQuery({ name: 'q', required: false, type: String })
  list(
    @Req() req: OptionalAuthenticatedRequest,
    @Query('scope') scope?: 'all' | 'mine' | 'public',
    @Query('q') query?: string,
  ) {
    return this.charactersService.list(req.user?.userId, scope || 'all', query);
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Get single character by ID with keyword lore snippets' })
  get(@Req() req: OptionalAuthenticatedRequest, @Param('id') id: string) {
    return this.charactersService.get(id, req.user?.userId, req.user?.isAdmin);
  }

  @Post()
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new AI companion character' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateCharacterDto) {
    return this.charactersService.create(req.user.userId, dto);
  }

  @Put(':id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an existing character (creator or admin)' })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateCharacterDto,
  ) {
    return this.charactersService.update(id, req.user.userId, dto, req.user.isAdmin);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a character (creator or admin)' })
  delete(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.charactersService.delete(id, req.user.userId, req.user.isAdmin);
  }

  @Get(':id/snippets')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Get keyword lore snippets for a character' })
  getSnippets(@Req() req: OptionalAuthenticatedRequest, @Param('id') id: string) {
    return this.charactersService.getSnippets(id, req.user?.userId, req.user?.isAdmin);
  }

  @Post(':id/snippets')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a new keyword lore snippet to a character' })
  addSnippet(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CreateSnippetInput,
  ) {
    return this.charactersService.addSnippet(id, req.user.userId, dto, req.user.isAdmin);
  }

  @Put(':id/snippets/:snippetId')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a keyword lore snippet' })
  updateSnippet(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('snippetId') snippetId: string,
    @Body() dto: Partial<CreateSnippetInput>,
  ) {
    return this.charactersService.updateSnippet(id, snippetId, req.user.userId, dto, req.user.isAdmin);
  }

  @Delete(':id/snippets/:snippetId')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a keyword lore snippet' })
  deleteSnippet(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('snippetId') snippetId: string,
  ) {
    return this.charactersService.deleteSnippet(id, snippetId, req.user.userId, req.user.isAdmin);
  }
}
