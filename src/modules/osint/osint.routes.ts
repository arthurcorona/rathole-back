import { FastifyInstance, FastifyReply } from 'fastify';
import {
  csiCaseSchema,
  csiNoteSchema,
  csiTargetSchema,
  osintFilePathSchema,
  osintIntIdParamSchema,
  osintJobIdParamSchema,
  osintJobSchema,
  osintJobsQuerySchema,
  validate,
} from '../../core/validation';

// Ponte para a API do ratosint (serviço separado no Render). O token do ratosint fica só
// aqui no back; o front fala com /osint/* usando o JWT do rathole, e o id do usuário vai
// no header X-Actor.
//
// Cada usuário só vê o que é dele:
// - CSI (casos, alvos, notas): o ratosint resolve tudo pelo id E pelo dono (X-Actor) e
//   responde 404 para o que é de outro.
// - Consultas e arquivos: no ratosint são globais, então o filtro por dono (requested_by)
//   é feito aqui.
//
// Fase de teste: tudo só para admin. Para abrir a membros ainda falta fechar no ratosint
// o vínculo de identidades e as notas sem caso, que hoje não conferem o dono.

// O plano free do Render leva cerca de 1 min para acordar um serviço que dormiu.
const TIMEOUT_MS = 90_000;
const JOBS_FETCH_LIMIT = 200; // máximo do ratosint; o filtro por dono vem depois

class RatosintError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function ratosint(path: string, actor: string, init: { method?: Method; body?: unknown } = {}): Promise<Response> {
  const base = process.env.RATOSINT_URL?.replace(/\/+$/, '');
  const token = process.env.RATOSINT_API_TOKEN;
  if (!base || !token) {
    throw new RatosintError(503, 'OSINT não configurado no servidor (RATOSINT_URL / RATOSINT_API_TOKEN).');
  }

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Actor': actor,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new RatosintError(504, 'O ratosint não respondeu. Ele pode estar acordando: tente de novo em 1 minuto.');
  }

  if (res.ok) return res;

  // 401/403 aqui significa token errado no servidor. Nunca repassar 401: o front
  // desloga o usuário em qualquer resposta 401.
  if (res.status === 401 || res.status === 403) {
    throw new RatosintError(502, 'O ratosint recusou o token do servidor (confira RATOSINT_API_TOKEN).');
  }
  let message = `O ratosint respondeu ${res.status}.`;
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') message = body.detail;
  } catch {
    /* corpo sem JSON */
  }
  // 4xx (tipo de consulta inválido, caso que não é seu) passa com a mensagem; 5xx vira 502.
  throw new RatosintError(res.status >= 500 ? 502 : res.status, message);
}

async function ratosintJson<T>(path: string, actor: string, init?: { method?: Method; body?: unknown }) {
  const res = await ratosint(path, actor, init);
  return { status: res.status, body: (await res.json()) as T };
}

/** Roda o handler e transforma RatosintError em resposta com a mensagem. */
async function handle(reply: FastifyReply, fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RatosintError) return reply.status(err.status).send({ message: err.message });
    throw err;
  }
}

/** Repassa a resposta JSON do ratosint como está. */
function forward(reply: FastifyReply, path: string, actor: string, init?: { method?: Method; body?: unknown }) {
  return handle(reply, async () => {
    const { status, body } = await ratosintJson(path, actor, init);
    return reply.status(status).send(body);
  });
}

type JobDto = { requested_by?: string; result?: { files?: unknown } | null };

/** Busca a consulta e confere que foi o próprio usuário que a pediu. */
async function ownJob(id: string, actor: string): Promise<JobDto> {
  const { body } = await ratosintJson<JobDto>(`/api/jobs/${id}`, actor);
  if (body.requested_by !== actor) throw new RatosintError(404, 'consulta não encontrada');
  return body;
}

