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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  PersonasService,
  CreatePersonaDto,
  UpdatePersonaDto,
} from './personas.service.js';
import type { CreateSnippetInput } from '../characters/characters.service.js';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';

@ApiTags('personas')
@Controller('personas')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class PersonasController {
  constructor(private readonly personasService: PersonasService) {}

  @Get()
  @ApiOperation({ summary: 'List personas owned by the authenticated user' })
  list(@Req() req: AuthenticatedRequest) {
    return this.personasService.list(req.user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single persona owned by user with trait snippets' })
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.personasService.get(id, req.user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new user persona' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreatePersonaDto) {
    return this.personasService.create(req.user.userId, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an existing user persona' })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdatePersonaDto,
  ) {
    return this.personasService.update(id, req.user.userId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a user persona' })
  delete(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.personasService.delete(id, req.user.userId);
  }

  @Post(':id/default')
  @ApiOperation({ summary: 'Set persona as default for new conversations' })
  setDefault(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.personasService.setDefault(id, req.user.userId);
  }

  @Get(':id/snippets')
  @ApiOperation({ summary: 'Get keyword trait snippets for a persona' })
  getSnippets(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.personasService.getSnippets(id, req.user.userId);
  }

  @Post(':id/snippets')
  @ApiOperation({ summary: 'Add a new keyword trait snippet to a persona' })
  addSnippet(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CreateSnippetInput,
  ) {
    return this.personasService.addSnippet(id, req.user.userId, dto);
  }

  @Put(':id/snippets/:snippetId')
  @ApiOperation({ summary: 'Update a keyword trait snippet' })
  updateSnippet(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('snippetId') snippetId: string,
    @Body() dto: Partial<CreateSnippetInput>,
  ) {
    return this.personasService.updateSnippet(id, snippetId, req.user.userId, dto);
  }

  @Delete(':id/snippets/:snippetId')
  @ApiOperation({ summary: 'Delete a keyword trait snippet' })
  deleteSnippet(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('snippetId') snippetId: string,
  ) {
    return this.personasService.deleteSnippet(id, snippetId, req.user.userId);
  }
}
