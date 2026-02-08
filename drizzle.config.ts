import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts', // Onde está o seu código das tabelas
  out: './drizzle',               // Onde ele vai salvar o SQL gerado
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.DB_HOST!,
    user: process.env.DB_USER!,
    password: process.env.DB_PASS!,
    database: process.env.DB_NAME!,
    port: Number(process.env.DB_PORT!),
    ssl: false, // Homelab geralmente não usa SSL interno
  },
});