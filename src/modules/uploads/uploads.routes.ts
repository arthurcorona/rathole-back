import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import util from 'util';
import { pipeline } from 'stream';
import { slugify } from '../../utils/stringUtils';

const pump = util.promisify(pipeline);

export async function uploadRoutes(app: FastifyInstance) {
  
  // POST /upload
  app.post('/upload', { onRequest: [app.authenticate] }, async (request, reply) => {
    const data = await request.file(); 
    
    if (!data) {
      return reply.status(400).send({ message: 'Nenhum arquivo enviado' });
    }

    const ext = path.extname(data.filename); 
    const nameWithoutExt = path.basename(data.filename, ext);

    const uniqueFilename = `${Date.now()}-${slugify(nameWithoutExt)}${ext}`;
    const saveTo = path.join(process.cwd(), 'uploads', uniqueFilename);

    try {
      await pump(data.file, fs.createWriteStream(saveTo));

      const baseUrl = process.env.API_URL || 'http://localhost:3333';
      const fileUrl = `${baseUrl}/uploads/${uniqueFilename}`;

      return reply.send({ url: fileUrl });

    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ message: 'Erro ao salvar o arquivo' });
    }
  });

}