import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { users } from './src/db/schema';

async function main() {
  console.log('🌱 Semeando o banco de dados...');

  // Conexão
  const client = postgres({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });
  const db = drizzle(client);

  // Dados do Admin
  const adminPassword = 'admin';
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  try {
    console.log("cp,ep");
    
    await db.insert(users).values({
      username: 'Corona',
      email: 'coronggp@gmail.com',
      password_hash: passwordHash,
      role: 'admin',
      avatar_url: 'https://media.discordapp.net/attachments/833745360940826695/1470060728420536391/image.png?ex=6989ec3e&is=69889abe&hm=24333534e1b8f87844243fecebb00a1d22e8f54f4d2f74337355f8266859dd7e&=&format=webp&quality=lossless' 
    });
    console.log('✅ Admin criado com sucesso!');
    console.log('📧 Email: corona@rathole.com');
    console.log('🔑 Senha Temporária: admin');
  } catch (error: any) {
    if (error.code === '23505') {
      console.log('⚠️ O usuário Admin já existe.');
    } else {
      console.error('❌ Erro ao criar admin:', error);
    }
  }

  await client.end();
  process.exit();
  console.log("final");
  
}

main();