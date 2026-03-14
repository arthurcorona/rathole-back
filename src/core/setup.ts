import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import path from 'path';
import fs from 'fs';

async function setup(app: FastifyInstance) {
  // CORS — restrito aos seus domínios
  await app.register(cors, { 
    origin: [
      'http://localhost:5173',
      'http://localhost:8080',
      'https://seudominio.com.br',  // TROCAR FUturamente
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
  await app.register(jwt, { 
    secret: process.env.JWT_SECRET || 'supersecret' 
  });

  // Upload de Arquivos (Limite 5MB, 1 arquivo por request)
  await app.register(multipart, {
    limits: { 
      fileSize: 5 * 1024 * 1024,
      files: 1,
    }
  });

  // diretório de uploads pub
  const uploadsDir = path.join(process.cwd(), 'uploads'); 
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  await app.register(fastifyStatic, {
    root: uploadsDir,
    prefix: '/uploads/',
  });
}

export const setupPlugins = fp(setup);