// Vercel serverless entry point. `npm run build` compiles src/ into dist/ first;
// this file boots the compiled Nest app once per instance and hands it each request.
// Everything is required lazily inside bootstrap() so that a load-time failure
// (missing module, Prisma client not generated, bad env) becomes a readable 500.
let server = null;
let ready = null;

async function bootstrap() {
  const { NestFactory } = require('@nestjs/core');
  const { ExpressAdapter } = require('@nestjs/platform-express');
  const express = require('express');
  const { AppModule } = require('../dist/app.module');
  const { configureApp } = require('../dist/setup');

  const instance = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(instance), {
    logger: ['error', 'warn', 'log'],
    // Throw instead of process.exit() so the handler can return a readable error
    abortOnError: false,
  });
  configureApp(app);
  await app.init();
  server = instance;
}

module.exports = async function handler(req, res) {
  try {
    ready ??= bootstrap();
    await ready;
  } catch (err) {
    ready = null; // let the next request retry
    console.error('API failed to start:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        statusCode: 500,
        message: `API failed to start: ${err && err.message}. Check the environment variables in Vercel.`,
      }),
    );
    return;
  }
  server(req, res);
};
