import { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { users } from '../../db/schema';
import { eq, desc } from 'drizzle-orm';
import { uuidParamSchema, membershipUpdateSchema, validate } from '../../core/validation';

export async function userRoutes(app: FastifyInstance) {
  // GET /users — lista de usuários (admin)
  app.get('/', { onRequest: [app.requireAdmin] }, async () => {
    return db.query.users.findMany({
      columns: {
        id: true,
        username: true,
        email: true,
        role: true,
        member_until: true,
        created_at: true,
      },
      orderBy: [desc(users.created_at)],
    });
  });

  // PUT /users/:id/membership — concede (data futura) ou revoga (null). Admin.
  app.put('/:id/membership', { onRequest: [app.requireAdmin] }, async (request, reply) => {
    const params = validate(uuidParamSchema, request.params, reply);
    if (!params) return;
    const data = validate(membershipUpdateSchema, request.body, reply);
    if (!data) return;

    const updated = await db
      .update(users)
      .set({ member_until: data.member_until ? new Date(data.member_until) : null })
      .where(eq(users.id, params.id))
      .returning({ id: users.id, member_until: users.member_until });

    if (updated.length === 0) {
      return reply.status(404).send({ message: 'Usuário não encontrado' });
    }

    return reply.send({ message: 'Membership atualizada', member_until: updated[0].member_until });
  });
}
