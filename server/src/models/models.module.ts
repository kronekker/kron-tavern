import { Module, Global } from '@nestjs/common';
import { ModelsService } from './models.service.js';
import { ModelsController } from './models.controller.js';

@Global()
@Module({
  providers: [ModelsService],
  controllers: [ModelsController],
  exports: [ModelsService],
})
export class ModelsModule {}
