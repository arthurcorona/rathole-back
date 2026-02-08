import { pgTable, uuid, text, timestamp, boolean, integer, pgEnum, primaryKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const roleEnum = pgEnum('role', ['admin', 'reader']);
export const statusEnum = pgEnum('status', ['draft', 'published']);
export const suggStatusEnum = pgEnum('suggestion_status', ['pending', 'reviewed', 'completed']);

// Users
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: text('username').unique().notNull(),
  email: text('email').unique().notNull(),
  password_hash: text('password_hash').notNull(),
  avatar_url: text('avatar_url'),
  role: roleEnum('role').default('reader').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
});

// Posts
export const posts = pgTable('posts', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  slug: text('slug').unique().notNull(),
  content: text('content'),
  excerpt: text('excerpt'),
  cover_image: text('cover_image'),
  status: statusEnum('status').default('draft'),
  author_id: uuid('author_id').references(() => users.id).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
});

// Comments
export const comments = pgTable('comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  post_id: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }).notNull(),
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  guest_name: text('guest_name'),
  content: text('content').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
});

// Suggestions
export const suggestions = pgTable('suggestions', {
  id: uuid('id').defaultRandom().primaryKey(),
  user_id: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: suggStatusEnum('status').default('pending'),
  upvotes_count: integer('upvotes_count').default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
});

// Relations (Ajuda nas queries depois)
export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, { fields: [posts.author_id], references: [users.id] }),
  comments: many(comments),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  post: one(posts, { fields: [comments.post_id], references: [posts.id] }),
  user: one(users, { fields: [comments.user_id], references: [users.id] }),
}));