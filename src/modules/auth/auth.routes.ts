import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { db } from '../../db';
import { users } from '../../db/schema';
import { eq } from 'drizzle-orm';
import {
  loginSchema,
  signupSchema,
  profileUpdateSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  validate,
  emailHasMxRecord,
} from '../../core/validation';
import { sendVerificationEmail } from '../../core/mailer';

const VERIFY_TOKEN_PURPOSE = 'email_verification';

export async function authRoutes(app: FastifyInstance) {

  async function issueVerification(email: string) {
    const token = app.jwt.sign(
      { email, purpose: VERIFY_TOKEN_PURPOSE },
      { expiresIn: '1h' },
    );
    await sendVerificationEmail(email, token);
  }

  // POST /auth/login
  app.post('/login', async (request, reply) => {
    const data = validate(loginSchema, request.body, reply);
    if (!data) return;

    const user = await db.query.users.findFirst({
      where: eq(users.email, data.email),
    });

    if (!user) return reply.status(400).send({ message: 'Invalid credentials' });

    const validPassword = await bcrypt.compare(data.password, user.password_hash);
    if (!validPassword) return reply.status(400).send({ message: 'Invalid credentials' });

    if (!user.email_verified) {
      return reply.status(403).send({
        message: 'Email não verificado. Confira sua caixa de entrada.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    const token = app.jwt.sign(
      { id: user.id, role: user.role, name: user.username },
      { expiresIn: '7d' },
    );

    return {
      token,
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
    const data = validate(signupSchema, request.body, reply);
    if (!data) return;

    const hasMx = await emailHasMxRecord(data.email);
    if (!hasMx) {
      return reply.status(400).send({
        message: 'Validação falhou',
        errors: { email: ['Domínio do email não pode receber emails'] },
      });
    }

    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, data.email),
    });
    if (existingUser) return reply.status(400).send({ message: 'Email already exists' });

    const hash = await bcrypt.hash(data.password, 10);

    try {
      await db.insert(users).values({
        username: data.username,
        email: data.email,
        password_hash: hash,
        role: 'reader',
        email_verified: false,
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: 'Error creating user' });
    }

    try {
      await issueVerification(data.email);
    } catch (error) {
      request.log.error({ err: error }, 'failed to send verification email');
      // Conta foi criada, mas o email falhou. O usuário pode pedir reenvio.
      return reply.status(201).send({
        message: 'Conta criada, mas falhou ao enviar o email de verificação. Use "reenviar verificação".',
      });
    }

    return reply.status(201).send({
      message: 'Conta criada. Confira seu email para verificar a conta.',
    });
  });

  // POST /auth/verify-email
  app.post('/verify-email', async (request, reply) => {
    const data = validate(verifyEmailSchema, request.body, reply);
    if (!data) return;

    let decoded: { email?: string; purpose?: string };
    try {
      decoded = app.jwt.verify(data.token) as any;
    } catch (err: any) {
      const expired = err?.code === 'FAST_JWT_EXPIRED' || /expired/i.test(err?.message || '');
      return reply.status(400).send({
        message: expired ? 'Link expirado' : 'Token inválido',
        code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
      });
    }

    if (decoded.purpose !== VERIFY_TOKEN_PURPOSE || !decoded.email) {
      return reply.status(400).send({ message: 'Token inválido', code: 'TOKEN_INVALID' });
    }

    const updated = await db
      .update(users)
      .set({ email_verified: true })
      .where(eq(users.email, decoded.email))
      .returning({ id: users.id, email_verified: users.email_verified });

    if (updated.length === 0) {
      return reply.status(404).send({ message: 'Usuário não encontrado' });
    }

    return reply.send({ message: 'Email verificado' });
  });

  // POST /auth/resend-verification — sempre responde 200 pra não vazar quem está cadastrado
  app.post('/resend-verification', async (request, reply) => {
    const data = validate(resendVerificationSchema, request.body, reply);
    if (!data) return;

    const user = await db.query.users.findFirst({
      where: eq(users.email, data.email),
    });

    if (user && !user.email_verified) {
      try {
        await issueVerification(user.email);
      } catch (error) {
        request.log.error({ err: error }, 'failed to resend verification email');
      }
    }

    return reply.send({ message: 'Se o email existir e ainda não foi verificado, enviaremos um novo link.' });
  });

  // PUT /auth/profile
  app.put('/profile', { onRequest: [app.authenticate] }, async (request, reply) => {
    const data = validate(profileUpdateSchema, request.body, reply);
    if (!data) return;

    const { id } = request.user;

    const updateData: Partial<{ username: string; avatar_url: string | null }> = {};
    if (data.username !== undefined) updateData.username = data.username;
    if (data.avatar_url !== undefined) updateData.avatar_url = data.avatar_url;

    if (Object.keys(updateData).length === 0) {
      return reply.status(400).send({ message: 'Nada para atualizar' });
    }

    try {
      await db.update(users).set(updateData).where(eq(users.id, id));
      return { message: 'Perfil atualizado com sucesso' };
    } catch (error: any) {
      request.log.error(error);
      if (error.code === '23505') {
        return reply.status(400).send({ message: 'Username já existe' });
      }
      return reply.status(500).send({ message: 'Erro ao atualizar perfil' });
    }
  });
}