import { z, ZodSchema } from 'zod';
import { FastifyReply } from 'fastify';
import dns from 'dns/promises';

const httpUrl = z
  .string()
  .url('URL inválida')
  .max(2000)
  .refine((u) => /^https?:\/\//.test(u), {
    message: 'URL deve começar com http:// ou https://',
  });

const slugRegex = /^[a-z0-9-]+$/;
const usernameRegex = /^[a-zA-Z0-9_-]+$/;

// Params
export const uuidParamSchema = z.object({ id: z.string().uuid('ID inválido') });
export const postIdParamSchema = z.object({ postId: z.string().uuid('postId inválido') });
export const slugParamSchema = z.object({
  slug: z.string().min(1).max(200).regex(slugRegex, 'Slug inválido'),
});

// Auth
export const loginSchema = z.object({
  email: z.string().email('Email inválido').max(255),
  password: z.string().min(1).max(72),
});

export const signupSchema = z.object({
  username: z
    .string()
    .min(3, 'Username muito curto')
    .max(30, 'Username muito longo')
    .regex(usernameRegex, 'Username só pode conter letras, números, _ e -'),
  email: z.string().email('Email inválido').max(255),
  password: z.string().min(8, 'Senha precisa de no mínimo 8 caracteres').max(72, 'Senha muito longa'),
});

export const profileUpdateSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(usernameRegex, 'Username só pode conter letras, números, _ e -')
    .optional(),
  avatar_url: httpUrl.optional().nullable(),
});

// Posts
export const postCreateSchema = z.object({
  title: z.string().min(1, 'Título obrigatório').max(200),
  slug: z.string().min(1).max(200).regex(slugRegex, 'Slug inválido').optional(),
  content: z.string().max(50000).optional(),
  excerpt: z.string().max(500).optional().nullable(),
  cover_image: httpUrl.optional().nullable(),
  status: z.enum(['draft', 'published']).optional(),
  visibility: z.enum(['public', 'members']).optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
});

export const postUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(50000).optional(),
  excerpt: z.string().max(500).optional().nullable(),
  cover_image: httpUrl.optional().nullable(),
  status: z.enum(['draft', 'published', 'deleted']).optional(),
  visibility: z.enum(['public', 'members']).optional(),
});

// Membership (admin concede/revoga) — ISO date ou null pra revogar
export const membershipUpdateSchema = z.object({
  member_until: z.string().datetime({ offset: true }).nullable(),
});

// Comments
export const commentCreateSchema = z.object({
  content: z.string().min(1, 'Comentário vazio').max(5000),
  post_id: z.string().uuid('post_id inválido'),
  parent_id: z.string().uuid('parent_id inválido').optional().nullable(),
  guest_name: z.string().min(1).max(40).optional(),
});

// Suggestions
export const suggestionCreateSchema = z.object({
  title: z.string().min(5, 'Título muito curto').max(200),
  description: z.string().min(20, 'Descrição muito curta').max(2000),
});

// Email verification
export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token obrigatório'),
});

export const resendVerificationSchema = z.object({
  email: z.string().email('Email inválido').max(255),
});

// Password reset
export const forgotPasswordSchema = z.object({
  email: z.string().email('Email inválido').max(255),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token obrigatório'),
  password: z.string().min(8, 'Senha precisa de no mínimo 8 caracteres').max(72, 'Senha muito longa'),
});

// Radar (notícias curadas)
const radarRunType = z.enum(['daily', 'weekly']);
const radarTier = z.enum(['members', 'public']);
const radarStatus = z.enum(['pending', 'approved', 'rejected']);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve ser YYYY-MM-DD');

export const radarIngestSchema = z.object({
  run_type: radarRunType,
  items: z
    .array(
      z.object({
        title: z.string().min(1, 'Título obrigatório').max(500),
        link: httpUrl,
        source: z.string().min(1, 'Fonte obrigatória').max(120),
        summary: z.string().max(2000).optional().nullable(),
        score: z.number().int().min(-1000).max(100000).optional(),
        hits: z.array(z.string().min(1).max(80)).max(50).optional().nullable(),
        published_at: z.string().datetime({ offset: true }).optional().nullable(),
      }),
    )
    .min(1, 'Nenhum item enviado')
    .max(200, 'Máximo de 200 itens por envio'),
});

export const radarAdminQuerySchema = z.object({
  status: radarStatus.optional().default('pending'),
});

export const radarPatchSchema = z
  .object({
    status: radarStatus.optional(),
    tier: radarTier.optional(),
    rank: z.number().int().min(1).max(1000).nullable().optional(),
  })
  .refine((d) => d.status !== undefined || d.tier !== undefined || d.rank !== undefined, {
    message: 'Nada para atualizar',
  });

export const radarDailyQuerySchema = z.object({
  date: isoDate.optional(),
  days: z.coerce.number().int().min(1).max(30).optional(),
});

export function validate<T>(
  schema: ZodSchema<T>,
  data: unknown,
  reply: FastifyReply,
): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    reply.status(400).send({
      message: 'Validação falhou',
      errors: result.error.flatten().fieldErrors,
    });
    return null;
  }
  return result.data;
}

// MX check — confirma que o domínio do email aceita correspondência.
// Fail-closed para domínio inexistente (NXDOMAIN/ENOTFOUND/ENODATA).
// Fail-open para falhas de infra DNS (não punir usuário legítimo se nosso resolver cair).
export async function emailHasMxRecord(email: string): Promise<boolean> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;

  try {
    const records = await dns.resolveMx(domain);
    return records.length > 0;
  } catch (err: any) {
    const domainFailures = ['ENODATA', 'ENOTFOUND', 'NXDOMAIN'];
    if (domainFailures.includes(err.code)) {
      return false;
    }
    // Falha de DNS (EAI_AGAIN, timeout, etc) — permite passar pra não bloquear signup real
    return true;
  }
}
