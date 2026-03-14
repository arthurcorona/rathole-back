import fastify, { FastifyInstance } from 'fastify';
// Configurações
import { setupPlugins } from './src/core/setup';
import { setupDecorators } from './src/core/decorators';


// Rotas
import { authRoutes } from './src/modules/auth/auth.routes';
import { postRoutes } from './src/modules/posts/posts.routes';
import { commentRoutes } from './src/modules/comments/comments.routes';
import { suggestionRoutes } from './src/modules/suggestions/suggestions.routes';
import { uploadRoutes } from './src/modules/uploads/uploads.routes';

export const app: FastifyInstance = fastify({ logger: true });

export async function buildApp() {
  await setupPlugins(app);
  await setupDecorators(app);

  app.register(authRoutes, { prefix: '/auth' });
  app.register(postRoutes, { prefix: '/posts' });
  app.register(suggestionRoutes, { prefix: '/suggestions' });
  
  app.register(commentRoutes);
  app.register(uploadRoutes);
}