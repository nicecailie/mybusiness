'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { ErrorText, request, State, useT } from './ui';

const setupSchema = z.object({
  totpURI: z.string().startsWith('otpauth://totp/'),
  backupCodes: z.array(z.string().min(1)).min(1),
});
type Setup = { secret: string; backupCodes: string[] };

export function SecuritySettings() {
  const t = useT();
  const query = useQueryClient();
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () =>
      request<{ user: { name: string; email: string; twoFactorEnabled?: boolean } } | null>(
        'auth/get-session',
      ),
  });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [savedCodes, setSavedCodes] = useState(false);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function begin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = setupSchema.parse(
        await request<unknown>('auth/two-factor/enable', undefined, 'POST', {
          password,
          method: 'totp',
        }),
      );
      const secret = new URL(result.totpURI).searchParams.get('secret');
      if (!secret || !/^[A-Z2-7]+=*$/i.test(secret)) throw new Error(t('mfaSetupError'));
      // Enrollment secrets stay in this component only: no query cache, storage or external QR URL.
      setSetup({ secret, backupCodes: result.backupCodes });
      setPassword('');
    } catch (error) {
      setError(
        error instanceof z.ZodError
          ? t('mfaSetupError')
          : error instanceof Error
            ? error.message
            : t('mfaSetupError'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !savedCodes) return;
    setBusy(true);
    setError('');
    try {
      if (!verified) {
        await request('auth/two-factor/verify-totp', undefined, 'POST', { code });
        setVerified(true);
        setCode('');
      }
      // Remove sessions opened before enrollment; retry this independently if its response is lost.
      await request('auth/revoke-other-sessions', undefined, 'POST', {});
      setSetup(null);
      setSavedCodes(false);
      await query.invalidateQueries({ queryKey: ['session'] });
      await query.invalidateQueries({ queryKey: ['data'] });
    } catch (error) {
      setError(error instanceof Error ? error.message : t('mfaSetupError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel settings-panel security-panel">
      <div className="panel-heading">
        <h2>{t('mfaTitle')}</h2>
        <ShieldCheck size={22} />
      </div>
      <div className="security-content">
        {session.isPending || session.isError ? (
          <State
            loading={session.isPending}
            error={session.error}
            retry={() => void session.refetch()}
          />
        ) : setup ? (
          <form className="form" onSubmit={(event) => void verify(event)}>
            <p className="muted small">{t('mfaManualHint')}</p>
            <label className="field">
              <span>{t('mfaSetupKey')}</span>
              <input
                value={setup.secret}
                readOnly
                autoComplete="off"
                spellCheck={false}
                className="mfa-secret"
              />
            </label>
            <p className="muted small">{t('mfaBackupHint')}</p>
            <ul className="backup-codes" aria-label={t('mfaBackupCodes')}>
              {setup.backupCodes.map((backupCode) => (
                <li key={backupCode}>
                  <code>{backupCode}</code>
                </li>
              ))}
            </ul>
            <label className="security-check">
              <input
                type="checkbox"
                checked={savedCodes}
                disabled={verified || busy}
                onChange={(event) => setSavedCodes(event.target.checked)}
              />
              <span>{t('mfaCodesSaved')}</span>
            </label>
            {!verified && (
              <label className="field">
                <span>{t('mfa')}</span>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  disabled={busy}
                />
              </label>
            )}
            {verified && (
              <p className="notice" role="status">
                {t('mfaFinishHint')}
              </p>
            )}
            <ErrorText error={error} />
            <button className="button primary" disabled={busy || !savedCodes}>
              {busy ? t('working') : verified ? t('retry') : t('verify')}
            </button>
          </form>
        ) : session.data?.user.twoFactorEnabled ? (
          <div className="notice" role="status">
            <CheckCircle2 size={18} />
            {t('mfaEnabled')}
          </div>
        ) : (
          <form className="form" onSubmit={(event) => void begin(event)}>
            <p className="muted small">{t('mfaSetupHint')}</p>
            <label className="field">
              <span>{t('password')}</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </label>
            <ErrorText error={error} />
            <button className="button primary" disabled={busy}>
              {busy ? t('working') : t('mfaStart')}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
