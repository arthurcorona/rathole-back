import { pgTable, text, timestamp, boolean, uuid, integer, primaryKey } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// tables

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'reader'] }).default('reader'),
  avatar_url: text('avatar_url'),
  created_at: timestamp('created_at').defaultNow(),
});

export const posts = pgTable('posts', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  content: text('content'),
  excerpt: text('excerpt'),
  cover_image: text('cover_image'),
  status: text('status', { enum: ['draft', 'published'] }).default('draft'),
  author_id: uuid('author_id').references(() => users.id).notNull(),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
});

export const tags = pgTable('tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
});

// Tabela Pivô (Muitos-para-Muitos)
export const postTags = pgTable('post_tags', {
  post_id: uuid('post_id').references(() => posts.id).notNull(),
  tag_id: uuid('tag_id').references(() => tags.id).notNull(),
}, (t) => ({
  pk: primaryKey(t.post_id, t.tag_id),
}));

export const comments = pgTable('comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  content: text('content').notNull(),
  post_id: uuid('post_id').references(() => posts.id).notNull(),
  user_id: uuid('user_id').references(() => users.id), // Pode ser nulo (anon)
  guest_name: text('guest_name'), // anon
  parent_id: uuid('parent_id'), // (threads)
  is_approved: boolean('is_approved').default(true),
  created_at: timestamp('created_at').defaultNow(),
});

export const suggestions = pgTable('suggestions', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  user_id: uuid('user_id').references(() => users.id).notNull(),
  status: text('status', { enum: ['pending', 'reviewed'] }).default('pending'),
  upvotes_count: integer('upvotes_count').default(0),
  created_at: timestamp('created_at').defaultNow(),
});

export const suggestionVotes = pgTable('suggestion_votes', {
  id: uuid('id').defaultRandom().primaryKey(),
  suggestion_id: uuid('suggestion_id').references(() => suggestions.id).notNull(),
  user_id: uuid('user_id').references(() => users.id).notNull(),
});

// relations

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
  comments: many(comments),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, {
    fields: [posts.author_id],
    references: [users.id],
  }),
  postTags: many(postTags), //server.ts puxa aqui
  comments: many(comments),
}));

export const postTagsRelations = relations(postTags, ({ one }) => ({
  post: one(posts, {
    fields: [postTags.post_id],
    references: [posts.id],
  }),
  tag: one(tags, {
    fields: [postTags.tag_id],
    references: [tags.id],
  }),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  post: one(posts, {
    fields: [comments.post_id],
    references: [posts.id],
  }),
  user: one(users, {
    fields: [comments.user_id],
    references: [users.id],
  }),
  parent: one(comments, {
    fields: [comments.parent_id],
    references: [comments.id],
    relationName: 'replies',
  }),
  replies: many(comments, { relationName: 'replies' }),
}));

export const suggestionsRelations = relations(suggestions, ({ one }) => ({
  user: one(users, {
    fields: [suggestions.user_id],
    references: [users.id],
  }),
}));