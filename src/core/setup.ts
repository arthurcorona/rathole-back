import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';

async function setup(app: FastifyInstance) {
  // CORS
  await app.register(cors, { 
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // auth JWT
  await app.register(jwt, { 
    secret: process.env.JWT_SECRET || 'supersecret' 
  });

  // Upload de Arquivos (Limite 5MB)
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 }
  });

  // direorio de uploads pub
  // process.cwd() garante que a pasta fique na raiz do backend, não dentro de /core
  const uploadsDir = path.join(process.cwd(), 'uploads'); 
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  await app.register(fastifyStatic, {
    root: uploadsDir,
    prefix: '/uploads/',
  });
}

// O 'fp' garante que essas configurações funcionem no app inteiro
export const setupPlugins = fp(setup);