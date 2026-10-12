import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Set global API route prefix
  app.setGlobalPrefix('api');

  // Enable CORS for local development flexibility
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Setup Swagger OpenAPI interactive documentation
  const config = new DocumentBuilder()
    .setTitle('kron-tavern API')
    .setDescription(
      'AI companion and roleplay backend with dual-tiered episodic memory, in-session A/B model testing, and complete prompt traceability.',
    )
    .setVersion('1.0.0')
    .addTag('auth', 'Authentication and user API key management')
    .addTag('characters', 'Character and persona management')
    .addTag('chat', 'Roleplay sessions, SSE streaming, and A/B evaluations')
    .addTag('memory', 'Keyword lorebooks and semantic episodic memory')
    .addTag('traces', 'Turn Inspector audit traces')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3004;
  await app.listen(port);
  console.log(`\n======================================================`);
  console.log(`🏰 kron-tavern backend running on: http://localhost:${port}`);
  console.log(`📚 Swagger documentation at:       http://localhost:${port}/api/docs`);
  console.log(`======================================================\n`);
}

await bootstrap();
