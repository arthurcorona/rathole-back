import fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { db } from './db';
import { users, posts, tags, postTags, comments, suggestions, suggestionVotes } from './db/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import util from 'util';
import { pipeline } from 'stream';

const pump = util.promisify(pipeline);

// --- TIPAGENS ---
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: {
      id: string;
      role: 'admin' | 'reader';
      name: string;
    }
  }
}

const app = fastify({ logger: true });

// Configuração do CORS
app.register(cors, { 
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// Configuração do JWT
app.register(jwt, { secret: process.env.JWT_SECRET || 'supersecret' });

// aceitar upload e entregar link (Limite de 5MB)
app.register(multipart, {
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Cria a pasta uploads automaticamente se ela não existir
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Configuração para servir a pasta uploads como links públicos
app.register(fastifyStatic, {
  root: uploadsDir,
  prefix: '/uploads/', // As URLs vão ficar: /uploads/nome-da-foto.jpg
});

// Decorator de Autenticação (Qualquer usuário logado)
app.decorate("authenticate", async function(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ message: 'Unauthorized: Invalid Token' });
  }
});

// Decorator de Admin (Somente Administradores)
app.decorate("requireAdmin", async function(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify(); 
    if (request.user.role !== 'admin') {
      // Barreira de segurança ativada
      reply.status(403).send({ message: 'Forbidden(patético): Você Não tem poder o suficiente' });
    }
  } catch (err) {
    reply.status(401).send({ message: 'Unauthorized: Token inválido' });
  }
});

// Slugify Simples
function slugify(text: string) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
}

// ==========================================
// ROTAS DE AUTH
// ==========================================

app.post('/auth/login', async (request, reply) => {
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

app.post('/auth/signup', async (request, reply) => {
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

app.put('/auth/profile', { onRequest: [app.authenticate] }, async (request, reply) => {
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


// ==========================================
// ROTAS DE POSTS
// ==========================================

// 1. Listar Posts (Público)
app.get('/posts', async (request) => {
  const allPosts = await db.query.posts.findMany({
    where: eq(posts.status, 'published'),
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

// 2. Detalhes do Post (Público)
app.get('/posts/:slug', async (request, reply) => {
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

// 3. Criar Post (Protegido - Admin)
app.post('/posts', { onRequest: [app.requireAdmin] }, async (request, reply) => {
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

// 4. Atualizar Post (Protegido - Admin)
app.put('/posts/:id', { onRequest: [app.requireAdmin] }, async (request, reply) => {
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

// 5. Deletar Post (Protegido - Admin) -> Rota Nova!
app.delete('/posts/:id', { onRequest: [app.requireAdmin] }, async (request, reply) => {
  const { id } = request.params as { id: string };

  try {
    // Drizzle se encarrega de deletar as referências (tags/comments) se o ON DELETE CASCADE estiver configurado no schema
    await db.delete(posts).where(eq(posts.id, id));
    return reply.send({ message: 'Post deleted successfully' });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ message: 'Error deleting post' });
  }
});


// ==========================================
// ROTAS DE COMENTÁRIOS
// ==========================================

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

app.post('/comments', async (request, reply) => {
  let userId = null;
  
  try {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (token) {
      const decoded = app.jwt.verify(token) as any;
      userId = decoded.id;
    }
  } catch (e) {}

  const { content, post_id, parent_id, guest_name } = request.body as any;

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

// ==========================================
// ROTA DE UPLOAD DE ARQUIVOS
// ==========================================
// (Certifique-se de ter o 'path' importado lá no topo: import path from 'path';)

app.post('/upload', { onRequest: [app.authenticate] }, async (request, reply) => {
  const data = await request.file(); 
  
  if (!data) {
    return reply.status(400).send({ message: 'Nenhum arquivo enviado' });
  }

  // 1. Separa o nome da extensão (ex: .png, .jpg)
  const ext = path.extname(data.filename); 
  const nameWithoutExt = path.basename(data.filename, ext);

  // 2. Passa o slugify SÓ no nome, e devolve o ponto da extensão no final
  const uniqueFilename = `${Date.now()}-${slugify(nameWithoutExt)}${ext}`;
  const saveTo = path.join(__dirname, 'uploads', uniqueFilename);

  try {
    await pump(data.file, fs.createWriteStream(saveTo));

    // 3. Força a URL base correta (Ajuste para o IP do seu Raspberry Pi depois se precisar)
    const baseUrl = process.env.API_URL || 'http://localhost:3333';
    const fileUrl = `${baseUrl}/uploads/${uniqueFilename}`;

    return reply.send({ url: fileUrl });

  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ message: 'Erro ao salvar o arquivo' });
  }
});

// ==========================================
// ROTAS DE SUGESTÕES
// ==========================================

app.get('/suggestions', async (request) => {
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

app.post('/suggestions', { onRequest: [app.authenticate] }, async (request, reply) => {
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

app.post('/suggestions/:id/vote', { onRequest: [app.authenticate] }, async (request, reply) => {
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

app.delete('/suggestions/:id/vote', { onRequest: [app.authenticate] }, async (request, reply) => {
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

// ==========================================
// INICIAR SERVER
// ==========================================

const port = Number(process.env.PORT) || 3333;
app.listen({ port, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  console.log(`🚀 Server rodando em: ${address}`);
});