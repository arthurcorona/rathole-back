import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';

async function setup(app: FastifyInstance) {
  // CORS — restrito aos seus domínios
  await app.register(cors, {
    origin: [
      'http://localhost:5173',
      'http://localhost:8080',
      'https://rathole.com.br',
      'https://www.rathole.com.br',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Rate Limit
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // auth JWT
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET é obrigatório no .env');
  }
  await app.register(jwt, { secret: jwtSecret });

  // Upload de Arquivos (Limite 5MB, 1 arquivo por request)
  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
    }
  });

  // Uploads agora vão pro Supabase Storage (ver src/modules/uploads).
  // O backend é stateless — não serve mais arquivos do disco.
}

export const setupPlugins = fp(setup);