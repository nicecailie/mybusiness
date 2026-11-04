import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import { expo } from '@better-auth/expo';
import { pool } from './database.js';

if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32)
  throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.');
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
export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  basePath: '/api/auth',
  trustedOrigins: [
    process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    ...(process.env.NODE_ENV === 'production'
      ? []
      : [
          'http://localhost:3000',
          'http://127.0.0.1:3000',
          ...(process.env.LAN_ORIGIN ? [process.env.LAN_ORIGIN] : []),
        ]),
    'mybusiness://',
  ],
  emailAndPassword: {
    enabled: true,
    disableSignUp: process.env.ALLOW_REGISTRATION !== 'true',
    minPasswordLength: 12,
    requireEmailVerification: true,
  },
  user: {
    additionalFields: {
      pendingOnboarding: {
        type: 'json',
        fieldName: 'pending_onboarding',
        required: false,
        input: true,
        returned: false,
      },
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }, request) => {
      const apiKey = process.env.RESEND_API_KEY;
      const from = process.env.EMAIL_FROM;
      if (!apiKey || !from) throw new Error('Email verification delivery is not configured.');
      const locale = request?.headers.get('x-mybusiness-locale') === 'fr' ? 'fr' : 'en';
      const requestedWorkspace = request?.headers.get('x-mybusiness-workspace')?.trim();
      const workspaceName = (requestedWorkspace || 'MyBusiness').slice(0, 120);
      const firstName = (
        user.name?.trim().split(/\s+/)[0] || (locale === 'fr' ? 'vous' : 'there')
      ).slice(0, 80);
      const safeName = escapeHtml(firstName);
      const safeWorkspace = escapeHtml(workspaceName);
      const safeUrl = escapeHtml(url);
      const copy =
        locale === 'fr'
          ? {
              subject: 'Bienvenue chez MyBusiness !',
              greeting: `Bonjour ${safeName},`,
              welcome: `Bienvenue chez MyBusiness ! Votre espace <strong>${safeWorkspace}</strong> est prêt. Nous sommes ravis de vous accueillir.`,
              confirm: 'Il ne vous reste qu’à confirmer votre adresse e-mail pour commencer.',
              cta: 'Confirmer mon adresse e-mail',
              signoff: 'À très bientôt,<br>L’équipe MyBusiness',
              text: `Bonjour ${firstName},\n\nBienvenue chez MyBusiness ! Votre espace ${workspaceName} est prêt. Nous sommes ravis de vous accueillir.\nIl ne vous reste qu’à confirmer votre adresse e-mail pour commencer.\n\nConfirmer mon adresse e-mail : ${url}\n\nÀ très bientôt,\nL’équipe MyBusiness`,
            }
          : {
              subject: 'Welcome to MyBusiness!',
              greeting: `Hi ${safeName},`,
              welcome: `Welcome to MyBusiness! Your workspace, <strong>${safeWorkspace}</strong>, is ready. We’re happy to have you here.`,
              confirm: 'Just confirm your email address to get started.',
              cta: 'Verify my email address',
              signoff: 'See you soon,<br>The MyBusiness team',
              text: `Hi ${firstName},\n\nWelcome to MyBusiness! Your workspace, ${workspaceName}, is ready. We’re happy to have you here.\nJust confirm your email address to get started.\n\nVerify my email address: ${url}\n\nSee you soon,\nThe MyBusiness team`,
            };
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [user.email],
          subject: copy.subject,
          html: `<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#172033"><div style="max-width:560px;margin:0 auto;padding:32px 16px"><div style="background:#fff;border:1px solid #e7e9ee;border-radius:16px;padding:32px 28px"><p style="margin:0 0 20px;font-size:16px;line-height:1.6">${copy.greeting}</p><p style="margin:0 0 12px;font-size:16px;line-height:1.65">${copy.welcome}</p><p style="margin:0 0 24px;font-size:16px;line-height:1.65">${copy.confirm}</p><p style="margin:0 0 26px"><a href="${safeUrl}" style="display:inline-block;background:#795570;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:9px;line-height:1.3">${copy.cta}</a></p><p style="margin:0;color:#4b5563;font-size:15px;line-height:1.65">${copy.signoff}</p></div><p style="margin:16px 8px 0;color:#727987;font-size:12px;line-height:1.5">MyBusiness</p></div></body></html>`,
          text: copy.text,
        }),
      });
      if (!response.ok) throw new Error('Email verification could not be sent.');
    },
  },
  session: {
    expiresIn: 60 * 60 * 12,
    updateAge: 60 * 15,
    cookieCache: { enabled: false },
  },
  plugins: [twoFactor({ issuer: 'MyBusiness' }), expo()],
  rateLimit: { enabled: true, window: 60, max: 60 },
  advanced: { useSecureCookies: process.env.NODE_ENV === 'production' },
});
