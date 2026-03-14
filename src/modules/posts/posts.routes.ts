import { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { posts, tags, postTags } from '../../db/schema';
import { eq, desc } from 'drizzle-orm';
import { slugify } from '../../utils/stringUtils';

export async function postRoutes(app: FastifyInstance) {
console.error('>>> POSTS ROUTES LOADED <<<');
  // Rota: GET /posts (Público)
app.get('/', async (request) => {
  let isAdmin = false;
  try {
    await request.jwtVerify();
    request.log.info({ user: request.user }, '>>> JWT User');
    isAdmin = request.user?.role === 'admin';
  } catch(err: any) {
    request.log.info({ error: err.message }, '>>> JWT falhou');
  }

  request.log.info({ isAdmin }, '>>> isAdmin');

  const allPosts = await db.query.posts.findMany({
    ...(isAdmin ? {} : { where: eq(posts.status, 'published') }),
    orderBy: [desc(posts.created_at)],
    with: {
      author: { columns: { username: true, avatar_url: true } },
      postTags: { with: { tag: true } }
    }
  });

  return allPosts.map(post => ({
    ...post,
    tags: post.postTags.map((pt) => pt.tag)
  }));
});

  // GET /posts/:slug (Público)
  app.get('/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const post = await db.query.posts.findFirst({
      where: eq(posts.slug, slug),
      with: {
        author: { columns: { username: true, avatar_url: true } },
        postTags: { with: { tag: true } }
      }
    });

    if (!post) return reply.status(404).send({ message: 'Post not found' });

    return {
      ...post,
      tags: post.postTags.map((pt) => pt.tag)
    };
  });

  // POST /posts (Protegido - Admin)
  app.post('/', { onRequest: [app.requireAdmin] }, async (request, reply) => {
    const { title, slug, content, excerpt, cover_image, status, tags: tagNames } = request.body as any;
    const finalSlug = slug || slugify(title);

    try {
      let newPostData;
      await db.transaction(async (tx) => {
        const [newPost] = await tx.insert(posts).values({
          title, 
          slug: finalSlug, 
          content, 
          excerpt,
          cover_image,
          status: status || 'draft',
          author_id: request.user.id, 
        }).returning();
        
        newPostData = newPost;

        if (tagNames && Array.isArray(tagNames)) {
          for (const name of tagNames) {
            const tagSlug = slugify(name);
            let tag = await tx.query.tags.findFirst({ where: eq(tags.slug, tagSlug) });

            if (!tag) {
              const [createdTag] = await tx.insert(tags).values({ name, slug: tagSlug }).returning();
              tag = createdTag;
            }

            await tx.insert(postTags).values({
              post_id: newPost.id,
              tag_id: tag.id
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
    const { id } = request.params as { id: string };
    const body = request.body as any;

    const updateData: any = { updated_at: new Date() };
    if (body.status !== undefined) updateData.status = body.status;
    if (body.title !== undefined) updateData.title = body.title;
    if (body.content !== undefined) updateData.content = body.content;
    if (body.excerpt !== undefined) updateData.excerpt = body.excerpt;
    if (body.cover_image !== undefined) updateData.cover_image = body.cover_image;

    try {
      await db.update(posts)
        .set(updateData)
        .where(eq(posts.id, id));

      return reply.send({ message: 'Post updated' });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: 'Error updating post' });
    }
  });

  // DELETE /posts/:id (Protegido - Admin)


  app.delete('/:id', { onRequest: [app.requireAdmin] }, async (request, reply) => {
  const { id } = request.params as { id: string };

  try {
    // deletar primeiro as tags
    await db.delete(postTags).where(eq(postTags.post_id, id));
    // deletar post
    await db.delete(posts).where(eq(posts.id, id));
    return reply.send({ message: 'Post deleted successfully' });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ message: 'Error deleting post' });
  }
});
}