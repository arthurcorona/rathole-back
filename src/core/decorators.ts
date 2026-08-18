import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

// --- TIPAGENS GLOBAIS ---
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireMember: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: {
      id: string;
      role: 'admin' | 'reader';
      name: string;
    }
  }
}

async function decorators(app: FastifyInstance) {
  
  // user logado
  app.decorate("authenticate", async function(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.status(401).send({ message: 'Unauthorized: Invalid Token' });
    }
  });

  // admin
  app.decorate("requireAdmin", async function(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify(); 
      if (request.user.role !== 'admin') {
        reply.status(403).send({ message: 'Forbidden(patético): Você Não tem poder o suficiente' });
      }
    } catch (err) {
      reply.status(401).send({ message: 'Unauthorized: Token inválido' });
    }
  });

  // membro ativo (ou admin) — checa member_until no banco (fonte da verdade)
  app.decorate("requireMember", async function(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      if (request.user.role === 'admin') return; // admin sempre passa

      const u = await db.query.users.findFirst({
        where: eq(users.id, request.user.id),
        columns: { member_until: true },
      });
      const active = !!u?.member_until && new Date(u.member_until) > new Date();
      if (!active) {
        reply.status(403).send({ message: 'Área exclusiva para membros' });
      }
    } catch (err) {
      reply.status(401).send({ message: 'Unauthorized: Token inválido' });
    }
  });

}

// Exportando com o 'fp'
export const setupDecorators = fp(decorators);