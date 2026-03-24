import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { db } from '../../db';
import { users } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const signupSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/, 'Apenas letras, números, _ e -'),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const profileSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  avatar_url: z.string().url().max(512).optional(),
});

export async function authRoutes(app: FastifyInstance) {

  // post /auth/login
  app.post('/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message });
    const { email, password } = parsed.data;

    const user = await db.query.users.findFirst({
      where: eq(users.email, email)
    });

    if (!user) return reply.status(400).send({ message: 'User not found' });

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return reply.status(400).send({ message: 'Invalid password' });

    const token = app.jwt.sign(
      { id: user.id, role: user.role, name: user.username },
      { expiresIn: '7d' }
    );

    reply.setCookie('rathole_token', token, {
      httpOnly: true,
      secure: false, // TODO: mudar para true após configurar SSL
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 dias em segundos
    });

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
      },
    };
  });

  // POST /auth/signup
  app.post('/signup', async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message });
    const { username, email, password } = parsed.data;
    
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email)
    });
    if (existingUser) return reply.status(400).send({ message: 'Email already exists' });

    const hash = await bcrypt.hash(password, 10);
    
    try {
      await db.insert(users).values({
        username, email, password_hash: hash, role: 'reader'
      });
      return reply.status(201).send({ message: 'User created' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: 'Error creating user' });
    }
  });

  // POST /auth/logout
  app.post('/logout', async (request, reply) => {
    reply.clearCookie('rathole_token', { path: '/' });
    return reply.send({ message: 'Logout realizado' });
  });

  // PUT /auth/profile
  app.put('/profile', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.user;
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message });
    const { username, avatar_url } = parsed.data;

    try {
      await db.update(users)
        .set({ username, avatar_url })
        .where(eq(users.id, id));

      return { message: 'Perfil atualizado com sucesso' };
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: 'Erro ao atualizar perfil' });
    }
  });

}