import { INestApplication, ValidationPipe } from '@nestjs/common';

/** Shared app configuration for the local server (main.ts) and Vercel (api/index.js). */
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim().replace(/\/$/, '')),
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
