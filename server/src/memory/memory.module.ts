import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service.js';
import { MemoryController } from './memory.controller.js';

@Module({
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
