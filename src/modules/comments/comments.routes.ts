import { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { comments } from '../../db/schema';
import { eq, desc, and, isNull, sql } from 'drizzle-orm';
import {
  postIdParamSchema,
  uuidParamSchema,
  commentCreateSchema,
  validate,
} from '../../core/validation';

export async function commentRoutes(app: FastifyInstance) {

  // GET /posts/:postId/comments
  app.get('/posts/:postId/comments', async (request, reply) => {
    const params = validate(postIdParamSchema, request.params, reply);
    if (!params) return;

    const postComments = await db.query.comments.findMany({
      where: and(eq(comments.post_id, params.postId), isNull(comments.deleted_at)),
      orderBy: desc(comments.created_at),
      with: {
        user: { columns: { username: true, avatar_url: true } },
      },
    });

    return postComments;
  });

  // POST /comments
  app.post('/comments', async (request, reply) => {
    const data = validate(commentCreateSchema, request.body, reply);
    if (!data) return;

    let userId: string | null = null;
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (token) {
        const decoded = app.jwt.verify(token) as any;
        userId = decoded.id;
      }
    } catch (e) {
      // falhou e tratado como anonimo
    }

    if (!userId && !data.guest_name) {
      return reply.status(400).send({ message: 'Name is required for guests' });
    }

    try {
      await db.insert(comments).values({
        content: data.content,
        post_id: data.post_id,
        parent_id: data.parent_id ?? null,
        user_id: userId,
        guest_name: userId ? null : data.guest_name ?? null,
        is_approved: true,
      });

      return reply.status(201).send({ message: 'Comment added' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: 'Error adding comment' });
    }
  });

  // DELETE /comments/:id (Admin) — soft delete
  app.delete('/comments/:id', { onRequest: [app.requireAdmin] }, async (request, reply) => {
    const params = validate(uuidParamSchema, request.params, reply);
    if (!params) return;

    try {
      const updated = await db
        .update(comments)
        .set({ deleted_at: sql`NOW()` })
        .where(and(eq(comments.id, params.id), isNull(comments.deleted_at)))
        .returning({ id: comments.id });

      if (updated.length === 0) {
        return reply.status(404).send({ message: 'Comment not found or already deleted' });
      }

      return reply.send({ message: 'Comment deleted' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: 'Error deleting comment' });
    }
  });
}