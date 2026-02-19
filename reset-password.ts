import 'dotenv/config';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';

async function main() {
  console.log('🔑 Iniciando reset de senha...');

  const sql = postgres({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  // A senha que você quer (que passa no validador do front)
  const novaSenha = '26121991'; 
  
  // 1. Gerar o Hash correto
  const hash = await bcrypt.hash(novaSenha, 10);

  try {
    // 2. Atualizar no banco (Vamos buscar pelo Username 'Corona' pra não errar o email de novo rs)
    const resultado = await sql`
      UPDATE users 
      SET password_hash = ${hash} 
      WHERE username = 'Corona'
      RETURNING email
    `;

    if (resultado.length > 0) {
      console.log('✅ Sucesso! Senha atualizada.');
      console.log(`👤 Usuário afetado: ${resultado[0].email}`);
      console.log(`🔑 Nova senha para login: ${novaSenha}`);
    } else {
      console.error('❌ Erro: Usuário "Corona" não encontrado no banco.');
    }

  } catch (error) {
    console.error('❌ Erro no banco:', error);
  } finally {
    await sql.end();
  }
  process.exit();
}

main();