export async function osintRoutes(app: FastifyInstance) {
  const adminOnly = { onRequest: [app.requireAdmin] };

  // ------------------------------------------------------------------ serviço

  // GET /osint/status — saúde do ratosint (banco, cotas). O front chama ao abrir o
  // painel, o que também acorda o serviço.
  app.get('/status', adminOnly, async (request, reply) => forward(reply, '/api/health', request.user.id));

  // GET /osint/kinds — tipos de consulta disponíveis
  app.get('/kinds', adminOnly, async (request, reply) => forward(reply, '/api/kinds', request.user.id));

  // ------------------------------------------------------------------ consultas

  // GET /osint/jobs?limit= — consultas recentes do próprio usuário (sem o resultado)
  app.get('/jobs', adminOnly, async (request, reply) => {
    const query = validate(osintJobsQuerySchema, request.query, reply);
    if (!query) return;
    const actor = request.user.id;
    return handle(reply, async () => {
      const { body } = await ratosintJson<JobDto[]>(`/api/jobs?limit=${JOBS_FETCH_LIMIT}`, actor);
      return body.filter((j) => j.requested_by === actor).slice(0, query.limit ?? 30);
    });
  });

  // POST /osint/jobs — dispara uma consulta em segundo plano (opcionalmente ligada a um
  // alvo do CSI; o ratosint confere que o alvo é de um caso do usuário)
  app.post('/jobs', adminOnly, async (request, reply) => {
    const body = validate(osintJobSchema, request.body, reply);
    if (!body) return;
    return forward(reply, '/api/jobs', request.user.id, {
      method: 'POST',
      body: { kind: body.kind, value: body.value, opts: body.opts ?? {}, target_id: body.target_id ?? null },
    });
  });

  // GET /osint/jobs/:id — status e resultado de uma consulta do próprio usuário
  app.get('/jobs/:id', adminOnly, async (request, reply) => {
    const params = validate(osintJobIdParamSchema, request.params, reply);
    if (!params) return;
    return handle(reply, () => ownJob(params.id, request.user.id));
  });

  // GET /osint/jobs/:id/files/<caminho> — arquivo gerado por uma consulta do próprio
  // usuário (JSON, CSV, imagens). Só caminhos listados no resultado daquela consulta.
  app.get('/jobs/:id/files/*', adminOnly, async (request, reply) => {
    const params = validate(osintJobIdParamSchema.extend(osintFilePathSchema.shape), request.params, reply);
    if (!params) return;
    const actor = request.user.id;
    const path = params['*'];

    return handle(reply, async () => {
      const job = await ownJob(params.id, actor);
      const files = Array.isArray(job.result?.files) ? (job.result.files as unknown[]) : [];
      if (!files.includes(path)) throw new RatosintError(404, 'arquivo não encontrado nesta consulta');

      const encoded = path.split('/').map(encodeURIComponent).join('/');
      const res = await ratosint(`/api/files/${encoded}`, actor);
      const filename = (path.split('/').pop() || 'arquivo').replace(/[^\w.-]/g, '_');
      return reply
        .header('Content-Type', res.headers.get('content-type') ?? 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(Buffer.from(await res.arrayBuffer()));
    });
  });

  // ------------------------------------------------------------------ CSI: casos

  // GET /osint/csi/cases — investigações do usuário
  app.get('/csi/cases', adminOnly, async (request, reply) => forward(reply, '/api/csi/cases', request.user.id));

  // POST /osint/csi/cases — nova investigação
  app.post('/csi/cases', adminOnly, async (request, reply) => {
    const body = validate(csiCaseSchema, request.body, reply);
    if (!body) return;
    return forward(reply, '/api/csi/cases', request.user.id, { method: 'POST', body });
  });

  // GET /osint/csi/cases/:id — caso com alvos e notas do caso
  app.get('/csi/cases/:id', adminOnly, async (request, reply) => {
    const params = validate(osintIntIdParamSchema, request.params, reply);
    if (!params) return;
    return forward(reply, `/api/csi/cases/${params.id}`, request.user.id);
  });

  // PATCH /osint/csi/cases/:id — renomear, descrever, encerrar/reabrir
  app.patch('/csi/cases/:id', adminOnly, async (request, reply) => {
    const params = validate(osintIntIdParamSchema, request.params, reply);
    if (!params) return;
    const body = validate(csiCaseSchema, request.body, reply);
    if (!body) return;
    return forward(reply, `/api/csi/cases/${params.id}`, request.user.id, { method: 'PATCH', body });
  });

  // DELETE /osint/csi/cases/:id — apaga o caso com alvos, notas e anexos
  app.delete('/csi/cases/:id', adminOnly, async (request, reply) => {
    const params = validate(osintIntIdParamSchema, request.params, reply);
    if (!params) return;
    return forward(reply, `/api/csi/cases/${params.id}`, request.user.id, { method: 'DELETE' });
  });

  // POST /osint/csi/cases/:id/targets — novo alvo (pessoa ou empresa) no caso
  app.post('/csi/cases/:id/targets', adminOnly, async (request, reply) => {
    const params = validate(osintIntIdParamSchema, request.params, reply);
    if (!params) return;
    const body = validate(csiTargetSchema, request.body, reply);
    if (!body) return;
    return forward(reply, `/api/csi/cases/${params.id}/targets`, request.user.id, { method: 'POST', body });
  });

  // POST /osint/csi/cases/:id/notes — nota geral do caso
  app.post('/csi/cases/:id/notes', adminOnly, async (request, reply) => {
    const params = validate(osintIntIdParamSchema, request.params, reply);
    if (!params) return;
    const body = validate(csiNoteSchema, request.body, reply);
    if (!body) return;
    return forward(reply, `/api/csi/cases/${params.id}/notes`, request.user.id, { method: 'POST', body });
  });

  // ------------------------------------------------------------------ CSI: alvos

  // GET /osint/csi/targets/:id — alvo com notas, consultas, identidades e snapshots
  app.get('/csi/targets/:id', adminOnly, async (request, reply) => {
    const params = validate(osintIntIdParamSchema, request.params, reply);
    if (!params) return;
    return forward(reply, `/api/csi/targets/${params.id}`, request.user.id);
  });

  // PATCH /osint/csi/targets/:id — nome, tipo, resumo
  app.patch('/csi/targets/:id', adminOnly, async (request, reply) => {
    const params = validate(osintIntIdParamSchema, request.params, reply);
    if (!params) return;
    const body = validate(csiTargetSchema, request.body, reply);
    if (!body) return;
    return forward(reply, `/api/csi/targets/${params.id}`, request.user.id, { method: 'PATCH', body });
  });

  // DELETE /osint/csi/targets/:id
  app.delete('/csi/targets/:id', adminOnly, async (request, reply) => {
    const params = validate(osintIntIdParamSchema, request.params, reply);
    if (!params) return;
    return forward(reply, `/api/csi/targets/${params.id}`, request.user.id, { method: 'DELETE' });
  });

  // POST /osint/csi/targets/:id/notes — nota do alvo
  app.post('/csi/targets/:id/notes', adminOnly, async (request, reply) => {
    const params = validate(osintIntIdParamSchema, request.params, reply);
    if (!params) return;
    const body = validate(csiNoteSchema, request.body, reply);
    if (!body) return;
    return forward(reply, `/api/csi/targets/${params.id}/notes`, request.user.id, { method: 'POST', body });
  });

  // GET /osint/csi/targets/:id/timeline — consultas, notas e vínculos do alvo em ordem
  app.get('/csi/targets/:id/timeline', adminOnly, async (request, reply) => {
    const params = validate(osintIntIdParamSchema, request.params, reply);
    if (!params) return;
    return forward(reply, `/api/csi/targets/${params.id}/timeline`, request.user.id);
  });

  // ------------------------------------------------------------------ CSI: notas

  // PATCH /osint/csi/notes/:id
  app.patch('/csi/notes/:id', adminOnly, async (request, reply) => {
    const params = validate(osintIntIdParamSchema, request.params, reply);
    if (!params) return;
    const body = validate(csiNoteSchema, request.body, reply);
    if (!body) return;
    return forward(reply, `/api/csi/notes/${params.id}`, request.user.id, { method: 'PATCH', body });
  });

  // DELETE /osint/csi/notes/:id
  app.delete('/csi/notes/:id', adminOnly, async (request, reply) => {
    const params = validate(osintIntIdParamSchema, request.params, reply);
    if (!params) return;
    return forward(reply, `/api/csi/notes/${params.id}`, request.user.id, { method: 'DELETE' });
  });
}
