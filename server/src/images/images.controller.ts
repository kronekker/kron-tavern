import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ImagesService,
  type GenerateTextToImageDto,
  type GenerateImageToImageDto,
} from './images.service.js';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';

@ApiTags('images')
@Controller('images')
export class ImagesController {
  constructor(private readonly imagesService: ImagesService) {}

  @Get('file/:folder/:filename')
  @ApiOperation({ summary: 'Stream a stored image file from the backend image store' })
  serveImageFile(
    @Param('folder') folder: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const { filePath, mimeType } = this.imagesService.getPhysicalFile(folder, filename);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(filePath);
  }

  @Get()
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List generated images in the persistent backend store' })
  listImages(
    @Req() req: AuthenticatedRequest,
    @Query('mode') mode?: string,
    @Query('characterId') characterId?: string,
  ) {
    return this.imagesService.listImages(req.user.userId, Boolean(req.user.isAdmin), {
      mode,
      characterId,
    });
  }

  @Post('text-to-image')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate an image from text prompt (T2I) and save to backend store' })
  async generateTextToImage(
    @Req() req: AuthenticatedRequest,
    @Body() dto: GenerateTextToImageDto,
  ) {
    return this.imagesService.generateTextToImage(req.user.userId, dto);
  }

  @Post('image-to-image')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Generate an image from a reference image + description (I2I) and save to backend store',
  })
  async generateImageToImage(
    @Req() req: AuthenticatedRequest,
    @Body() dto: GenerateImageToImageDto,
  ) {
    return this.imagesService.generateImageToImage(req.user.userId, dto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a generated image from disk and database' })
  deleteImage(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.imagesService.deleteImage(id, req.user.userId, Boolean(req.user.isAdmin));
  }
}
