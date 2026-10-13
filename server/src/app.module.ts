import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database/database.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ModelsModule } from './models/models.module.js';
import { CharactersModule } from './characters/characters.module.js';
import { PersonasModule } from './personas/personas.module.js';
import { SessionsModule } from './sessions/sessions.module.js';

// Locate production Angular SPA build if present
const candidatePaths = [
  resolve(process.cwd(), '../client/dist/client/browser'),
  resolve(process.cwd(), 'client/dist/client/browser'),
  resolve(process.cwd(), 'dist/client/browser'),
];
const staticPath = candidatePaths.find((p) => existsSync(p)) ?? null;

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    ModelsModule,
    AdminModule,
    CharactersModule,
    PersonasModule,
    SessionsModule,
    ...(staticPath
      ? [
          ServeStaticModule.forRoot({
            rootPath: staticPath,
            exclude: ['/api*'],
          }),
        ]
      : []),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
