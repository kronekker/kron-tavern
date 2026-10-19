import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Increase payload limit for base64 reference image uploads (I2I)
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ limit: '25mb', extended: true }));

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
    .addTag('images', 'Text-to-Image, Image-to-Image, and persistent image gallery')
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
