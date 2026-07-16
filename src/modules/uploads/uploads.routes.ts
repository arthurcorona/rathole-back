import { FastifyInstance } from 'fastify';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { slugify } from '../../utils/stringUtils';

// Cliente Supabase (service_role: só roda no backend, nunca exposto ao browser)
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);
const BUCKET = process.env.SUPABASE_BUCKET || 'uploads';

// Tipos permitidos
const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

// Tamanho máximo: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export async function uploadRoutes(app: FastifyInstance) {

  app.post('/upload', { onRequest: [app.authenticate] }, async (request, reply) => {
    const data = await request.file({ limits: { fileSize: MAX_FILE_SIZE } });

    if (!data) {
      return reply.status(400).send({ message: 'Nenhum arquivo enviado' });
    }

    // Validar MIME type
    if (!ALLOWED_MIMES.has(data.mimetype)) {
      // Consome o stream pra não travar
      data.file.resume();
      return reply.status(400).send({ message: 'Tipo de arquivo não permitido. Use: jpg, png, gif, webp' });
    }

    // Validar extensão
    const ext = path.extname(data.filename).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      data.file.resume();
      return reply.status(400).send({ message: 'Extensão de arquivo não permitida' });
    }

    // Lê o arquivo em memória (respeitando o limite de 5MB)
    const buffer = await data.toBuffer();
    if (data.file.truncated || buffer.length > MAX_FILE_SIZE) {
      return reply.status(400).send({ message: 'Arquivo muito grande. Máximo: 5MB' });
    }

    // Sanitiza o nome — sem path traversal nem caracteres estranhos
    const nameWithoutExt = path.basename(data.filename, ext).replace(/[^a-zA-Z0-9_-]/g, '');
    const uniqueFilename = `${Date.now()}-${slugify(nameWithoutExt)}${ext}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(uniqueFilename, buffer, {
        contentType: data.mimetype,
        upsert: false,
      });

    if (error) {
      request.log.error(error);
      return reply.status(500).send({ message: 'Erro ao salvar o arquivo' });
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(uniqueFilename);
    return reply.send({ url: pub.publicUrl });
  });
}
