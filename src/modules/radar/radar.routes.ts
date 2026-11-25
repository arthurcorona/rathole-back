import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'crypto';
import { db } from '../../db';
import { radarItems } from '../../db/schema';
import { and, eq, desc, inArray, sql, type SQL } from 'drizzle-orm';
import {
  uuidParamSchema,
  radarIngestSchema,
  radarAdminQuerySchema,
  radarPatchSchema,
  radarDailyQuerySchema,
  validate,
} from '../../core/validation';

// Fuso usado para definir "dia" e "semana" das edições.
const TZ = 'America/Sao_Paulo';

// Publicação automática: em cada rodada diária, os N itens de maior pontuação vão
// direto para o Radar dos membros, sem curadoria. O resto fica na fila.
// Só entram notícias recentes, para que importar notas antigas não encha o
// "Radar de hoje" com notícia velha.
const AUTO_PUBLISH_TOP = Number(process.env.RADAR_AUTO_PUBLISH ?? 10);
const AUTO_PUBLISH_MAX_AGE_MS = 72 * 60 * 60 * 1000;

// Abas do painel de curadoria.
const ADMIN_VIEWS: Record<'radar' | 'highlights' | 'queue' | 'rejected', { where: SQL | undefined; orderBy: SQL[] }> = {
  // publicados no Radar dos membros (automáticos ou aprovados à mão)
  radar: {
    where: and(eq(radarItems.status, 'approved'), eq(radarItems.tier, 'members')),
    orderBy: [sql`${radarItems.approved_at} desc nulls last`, desc(radarItems.score)],
  },
  // destaques = Dossiê semanal público; semana mais recente primeiro, depois posição
  highlights: {
    where: and(eq(radarItems.status, 'approved'), eq(radarItems.tier, 'public')),
    orderBy: [
      sql`date_trunc('week', ${radarItems.approved_at} AT TIME ZONE ${TZ}) desc nulls last`,
      sql`${radarItems.rank} asc nulls last`,
      desc(radarItems.score),
    ],
  },
  queue: {
    where: eq(radarItems.status, 'pending'),
    orderBy: [sql`coalesce(${radarItems.published_at}, ${radarItems.created_at}) desc`, desc(radarItems.score)],
  },
  rejected: {
    where: eq(radarItems.status, 'rejected'),
    orderBy: [sql`coalesce(${radarItems.published_at}, ${radarItems.created_at}) desc`, desc(radarItems.score)],
  },
};

// Token de serviço (não é JWT): o radar roda fora do repo e se identifica por header.
// Comparação em tempo constante; sem RADAR_TOKEN configurado a rota fica fechada.
async function checkRadarToken(request: FastifyRequest, reply: FastifyReply) {
  const expected = process.env.RADAR_TOKEN;
  const given = request.headers['x-radar-token'];
  if (!expected || typeof given !== 'string') {
    return reply.status(401).send({ message: 'Unauthorized' });
  }
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return reply.status(401).send({ message: 'Unauthorized' });
  }
}

