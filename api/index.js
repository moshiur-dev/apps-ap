// Vercel serverless entry point. `npm run build` compiles src/ into dist/ first;
// this file boots the compiled Nest app once per instance and hands it each request.
const { NestFactory } = require('@nestjs/core');
const { ExpressAdapter } = require('@nestjs/platform-express');
const express = require('express');
const { AppModule } = require('../dist/app.module');
const { configureApp } = require('../dist/setup');

const server = express();
let ready = null;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    logger: ['error', 'warn', 'log'],
    // Throw instead of process.exit() so the handler can return a readable error
    abortOnError: false,
  });
  configureApp(app);
  await app.init();
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
        message: `API failed to start: ${err.message}. Check the environment variables in Vercel.`,
      }),
    );
    return;
  }
  server(req, res);
};
