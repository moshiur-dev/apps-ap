import { INestApplication, ValidationPipe } from '@nestjs/common';

/** Shared app configuration for the local server (main.ts) and Vercel (api/index.js). */
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  const origins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    // Tolerate values pasted from .env with quotes, spaces or a trailing slash
    .map((o) =>
      o
        .trim()
        .replace(/^["']|["']$/g, '')
        .trim()
        .replace(/\/$/, ''),
    )
    .filter(Boolean);
  app.enableCors({
    // WEB_ORIGIN, plus any Vercel deployment of the apps-web project.
    // Auth uses a bearer token (no cookies), so this can't leak a session.
    origin: [...origins, /^https:\/\/apps-web(-[a-z0-9-]+)?\.vercel\.app$/],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
