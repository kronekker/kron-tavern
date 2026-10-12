import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

// Locate production Angular SPA build if present
const candidatePaths = [
  resolve(process.cwd(), '../client/dist/client/browser'),
  resolve(process.cwd(), 'client/dist/client/browser'),
  resolve(process.cwd(), 'dist/client/browser'),
];
const staticPath = candidatePaths.find((p) => existsSync(p)) ?? null;

@Module({
  imports: [
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
