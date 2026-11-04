'use client';
import { newOperationId } from './idempotency';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, Package, RefreshCw, X, type LucideIcon } from 'lucide-react';
import Image from 'next/image';
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import type { ApiError, Context } from '../../../packages/contracts/src/index';
import { messages, type Locale, type MessageKey } from '../../../packages/i18n/src/index';

export const Language = createContext<Locale>('fr');
export const useT = () => {
  const l = useContext(Language);
  return (k: MessageKey) => messages[l][k];
};
export class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public uncertain = false,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  context?: Context,
  method = 'GET',
  body?: unknown,
  key?: string,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(context
          ? {
              'x-tenant-id': context.tenantId,
              'x-business-id': context.businessId,
              'x-branch-id': context.branchId,
            }
          : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
        ...extraHeaders,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new RequestError(
      'NETWORK_ERROR',
      'Connection interrupted. Your input has been preserved.',
      method !== 'GET',
    );
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as
      (ApiError & { message?: string }) | null;
    throw new RequestError(
      data?.code ?? 'REQUEST_FAILED',
      data?.message ?? 'Unable to complete this request.',
      response.status >= 500 && method !== 'GET',
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new RequestError(
      'INVALID_RESPONSE',
      'The server response was interrupted.',
      method !== 'GET',
    );
  }
}
export function IconButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="icon-button" aria-label={label} title={label} onClick={onClick}>
      <Icon size={19} />
    </button>
  );
}
export function Empty({
  icon: Icon = Package,
  title,
  hint,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
}) {
  return (
    <div className="empty">
      <span>
        <Icon size={27} />
      </span>
      <h3>{title}</h3>
      {hint && <p>{hint}</p>}
    </div>
  );
}
export function State({
  loading,
  error,
  retry,
}: {
  loading?: boolean;
  error?: Error | null;
  retry: () => void;
}) {
  const t = useT();
  return (
    <div className="state" role={error ? 'alert' : 'status'}>
      {loading ? <RefreshCw className="spin" size={22} /> : <AlertCircle size={22} />}
      <p>{loading ? t('loading') : (error?.message ?? t('error'))}</p>
      {error && (
        <button className="button secondary" onClick={retry}>
          {t('retry')}
        </button>
      )}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const t = useT();
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className={`dialog ${wide ? 'wide' : ''}`}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <div className="dialog-head">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button className="icon-button" aria-label={t('cancel')}>
                <X size={20} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Field({
  label,
  name,
  type = 'text',
  required = true,
  defaultValue = '',
  min,
  children,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  min?: string;
  children?: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children ?? (
        <input
          name={name}
          type={type}
          required={required}
          defaultValue={defaultValue}
          min={min}
          maxLength={type === 'text' ? 160 : undefined}
          step={type === 'number' ? 'any' : undefined}
        />
      )}
    </label>
  );
}
export function ErrorText({ error }: { error: string }) {
  return error ? (
    <div className="error-box" role="alert">
      <AlertCircle size={17} />
      {error}
    </div>
  ) : null;
}
export function useWrite(
  context: Context,
  onSuccess: () => void,
  operation: string,
  persist = true,
) {
  const storageKey = `mb-pending:${context.userId}:${context.tenantId}:${context.businessId}:${context.branchId}:${operation}`;
  type Pending = { path: string; body: unknown; method: string; key: string };
  const [initial] = useState<Pending | null>(() => {
    try {
      if (!persist) return null;
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const item = JSON.parse(raw) as Pending;
      return typeof item.path === 'string' && typeof item.key === 'string' ? item : null;
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(!!initial),
    [error, setError] = useState(
      initial ? messages[context.locale === 'en' ? 'en' : 'fr'].unknownOutcome : '',
    );
  const pending = useRef<Pending | null>(initial),
    op = useRef(initial?.key ?? newOperationId());
  const submit = async (path: string, body: unknown, method = 'POST') => {
    if (busy) return;
    setBusy(true);
    setError('');
    const original = pending.current ?? { path, body, method, key: op.current };
    pending.current = original;
    try {
      if (persist) localStorage.setItem(storageKey, JSON.stringify(original));
      await request(original.path, context, original.method, original.body, original.key);
      pending.current = null;
      localStorage.removeItem(storageKey);
      setUncertain(false);
      op.current = newOperationId();
      onSuccess();
    } catch (e) {
      if (e instanceof RequestError && e.uncertain) {
        setUncertain(true);
        setError(messages[context.locale === 'en' ? 'en' : 'fr'].unknownOutcome);
      } else {
        pending.current = null;
        localStorage.removeItem(storageKey);
        setUncertain(false);
        setError(e instanceof Error ? e.message : 'Request failed');
      }
    } finally {
      setBusy(false);
    }
  };
  return {
    busy,
    error,
    uncertain,
    submit,
    pendingBody: pending.current?.body,
    retry: () =>
      pending.current
        ? submit(pending.current.path, pending.current.body, pending.current.method)
        : Promise.resolve(),
    changed: () => {
      if (!pending.current) {
        op.current = newOperationId();
        setError('');
      }
    },
  };
}
export function Brand() {
  return (
    <div className="brand">
      <Image
        className="brand-logo"
        src="/mybusiness-logo.png"
        alt="MyBusiness"
        width={1187}
        height={231}
      />
      <Image
        className="brand-icon-small"
        src="/mybusiness-icon.png"
        alt=""
        aria-hidden
        width={1254}
        height={1254}
      />
    </div>
  );
}
export type Page =
  | 'money'
  | 'stock'
  | 'overview'
  | 'sales'
  | 'products'
  | 'customers'
  | 'purchases'
  | 'invoices'
  | 'expenses'
  | 'accounting'
  | 'reports'
  | 'team'
  | 'settings'
  | 'sell';
