import { Module } from '@nestjs/common';
import { ImagesService } from './images.service.js';
import { ImagesController } from './images.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { ModelsModule } from '../models/models.module.js';

@Module({
  imports: [AuthModule, ModelsModule],
  controllers: [ImagesController],
  providers: [ImagesService],
  exports: [ImagesService],
})
export class ImagesModule {}
