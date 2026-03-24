import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import path from 'path';
import fs from 'fs';

async function setup(app: FastifyInstance) {
  // Cookie (deve vir antes do JWT)
  await app.register(cookie);

  // CORS — restrito aos seus domínios
  await app.register(cors, {
    origin: [
      'http://localhost:5173',
      'http://localhost:8080',
      'https://rathole.com.br',
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
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET não definido no .env');
  }
  await app.register(jwt, {
    secret: process.env.JWT_SECRET,
    cookie: {
      cookieName: 'rathole_token',
      signed: false,
    },
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