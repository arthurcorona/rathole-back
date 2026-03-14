import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import util from 'util';
import { pipeline } from 'stream';
import { slugify } from '../../utils/stringUtils';

const pump = util.promisify(pipeline);

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

    // Sanitizar nome — remove qualquer path traversal (../../)
    const nameWithoutExt = path.basename(data.filename, ext).replace(/[^a-zA-Z0-9_-]/g, '');
    const uniqueFilename = `${Date.now()}-${slugify(nameWithoutExt)}${ext}`;

    // Garante que o destino é dentro de /uploads
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    const saveTo = path.join(uploadsDir, uniqueFilename);

    // Proteção contra path traversal no destino
    if (!saveTo.startsWith(uploadsDir)) {
      return reply.status(400).send({ message: 'Caminho inválido' });
    }

    try {
      await pump(data.file, fs.createWriteStream(saveTo));

      // Checa se o stream estourou o limite de tamanho
      if (data.file.truncated) {
        // Remove o arquivo incompleto
        fs.unlinkSync(saveTo);
        return reply.status(400).send({ message: 'Arquivo muito grande. Máximo: 5MB' });
      }

      const baseUrl = process.env.API_URL || 'http://localhost:3333';
      const fileUrl = `${baseUrl}/uploads/${uniqueFilename}`;

      return reply.send({ url: fileUrl });

    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: 'Erro ao salvar o arquivo' });
    }
  });
}