export async function radarRoutes(app: FastifyInstance) {

  // POST /radar/items — ingestão pelo serviço externo (x-radar-token)
  app.post(
    '/items',
    { preHandler: checkRadarToken, bodyLimit: 2 * 1024 * 1024 },
    async (request, reply) => {
      const data = validate(radarIngestSchema, request.body, reply);
      if (!data) return;

      // daily -> edição de membros; weekly -> dossiê público
      const defaultTier = data.run_type === 'daily' ? 'members' : 'public';

      const values = data.items.map((item) => ({
        title: item.title,
        link: item.link,
        source: item.source,
        summary: item.summary ?? null,
        score: item.score ?? 0,
        hits: item.hits ?? null,
        published_at: item.published_at ? new Date(item.published_at) : null,
        run_type: data.run_type,
        tier: defaultTier as 'members' | 'public',
        status: 'pending' as const,
      }));

      try {
        const result = await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(radarItems)
            .values(values)
            .onConflictDoNothing({ target: radarItems.link })
            .returning({ id: radarItems.id, score: radarItems.score, published_at: radarItems.published_at });

          let published = 0;
          if (data.run_type === 'daily' && AUTO_PUBLISH_TOP > 0) {
            const cutoff = Date.now() - AUTO_PUBLISH_MAX_AGE_MS;
            const picks = inserted
              .filter((r) => !r.published_at || r.published_at.getTime() >= cutoff)
              .sort((a, b) => b.score - a.score)
              .slice(0, AUTO_PUBLISH_TOP)
              .map((r) => r.id);
            if (picks.length > 0) {
              const rows = await tx
                .update(radarItems)
                .set({ status: 'approved', approved_at: new Date() })
                .where(inArray(radarItems.id, picks))
                .returning({ id: radarItems.id });
              published = rows.length;
            }
          }
          return { inserted: inserted.length, published };
        });

        return reply.status(201).send({
          inserted: result.inserted,
          skipped: values.length - result.inserted,
          published: result.published,
        });
      } catch (error) {
        request.log.error({ err: error }, 'radar ingest failed');
        return reply.status(500).send({ message: 'Erro ao salvar itens do radar' });
      }
    },
  );

  // GET /radar/admin?view=radar&page=1&limit=10 — painel de curadoria paginado (admin)
  app.get('/admin', { onRequest: [app.requireAdmin] }, async (request, reply) => {
    const query = validate(radarAdminQuerySchema, request.query, reply);
    if (!query) return;

    const view = ADMIN_VIEWS[query.view];
    const [items, [{ total }]] = await Promise.all([
      db.query.radarItems.findMany({
        where: view.where,
        orderBy: view.orderBy,
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      }),
      db.select({ total: sql<number>`count(*)::int` }).from(radarItems).where(view.where),
    ]);

    return { items, total, page: query.page, limit: query.limit };
  });

  // PATCH /radar/admin/:id — aprovar / descartar / trocar tier / definir posição (admin)
  app.patch('/admin/:id', { onRequest: [app.requireAdmin] }, async (request, reply) => {
    const params = validate(uuidParamSchema, request.params, reply);
    if (!params) return;
    const data = validate(radarPatchSchema, request.body, reply);
    if (!data) return;

    const current = await db.query.radarItems.findFirst({
      where: eq(radarItems.id, params.id),
      columns: { id: true, status: true, tier: true, rank: true, approved_at: true },
    });
    if (!current) return reply.status(404).send({ message: 'Item não encontrado' });

    const nextStatus = data.status ?? current.status;
    const nextTier = data.tier ?? current.tier;

    const set: Partial<typeof radarItems.$inferInsert> = {};

    if (data.status !== undefined) {
      set.status = data.status;
      // approved_at só existe enquanto o item está aprovado
      set.approved_at = data.status === 'approved' ? (current.approved_at ?? new Date()) : null;
    }
    if (data.tier !== undefined) set.tier = data.tier;

    // rank só faz sentido no dossiê (tier public, aprovado)
    if (data.rank !== undefined) {
      if (data.rank !== null && nextTier !== 'public') {
        return reply.status(400).send({ message: 'Posição só se aplica a itens do dossiê (tier public)' });
      }
      set.rank = data.rank;
    }
    if (nextTier !== 'public' || nextStatus !== 'approved') {
      set.rank = null;
    }

    const [updated] = await db
      .update(radarItems)
      .set(set)
      .where(eq(radarItems.id, params.id))
      .returning();

    return reply.send(updated);
  });

  // GET /radar/daily?date=YYYY-MM-DD | ?days=7 — edição de membros (member/admin)
  // Membros veem tudo que foi publicado, inclusive os destaques (tier public).
  app.get('/daily', { onRequest: [app.requireMember] }, async (request, reply) => {
    const query = validate(radarDailyQuerySchema, request.query, reply);
    if (!query) return;

    const base = eq(radarItems.status, 'approved');

    // janela: últimos N dias (ver todos) OU um dia específico (default hoje, fuso SP)
    const window = query.days
      ? sql`${radarItems.approved_at} >= now() - make_interval(days => ${query.days})`
      : query.date
        ? sql`(${radarItems.approved_at} AT TIME ZONE ${TZ})::date = ${query.date}::date`
        : sql`(${radarItems.approved_at} AT TIME ZONE ${TZ})::date = (now() AT TIME ZONE ${TZ})::date`;

    const items = await db.query.radarItems.findMany({
      where: and(base, window),
      orderBy: [desc(radarItems.score), desc(radarItems.approved_at)],
    });

    const [{ today }] = await db.execute<{ today: string }>(
      sql`select to_char(now() AT TIME ZONE ${TZ}, 'YYYY-MM-DD') as today`,
    );

    return {
      date: query.days ? null : (query.date ?? today),
      days: query.days ?? null,
      items,
    };
  });

  // GET /radar/weekly — Dossiê semanal (público)
  // Semana (seg–dom, fuso SP) do item público aprovado mais recente: cobre a semana
  // corrente se ela tiver itens, senão a última que tiver.
  app.get('/weekly', async () => {
    const weekExpr = sql`date_trunc('week', ${radarItems.approved_at} AT TIME ZONE ${TZ})`;
    // subquery com alias próprio (r) para não herdar o alias da query externa
    const latestWeek = sql`(
      select date_trunc('week', max(r.approved_at) AT TIME ZONE ${TZ})
      from radar_items r
      where r.status = 'approved' and r.tier = 'public'
    )`;

    const items = await db.query.radarItems.findMany({
      where: and(
        eq(radarItems.status, 'approved'),
        eq(radarItems.tier, 'public'),
        sql`${weekExpr} = ${latestWeek}`,
      ),
      orderBy: [sql`${radarItems.rank} asc nulls last`, desc(radarItems.score)],
    });

    const week_start = items.length
      ? (await db.execute<{ ws: string }>(sql`select to_char(${latestWeek}, 'YYYY-MM-DD') as ws`))[0].ws
      : null;

    return { week_start, items };
  });
}
