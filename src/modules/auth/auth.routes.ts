import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { db } from '../../db';
import { users } from '../../db/schema';
import { eq } from 'drizzle-orm';

export async function authRoutes(app: FastifyInstance) {
  
  // post /auth/login
  app.post('/login', async (request, reply) => {
    const { email, password } = request.body as any;

    const user = await db.query.users.findFirst({
      where: eq(users.email, email)
    });

    if (!user) return reply.status(400).send({ message: 'User not found' });

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return reply.status(400).send({ message: 'Invalid password' });

    const token = app.jwt.sign({ id: user.id, role: user.role, name: user.username });
    
    return { 
      token, 
      user: { 
        id: user.id, 
        username: user.username,
        email: user.email,
        role: user.role, 
        avatar_url: user.avatar_url 
      } 
    };
  });

  // POST /auth/signup
  app.post('/signup', async (request, reply) => {
    const { username, email, password } = request.body as any;
    
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

  // PUT /auth/profile
  app.put('/profile', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.user;
    const { username, avatar_url } = request.body as any;

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