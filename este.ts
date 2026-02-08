import 'dotenv/config';
import postgres from 'postgres';

async function teste() {
  console.log("🔌 Iniciando teste de conexão (Modo Objeto)...");

  // Verifica se as novas variáveis existem
  if (!process.env.DB_HOST || !process.env.DB_PASS) {
    console.error("❌ ERRO: Faltam variáveis no .env (DB_HOST ou DB_PASS)");
    process.exit(1);
  }

  console.log(`📡 Tentando conectar em: ${process.env.DB_HOST}:${process.env.DB_PORT}`);

  // Conecta usando o objeto, pegando as variáveis novas
  const sql = postgres({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    connect_timeout: 5
  });

  try {
    const resultado = await sql`SELECT version()`;
    console.log("\n✅ SUCESSO! CONECTOU!");
    console.log(`📦 Versão do Banco: ${resultado[0].version}`);
  } catch (erro) {
    console.error("\n❌ FALHA NA CONEXÃO:");
    console.error(erro);
  } finally {
    await sql.end();
    console.log("👋 Teste finalizado.");
  }
}

teste();