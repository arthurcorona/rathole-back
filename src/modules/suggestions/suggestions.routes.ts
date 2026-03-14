import { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { suggestions, suggestionVotes } from '../../db/schema';
import { eq, desc, and, sql } from 'drizzle-orm';

export async function suggestionRoutes(app: FastifyInstance) {

    // get 
  app.get('/', async (request) => {
    const allSuggestions = await db.query.suggestions.findMany({
      orderBy: [desc(suggestions.upvotes_count)],
      with: {
        user: { columns: { username: true, avatar_url: true } }
      }
    });

    return allSuggestions.map(s => ({
      ...s,
      has_voted: false 
    }));
  });

  app.post('/', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { title, description } = request.body as any;

    try {
      await db.insert(suggestions).values({
        title,
        description,
        user_id: request.user.id,
        status: 'pending',
        upvotes_count: 0
      });
      return reply.status(201).send({ message: 'Suggestion created' });
    } catch (error) {
      return reply.status(500).send({ message: 'Error creating suggestion' });
    }
  });

  app.post('/:id/vote', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user.id;

    try {
      await db.transaction(async (tx) => {
        await tx.insert(suggestionVotes).values({
          suggestion_id: id,
          user_id: userId
        });

        await tx.update(suggestions)
          .set({ upvotes_count: sql`${suggestions.upvotes_count} + 1` })
          .where(eq(suggestions.id, id));
      });

      return reply.send({ message: 'Voted' });
    } catch (error: any) {
      if (error.code === '23505') { 
        return reply.status(400).send({ message: 'You already voted on this suggestion' });
      }
      return reply.status(500).send({ message: 'Error voting' });
    }
  });

  app.delete('/:id/vote', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const userId = request.user.id;

    try {
      await db.transaction(async (tx) => {
        const deleted = await tx.delete(suggestionVotes)
          .where(and(
            eq(suggestionVotes.suggestion_id, id),
            eq(suggestionVotes.user_id, userId)
          ))
          .returning();

        if (deleted.length > 0) {
          await tx.update(suggestions)
            .set({ upvotes_count: sql`${suggestions.upvotes_count} - 1` })
            .where(eq(suggestions.id, id));
        }
      });

      return reply.send({ message: 'Vote removed' });
    } catch (error) {
      return reply.status(500).send({ message: 'Error removing vote' });
    }
  });

}