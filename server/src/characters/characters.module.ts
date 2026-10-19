import { Module } from '@nestjs/common';
import { CharactersController } from './characters.controller.js';
import { CharactersService } from './characters.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ImagesModule } from '../images/images.module.js';

@Module({
  imports: [DatabaseModule, AuthModule, ImagesModule],
  controllers: [CharactersController],
  providers: [CharactersService],
  exports: [CharactersService],
})
export class CharactersModule {}
