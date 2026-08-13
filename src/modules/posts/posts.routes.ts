import { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { posts, tags, postTags, postVotes } from '../../db/schema';
import { eq, desc, ne, and, sql } from 'drizzle-orm';
import { slugify } from '../../utils/stringUtils';
import {
  slugParamSchema,
  uuidParamSchema,
  postCreateSchema,
  postUpdateSchema,
  validate,
} from '../../core/validation';


export async function postRoutes(app: FastifyInstance) {
  // Rota: GET /posts (Público)
app.get('/', async (request) => {
  let isAdmin = false;
  let userId: string | null = null;
  try {
    await request.jwtVerify();
    isAdmin = request.user?.role === 'admin';
    userId = request.user?.id ?? null;
  } catch(err: any) {
    request.log.info({ error: err.message }, '>>> JWT falhou');
  }

  // termo de busca opcional: GET /posts?q=alguma coisa
  const rawQ = (request.query as { q?: string })?.q;
  const q = typeof rawQ === 'string' ? rawQ.trim() : '';

  // filtro de status (regra que já existia)
  const statusFilter = isAdmin ? ne(posts.status, 'deleted') : eq(posts.status, 'published');

  const allPosts = await db.query.posts.findMany({
    // com busca: status + full-text (@@); sem busca: só status
    where: q
      ? and(statusFilter, sql`search_vector @@ websearch_to_tsquery('portuguese', ${q})`)
      : statusFilter,
    // com busca: ordena por relevância (ts_rank); sem busca: por data (como antes)
    orderBy: q
      ? [desc(sql`ts_rank(search_vector, websearch_to_tsquery('portuguese', ${q}))`)]
      : [desc(posts.created_at)],
    with: {
      author: { columns: { username: true, avatar_url: true } },
      postTags: { with: { tag: true } }
    }
  });

  // votos do usuário logado (pra marcar has_voted)
  let votedIds = new Set<string>();
  if (userId) {
    const userVotes = await db.query.postVotes.findMany({
      where: eq(postVotes.user_id, userId),
    });
    votedIds = new Set(userVotes.map(v => v.post_id));
  }

  return allPosts.map(post => ({
    ...post,
    tags: post.postTags.map((pt) => pt.tag),
    has_voted: votedIds.has(post.id),
  }));
});

  // GET /posts/:slug (Público para published; admin vê draft/published)
  app.get('/:slug', async (request, reply) => {
    const params = validate(slugParamSchema, request.params, reply);
    if (!params) return;

    let isAdmin = false;
    let userId: string | null = null;
    try {
      await request.jwtVerify();
      isAdmin = request.user?.role === 'admin';
      userId = request.user?.id ?? null;
    } catch {}

    const post = await db.query.posts.findFirst({
      where: isAdmin
        ? and(eq(posts.slug, params.slug), ne(posts.status, 'deleted'))
        : and(eq(posts.slug, params.slug), eq(posts.status, 'published')),
      with: {
        author: { columns: { username: true, avatar_url: true } },
        postTags: { with: { tag: true } },
      },
    });

    if (!post) return reply.status(404).send({ message: 'Post not found' });

    let hasVoted = false;
    if (userId) {
      const vote = await db.query.postVotes.findFirst({
        where: and(eq(postVotes.post_id, post.id), eq(postVotes.user_id, userId)),
      });
      hasVoted = !!vote;
    }

    return {
      ...post,
      tags: post.postTags.map((pt) => pt.tag),
      has_voted: hasVoted,
    };
  });

  // POST /posts (Protegido - Admin)
  app.post('/', { onRequest: [app.requireAdmin] }, async (request, reply) => {
    const data = validate(postCreateSchema, request.body, reply);
    if (!data) return;

    const finalSlug = data.slug || slugify(data.title);

    try {
      let newPostData;
      await db.transaction(async (tx) => {
        const [newPost] = await tx
          .insert(posts)
          .values({
            title: data.title,
            slug: finalSlug,
            content: data.content,
            excerpt: data.excerpt,
            cover_image: data.cover_image,
            status: data.status || 'draft',
            author_id: request.user.id,
          })
          .returning();

        newPostData = newPost;

        if (data.tags && data.tags.length > 0) {
          for (const name of data.tags) {
            const tagSlug = slugify(name);
            let tag = await tx.query.tags.findFirst({ where: eq(tags.slug, tagSlug) });

            if (!tag) {
              const [createdTag] = await tx
                .insert(tags)
                .values({ name, slug: tagSlug })
                .returning();
              tag = createdTag;
            }

            await tx.insert(postTags).values({
              post_id: newPost.id,
              tag_id: tag.id,
            });
          }
        }
      });

      return reply.status(201).send({ message: 'Post created successfully', post: newPostData });
    } catch (err: any) {
      request.log.error(err);
      if (err.code === '23505') {
        return reply.status(400).send({ message: 'Slug already exists' });
      }
      return reply.status(500).send({ message: 'Error creating post' });
    }
  });

  // PUT /posts/:id (Protegido - Admin)
  app.put('/:id', { onRequest: [app.requireAdmin] }, async (request, reply) => {
    const params = validate(uuidParamSchema, request.params, reply);
    if (!params) return;
    const data = validate(postUpdateSchema, request.body, reply);
    if (!data) return;

    const updateData: Record<string, unknown> = { updated_at: new Date() };
    if (data.status !== undefined) updateData.status = data.status;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.content !== undefined) updateData.content = data.content;
    if (data.excerpt !== undefined) updateData.excerpt = data.excerpt;
    if (data.cover_image !== undefined) updateData.cover_image = data.cover_image;

    try {
      await db.update(posts).set(updateData).where(eq(posts.id, params.id));
      return reply.send({ message: 'Post updated' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: 'Error updating post' });
    }
  });

  // DELETE /posts/:id (Protegido - Admin) — soft delete
  app.delete('/:id', { onRequest: [app.requireAdmin] }, async (request, reply) => {
    const params = validate(uuidParamSchema, request.params, reply);
    if (!params) return;

    try {
      await db
        .update(posts)
        .set({ status: 'deleted', deleted_at: new Date() })
        .where(eq(posts.id, params.id));
      return reply.send({ message: 'Post deleted successfully' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: 'Error deleting post' });
    }
  });

  // POST /posts/:id/vote — registra upvote (usuário logado)
  app.post('/:id/vote', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = validate(uuidParamSchema, request.params, reply);
    if (!params) return;
    const userId = request.user.id;

    try {
      await db.transaction(async (tx) => {
        await tx.insert(postVotes).values({
          post_id: params.id,
          user_id: userId,
        });

        await tx
          .update(posts)
          .set({ upvotes_count: sql`${posts.upvotes_count} + 1` })
          .where(eq(posts.id, params.id));
      });

      return reply.send({ message: 'Voted' });
    } catch (error: any) {
      if (error.code === '23505') {
        return reply.status(400).send({ message: 'You already voted on this post' });
      }
      request.log.error(error);
      return reply.status(500).send({ message: 'Error voting' });
    }
  });

  // DELETE /posts/:id/vote — remove upvote
  app.delete('/:id/vote', { onRequest: [app.authenticate] }, async (request, reply) => {
    const params = validate(uuidParamSchema, request.params, reply);
    if (!params) return;
    const userId = request.user.id;

    try {
      await db.transaction(async (tx) => {
        const deleted = await tx
          .delete(postVotes)
          .where(and(eq(postVotes.post_id, params.id), eq(postVotes.user_id, userId)))
          .returning();

        if (deleted.length > 0) {
          await tx
            .update(posts)
            .set({ upvotes_count: sql`${posts.upvotes_count} - 1` })
            .where(eq(posts.id, params.id));
        }
      });

      return reply.send({ message: 'Vote removed' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: 'Error removing vote' });
    }
  });
}