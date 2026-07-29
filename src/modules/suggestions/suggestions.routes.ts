import { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { suggestions, suggestionVotes } from '../../db/schema';
import { eq, desc, and, sql, isNull } from 'drizzle-orm';
import {
  uuidParamSchema,
  suggestionCreateSchema,
  validate,
} from '../../core/validation';

export async function suggestionRoutes(app: FastifyInstance) {

    // get
  app.get('/', async (request) => {
    let userId: string | null = null;
    try {
      await request.jwtVerify();
      userId = request.user.id;
    } catch {}

    const allSuggestions = await db.query.suggestions.findMany({
      where: isNull(suggestions.deleted_at),
      orderBy: [desc(suggestions.upvotes_count)],
      with: {
        user: { columns: { username: true, avatar_url: true } }
      }
    });

    if (!userId) {
      return allSuggestions.map(s => ({ ...s, has_voted: false }));
    }

    // Busca todos os votos do user logado
    const userVotes = await db.query.suggestionVotes.findMany({
      where: eq(suggestionVotes.user_id, userId)
    });

    const votedIds = new Set(userVotes.map(v => v.suggestion_id));

    return allSuggestions.map(s => ({
      ...s,
      has_voted: votedIds.has(s.id)
    }));
  });

  app.post('/', { onRequest: [app.authenticate] }, async (request, reply) => {
    const data = validate(suggestionCreateSchema, request.body, reply);
    if (!data) return;

    try {
      await db.insert(suggestions).values({
        title: data.title,
        description: data.description,
        user_id: request.user.id,
        status: 'pending',
        upvotes_count: 0,
      });
      return reply.status(201).send({ message: 'Suggestion created' });
    } catch (error) {
      return reply.status(500).send({ message: 'Error creating suggestion' });
    }
  });

  // DELETE /suggestions/:id (soft delete) — admin OU o próprio autor
  app.delete('/:id', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = validate(uuidParamSchema, request.params, reply);
    if (!params) return;

    try {
      const suggestion = await db.query.suggestions.findFirst({
        where: and(eq(suggestions.id, params.id), isNull(suggestions.deleted_at)),
        columns: { id: true, user_id: true },
      });

      if (!suggestion) {
        return reply.status(404).send({ message: 'Suggestion not found' });
      }

      const isOwner = suggestion.user_id === request.user.id;
      const isAdmin = request.user.role === 'admin';
      if (!isOwner && !isAdmin) {
        return reply.status(403).send({ message: 'Você só pode apagar suas próprias sugestões' });
      }

      await db
        .update(suggestions)
        .set({ deleted_at: new Date() })
        .where(eq(suggestions.id, params.id));
      return reply.send({ message: 'Suggestion deleted successfully' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: 'Error deleting suggestion' });
    }
  });

  app.post('/:id/vote', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = validate(uuidParamSchema, request.params, reply);
    if (!params) return;
    const userId = request.user.id;

    try {
      await db.transaction(async (tx) => {
        await tx.insert(suggestionVotes).values({
          suggestion_id: params.id,
          user_id: userId,
        });

        await tx
          .update(suggestions)
          .set({ upvotes_count: sql`${suggestions.upvotes_count} + 1` })
          .where(eq(suggestions.id, params.id));
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
    const params = validate(uuidParamSchema, request.params, reply);
    if (!params) return;
    const userId = request.user.id;

    try {
      await db.transaction(async (tx) => {
        const deleted = await tx
          .delete(suggestionVotes)
          .where(and(eq(suggestionVotes.suggestion_id, params.id), eq(suggestionVotes.user_id, userId)))
          .returning();

        if (deleted.length > 0) {
          await tx
            .update(suggestions)
            .set({ upvotes_count: sql`${suggestions.upvotes_count} - 1` })
            .where(eq(suggestions.id, params.id));
        }
      });

      return reply.send({ message: 'Vote removed' });
    } catch (error) {
      return reply.status(500).send({ message: 'Error removing vote' });
    }
  });
}