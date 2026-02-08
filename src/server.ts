import fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { users, posts } from './db/schema';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod'; 

// fatfy insancia p reconhecer o 'authenticate'
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

//Expandindo o tipo do JWT para ele saber o que tem dentro do 'request.user'
declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: {
      id: string;
      role: 'admin' | 'reader';
      name: string;
    }
  }
}
// ----------------------------------

const app = fastify();

app.register(cors, { origin: 'http://localhost:8080' }); 
app.register(jwt, { secret: process.env.JWT_SECRET! });

// Decorator para proteger rotas
app.decorate("authenticate", async function(request: any, reply: any) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.send(err);
  }
});

// --- ROTAS DE AUTH ---

app.post('/auth/login', async (request, reply) => {
  const { email, password } = request.body as any;

  const user = await db.query.users.findFirst({
    where: eq(users.email, email)
  });

  if (!user) return reply.status(400).send({ message: 'User not found' });

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) return reply.status(400).send({ message: 'Invalid password' });

  // token jwt
  const token = app.jwt.sign({ id: user.id, role: user.role, name: user.username });
  
  return { token, user: { id: user.id, name: user.username, role: user.role, avatar: user.avatar_url } };
});

app.post('/auth/signup', async (request, reply) => {
  const { username, email, password } = request.body as any;

  const hash = await bcrypt.hash(password, 10);
  
  try {
    await db.insert(users).values({
      username,
      email,
      password_hash: hash,
      role: 'reader'
    });
    return reply.status(201).send({ message: 'User created' });
  } catch (error) {
    return reply.status(400).send({ message: 'Error creating user (Email/Username exists?)' });
  }
});

// --- ROTAS DE POSTS (Públicas para ler, Privadas para criar) ---

app.get('/posts', async () => {
  // posts por data
  return await db.query.posts.findMany({
    where: eq(posts.status, 'published'),
    orderBy: [desc(posts.created_at)],
    with: {
      author: { columns: { username: true, avatar_url: true } }
    }
  });
});

// só admin cria post
app.post('/posts', { onRequest: [app.authenticate] }, async (request: any, reply) => {
  const { role } = request.user; // Vem do JWT
  if (role !== 'admin') return reply.status(403).send({ message: 'Admins only' });

  const { title, slug, content } = request.body as any;
  
  await db.insert(posts).values({
    title, slug, content, 
    author_id: request.user.id,
    status: 'draft'
  });

  return reply.status(201).send({ message: 'Post created' });
});

// --- INICIAR ---

app.listen({ port: Number(process.env.PORT) || 3333, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at ${address}`);
});