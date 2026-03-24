import { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { comments } from '../../db/schema';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';

const commentSchema = z.object({
  content: z.string().min(1).max(1000),
  post_id: z.string().uuid(),
  parent_id: z.string().uuid().optional(),
  guest_name: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_ -]+$/).optional(),
});

export async function commentRoutes(app: FastifyInstance) {

  // GET /posts/:postId/comments
  app.get('/posts/:postId/comments', async (request) => {
    const { postId } = request.params as { postId: string };

    const postComments = await db.query.comments.findMany({
      where: eq(comments.post_id, postId),
      orderBy: desc(comments.created_at),
      with: {
        user: { columns: { username: true, avatar_url: true } }
      }
    });

    return postComments;
  });

  // POST /comments
  app.post('/comments', async (request, reply) => {
    const parsed = commentSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ message: parsed.error.issues[0].message });
    const { content, post_id, parent_id, guest_name } = parsed.data;

    let userId = null;

    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (token) {
        const decoded = app.jwt.verify(token) as any;
        userId = decoded.id;
      }
    } catch (e) {
      // falhou e tratado como anonimo
    }

    if (!userId && !guest_name) {
      return reply.status(400).send({ message: 'Name is required for guests' });
    }

    try {
      await db.insert(comments).values({
        content,
        post_id,
        parent_id,
        user_id: userId,
        guest_name: userId ? null : guest_name,
        is_approved: true 
      });

      return reply.status(201).send({ message: 'Comment added' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: 'Error adding comment' });
    }
  });
}