import { Resend } from 'resend';

let cachedClient: Resend | null = null;

function getClient(): Resend {
  if (cachedClient) return cachedClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error('RESEND_API_KEY não configurado no .env');
  }
  cachedClient = new Resend(key);
  return cachedClient;
}

const emailFrom = () => process.env.EMAIL_FROM || 'noreply@rathole.com.br';
const appUrl = () => process.env.APP_URL || 'https://rathole.com.br';

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const link = `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;

  const html = `<!DOCTYPE html>
<html>
  <body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 40px auto; padding: 0 20px; color: #1a1a1a;">
    <h1 style="font-size: 22px; margin: 0 0 16px;">Confirme seu email</h1>
    <p style="font-size: 15px; line-height: 1.5; color: #444;">
      Você se cadastrou no <strong>Rathole</strong>. Pra completar o cadastro, clica no link abaixo:
    </p>
    <p style="margin: 24px 0;">
      <a href="${link}" style="display:inline-block; padding:12px 24px; background:#000; color:#fff; text-decoration:none; border-radius:6px; font-weight:500;">
        Confirmar email
      </a>
    </p>
    <p style="font-size: 13px; color: #666; line-height: 1.5;">
      Ou copia e cola este link no browser:<br/>
      <span style="word-break: break-all;">${link}</span>
    </p>
    <p style="font-size: 12px; color: #999; margin-top: 32px;">
      Este link expira em 1 hora. Se você não se cadastrou, ignore esta mensagem.
    </p>
  </body>
</html>`;

  const { error } = await getClient().emails.send({
    from: `Rathole <${emailFrom()}>`,
    to,
    subject: 'Confirme seu email — Rathole',
    html,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;

  const html = `<!DOCTYPE html>
<html>
  <body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 40px auto; padding: 0 20px; color: #1a1a1a;">
    <h1 style="font-size: 22px; margin: 0 0 16px;">Redefinir senha</h1>
    <p style="font-size: 15px; line-height: 1.5; color: #444;">
      Recebemos um pedido para redefinir a senha da sua conta no <strong>Rathole</strong>. Clica no botão abaixo pra escolher uma nova senha:
    </p>
    <p style="margin: 24px 0;">
      <a href="${link}" style="display:inline-block; padding:12px 24px; background:#000; color:#fff; text-decoration:none; border-radius:6px; font-weight:500;">
        Redefinir senha
      </a>
    </p>
    <p style="font-size: 13px; color: #666; line-height: 1.5;">
      Ou copia e cola este link no browser:<br/>
      <span style="word-break: break-all;">${link}</span>
    </p>
    <p style="font-size: 12px; color: #999; margin-top: 32px;">
      Este link expira em 1 hora. Se você não pediu para redefinir a senha, ignore esta mensagem — sua senha continua a mesma.
    </p>
  </body>
</html>`;

  const { error } = await getClient().emails.send({
    from: `Rathole <${emailFrom()}>`,
    to,
    subject: 'Redefinir senha — Rathole',
    html,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}
