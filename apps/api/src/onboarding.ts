import { Prisma } from '@prisma/client';
import { onboardingSchema, type OnboardingInput } from '../../../packages/contracts/src/index.js';
import { DomainError } from '../../../packages/domain/src/index.js';
import { validateDocument } from './business.js';
import { industryById } from '../../../packages/domain/src/industries.js';
import { contexts, db, pool } from './database.js';

export interface ProvisionedBusiness {
  tenantId: string;
  businessId: string;
  branchId: string;
  industryId: string;
}

export async function provisionBusiness(
  userId: string,
  operationKey: string,
  input: OnboardingInput,
): Promise<ProvisionedBusiness> {
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(operationKey))
    throw new DomainError('IDEMPOTENCY_REQUIRED', 'Retry setup using the same request key.', 400);
  for (const doc of input.documents ?? []) validateDocument(doc);
  if (input.projects?.some((p) => !industryById(p.industryId)))
    throw new DomainError('VALIDATION_ERROR', 'Choose an available project activity.');
  const legalUrls = [process.env.SUBSCRIPTION_AGREEMENT_URL, process.env.PRIVACY_POLICY_URL];
  const normalizedUrls = legalUrls.map((value) => {
    if (!value) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
      return url.href;
    } catch {
      throw new DomainError(
        'LEGAL_DOCUMENTS_UNAVAILABLE',
        'The legal document links are not valid.',
        503,
      );
    }
  });
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      const rows = await tx.$queryRaw<{ result: ProvisionedBusiness }[]>`
        SELECT provision_business_onboarding(
          ${userId}, ${operationKey}, ${JSON.stringify({
            ...input,
            subscriptionAgreementUrl: normalizedUrls[0],
            privacyPolicyUrl: normalizedUrls[1],
          })}::jsonb
        ) AS result`;
      return rows[0]!.result;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('VERIFIED_ACCOUNT_REQUIRED'))
      throw new DomainError(
        'VERIFIED_ACCOUNT_REQUIRED',
        'Verify and use the email address on your signed-in account.',
        403,
      );
    if (message.includes('IDEMPOTENCY_CONFLICT'))
      throw new DomainError(
        'IDEMPOTENCY_CONFLICT',
        'This setup request key was already used with different details.',
        409,
      );
    if (message.includes('ONBOARDING_ACTOR_MISMATCH'))
      throw new DomainError('FORBIDDEN', 'Sign in again before setting up a business.', 403);
    if (message.includes('INVALID_ONBOARDING') || message.includes('INVALID_CONTACT'))
      throw new DomainError('VALIDATION_ERROR', 'Check the onboarding details and try again.', 400);
    if (message.includes('LEGAL_ACCEPTANCE_REQUIRED'))
      throw new DomainError(
        'LEGAL_ACCEPTANCE_REQUIRED',
        'Accept the published legal documents before setting up this business.',
        400,
      );
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      throw new DomainError(
        'IDEMPOTENCY_CONFLICT',
        'This setup request is already being processed.',
        409,
      );
    throw error;
  }
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character]!;
  });

export async function activatePendingBusiness(userId: string) {
  const result = await pool.query<{
    email: string;
    name: string;
    emailVerified: boolean;
    pendingOnboarding: unknown;
  }>(
    'SELECT email, name, "emailVerified", pending_onboarding AS "pendingOnboarding" FROM "user" WHERE id = $1',
    [userId],
  );
  const user = result.rows[0];
  if (!user || !user.emailVerified)
    throw new DomainError(
      'EMAIL_VERIFICATION_REQUIRED',
      'Verify your email to activate your account.',
      403,
    );

  if (!user.pendingOnboarding) {
    return { activated: false, contexts: await contexts(userId), confirmationEmailSent: false };
  }

  const input = onboardingSchema.parse(user.pendingOnboarding);
  if (input.email.toLowerCase() !== user.email.toLowerCase())
    throw new DomainError(
      'ONBOARDING_IDENTITY_MISMATCH',
      'Sign in with the email used for setup.',
      403,
    );

  const business = await provisionBusiness(userId, `email_activation_${userId}`, input);
  await pool.query('UPDATE "user" SET pending_onboarding = NULL WHERE id = $1', [userId]);

  let confirmationEmailSent = false;
  const claim = await pool.query(
    `INSERT INTO activation_confirmation_emails (user_id, state)
     VALUES ($1, 'sending') ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
    [userId],
  );
  if (claim.rowCount) {
    const locale = input.locale;
    const workspace = escapeHtml(input.companyName);
    const firstName = escapeHtml(
      input.fullName.trim().split(/\s+/)[0] || (locale === 'fr' ? 'vous' : 'there'),
    );
    const copy =
      locale === 'fr'
        ? {
            subject: 'Votre compte MyBusiness est activé',
            greeting: `Bonjour ${firstName},`,
            message: `Votre compte et votre espace <strong>${workspace}</strong> sont maintenant activés. Vous pouvez commencer à utiliser MyBusiness.`,
            text: `Bonjour ${firstName},\n\nVotre compte et votre espace ${input.companyName} sont maintenant activés. Vous pouvez commencer à utiliser MyBusiness.\n\nL’équipe MyBusiness`,
          }
        : {
            subject: 'Your MyBusiness account is active',
            greeting: `Hi ${firstName},`,
            message: `Your account and workspace, <strong>${workspace}</strong>, are now active. You can start using MyBusiness.`,
            text: `Hi ${firstName},\n\nYour account and workspace, ${input.companyName}, are now active. You can start using MyBusiness.\n\nThe MyBusiness team`,
          };
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    try {
      if (!apiKey || !from) throw new Error('Email verification delivery is not configured.');
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `mybusiness-activation/${userId}`,
        },
        body: JSON.stringify({
          from,
          to: [user.email],
          subject: copy.subject,
          html: `<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#172033"><div style="max-width:560px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border:1px solid #e7e9ee;border-radius:14px;padding:28px 24px"><p style="margin:0 0 14px;font-size:16px;line-height:1.6">${copy.greeting}</p><p style="margin:0;font-size:16px;line-height:1.65">${copy.message}</p><p style="margin:20px 0 0;color:#4b5563;font-size:14px;line-height:1.5">${locale === 'fr' ? 'L’équipe MyBusiness' : 'The MyBusiness team'}</p></div></div></body></html>`,
          text: copy.text,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Resend returned ${response.status}.`);
      await pool.query(
        `UPDATE activation_confirmation_emails SET state = 'sent', sent_at = now() WHERE user_id = $1`,
        [userId],
      );
      confirmationEmailSent = true;
    } catch {
      await pool.query(
        `UPDATE activation_confirmation_emails SET state = 'failed' WHERE user_id = $1`,
        [userId],
      );
    }
  }

  return { activated: true, business, contexts: await contexts(userId), confirmationEmailSent };
}
