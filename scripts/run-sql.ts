// Executa um arquivo .sql no banco configurado no .env, dentro de uma transação.
// Uso: npm run db:sql -- drizzle/0001_radar_items.sql
import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import postgres from 'postgres';

const file = process.argv[2];
if (!file) {
  console.error('Uso: npm run db:sql -- <arquivo.sql>');
  process.exit(1);
}

const sql = postgres({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: 'require',
});

async function main() {
  const path = resolve(process.cwd(), file);
  const body = readFileSync(path, 'utf8');
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
  });
  console.log(`ok: ${file} aplicado`);
}

main()
  .catch((err) => {
    console.error('falhou:', err.message);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
