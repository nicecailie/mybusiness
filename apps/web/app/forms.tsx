'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ChartNoAxesCombined, ReceiptText, ShieldCheck, Store } from 'lucide-react';
import { useContext, useEffect, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { CashSession, Context, Product } from '../../../packages/contracts/src/index';
import { money } from '../../../packages/i18n/src/index';

import { Brand, ErrorText, Field, Language, Modal, request, useT, useWrite } from './ui';
export function MutationForm({
  kind,
  context,
  products,
  onClose,
  onSaved,
  product,
}: {
  kind: 'product' | 'customer' | 'stock' | 'open' | 'close';
  context: Context;
  product?: Product;
  products: Product[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT(),
    language = useContext(Language),
    q = useQueryClient(),
    [expected, setExpected] = useState<string>(''),
    [loadError, setLoadError] = useState(''),
    [stockDirection, setStockDirection] = useState('increase');
  const { busy, error, uncertain, submit, changed, retry } = useWrite(
    context,
    () => {
      void q.invalidateQueries();
      onSaved();
    },
    kind,
  );
  useEffect(() => {
    if (kind === 'close')
      void request<CashSession | null>('v1/cash-session', context)
        .then((c) => setExpected(c?.expected ?? ''))
        .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Request failed'));
  }, [kind, context]);
  const handle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (uncertain) {
      void retry();
      return;
    }
    const f = new FormData(event.currentTarget),
      v = (name: string) => String(f.get(name) ?? '');
    if (kind === 'product')
      void submit(product ? `v1/products/${product.id}/update` : 'v1/products', {
        name: v('name'),
        sku: v('sku'),
        barcode: v('barcode'),
        category: v('category'),
        price: v('price'),
        cost: v('cost') || '0',
        ...(!product
          ? {
              initialQuantity: Number(v('initialQuantity')),
              initialReason: v('initialReason') || undefined,
            }
          : {}),
        lowStock: Number(v('lowStock')),
        type: v('type'),
      });
    if (kind === 'customer')
      void submit('v1/customers', {
        name: v('name'),
        phone: v('phone'),
        email: v('email'),
      });
    if (kind === 'stock')
      void submit('v1/stock/opening', {
        productId: v('productId'),
        quantity: Number(v('quantity')),
        unitCost: v('unitCost') || '0',
        direction: v('direction'),
        reason: v('reason'),
      });
    if (kind === 'open') void submit('v1/cash-session', { openingFloat: v('openingFloat') });
    if (kind === 'close')
      void request<CashSession | null>('v1/cash-session', context)
        .then((c) => {
          if (!c) throw new Error(t('registerRequired'));
          return submit(`v1/cash-session/${c.id}/close`, {
            counted: v('counted'),
            reason: v('reason'),
          });
        })
        .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'Request failed'));
  };
  const titles = {
    product: 'newProduct',
    customer: 'newCustomer',
    stock: 'createStock',
    open: 'openRegister',
    close: 'closeRegister',
  } as const;
  return (
    <Modal
      title={
        product ? (language === 'fr' ? 'Modifier le produit' : 'Edit product') : t(titles[kind])
      }
      onClose={onClose}
    >
      <form onSubmit={handle} onChange={changed} className="form">
        <ErrorText error={error || loadError} />
        <fieldset disabled={busy || uncertain}>
          {kind === 'product' && (
            <>
              <Field
                name="name"
                label={t('name')}
                defaultValue={kind === 'product' ? product?.name : undefined}
              />
              <div className="form-row">
                <Field name="sku" defaultValue={product?.sku ?? undefined} label={t('sku')} />
                <Field
                  name="category"
                  defaultValue={product?.category ?? undefined}
                  label={t('category')}
                />
              </div>
              <Field
                name="barcode"
                defaultValue={product?.barcode ?? undefined}
                label={t('barcode')}
                required={false}
              />
              <div className="form-row">
                <Field
                  name="price"
                  defaultValue={product?.price}
                  label={`${t('price')} (Fbu)`}
                  type="number"
                  min="0"
                />
                <Field
                  name="lowStock"
                  label={t('lowStockThreshold')}
                  type="number"
                  min="0"
                  defaultValue={String(product?.lowStock ?? 5)}
                />
              </div>
              {!product && (
                <>
                  <Field
                    name="initialQuantity"
                    label={language === 'fr' ? 'Quantité initiale' : 'Initial quantity'}
                    type="number"
                    min="0"
                    defaultValue="0"
                  />
                  <Field
                    name="cost"
                    label={`${t('cost')} (Fbu)`}
                    type="number"
                    min="0"
                    defaultValue="0"
                  />
                  <Field name="initialReason" label={t('reason')} required={false} />
                </>
              )}
              <Field name="type" label={t('productType')}>
                <select name="type" defaultValue={product?.type}>
                  <option value="goods">{t('goods')}</option>
                  <option value="service">{t('service')}</option>
                </select>
              </Field>
            </>
          )}
          {kind === 'customer' && (
            <>
              <Field name="name" label={t('name')} />
              <Field name="phone" label={t('phone')} type="tel" required={false} />
              <Field name="email" label={t('email')} type="email" required={false} />
            </>
          )}
          {kind === 'stock' && (
            <>
              <Field name="productId" label={t('selectProduct')}>
                <select name="productId" required>
                  <option value="">{t('selectProduct')}</option>
                  {products
                    .filter((p) => p.type === 'goods')
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.sku}
                      </option>
                    ))}
                </select>
              </Field>
              <Field name="direction" label={language === 'fr' ? 'Action' : 'Action'}>
                <select
                  name="direction"
                  value={stockDirection}
                  onChange={(e) => setStockDirection(e.target.value)}
                >
                  <option value="increase">{language === 'fr' ? 'Augmenter' : 'Increase'}</option>
                  <option value="decrease">{language === 'fr' ? 'Diminuer' : 'Decrease'}</option>
                </select>
              </Field>
              <div className="form-row">
                <Field name="quantity" label={t('quantity')} type="number" min="0.001" />
                <Field
                  name="unitCost"
                  label={`${t('cost')} (Fbu)`}
                  type="number"
                  min={stockDirection === 'increase' ? '1' : '0'}
                  defaultValue={stockDirection === 'decrease' ? '0' : ''}
                  required={stockDirection === 'increase'}
                />
              </div>
              <Field name="reason" label={t('reason')} />
              <p className="muted small">{t('provisional')}</p>
            </>
          )}
          {kind === 'open' && (
            <Field
              name="openingFloat"
              label={`${t('openingFloat')} (Fbu)`}
              type="number"
              min="0"
              defaultValue="0"
            />
          )}
          {kind === 'close' && (
            <>
              {expected && (
                <div className="notice">
                  {t('expectedCash')}: {money(expected, language)}
                </div>
              )}
              <Field name="counted" label={`${t('countedCash')} (Fbu)`} type="number" min="0" />
              <Field name="reason" label={t('reason')} required={false} />
            </>
          )}
        </fieldset>
        <div className="form-footer">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? t('working') : uncertain ? t('retry') : t('save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function Login({ onSuccess }: { onSuccess: () => void }) {
  const t = useT(),
    [code, setCode] = useState(''),
    [mfa, setMfa] = useState(false),
    [recovery, setRecovery] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const signInSchema = z.object({ email: z.email(), password: z.string().min(12) });
  const loginForm = useForm<z.infer<typeof signInSchema>>({ resolver: zodResolver(signInSchema) });
  const login = async (values: z.infer<typeof signInSchema>) => {
    setBusy(true);
    setError('');
    try {
      const response = await request<{ twoFactorRedirect?: boolean }>(
        mfa
          ? recovery
            ? 'auth/two-factor/verify-backup-code'
            : 'auth/two-factor/verify-totp'
          : 'auth/sign-in/email',
        undefined,
        'POST',
        mfa ? { code } : values,
      );
      if (response.twoFactorRedirect) setMfa(true);
      else onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <div className="login-story">
        <Brand />
        <div>
          <span className="eyebrow">MYBUSINESS</span>
          <h1>{t('loginHint')}</h1>
          <p>{t('safe')}</p>
          <div className="story-line" />
          <div className="story-icons">
            <Store />
            <ArrowRight />
            <ReceiptText />
            <ArrowRight />
            <ChartNoAxesCombined />
          </div>
        </div>
        <span className="story-footer">Bujumbura · Burundi</span>
      </div>
      <main className="login-form">
        <div className="login-mobile-brand">
          <Brand />
        </div>
        <div className="form-wrap">
          <span className="eyebrow">MYBUSINESS WORKSPACE</span>
          <h1>{t('welcome')}</h1>
          <p className="muted">{mfa ? t('mfaHint') : t('subtitle')}</p>
          <form className="form" onSubmit={loginForm.handleSubmit(login)}>
            <ErrorText
              error={Object.values(loginForm.formState.errors)
                .map((e) => e.message)
                .join(' ')}
            />
            <ErrorText error={error} />
            {mfa ? (
              <label className="field">
                <span>{t(recovery ? 'mfaRecoveryCode' : 'mfa')}</span>
                <input
                  autoComplete="one-time-code"
                  inputMode={recovery ? 'text' : 'numeric'}
                  pattern={recovery ? undefined : '[0-9]{6}'}
                  maxLength={recovery ? 100 : 6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
            ) : (
              <>
                <label className="field">
                  <span>{t('email')}</span>
                  <input
                    type="email"
                    autoComplete="username"
                    required
                    {...loginForm.register('email')}
                  />
                </label>
                <label className="field">
                  <span>{t('password')}</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    {...loginForm.register('password')}
                  />
                </label>
              </>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? t('loading') : mfa ? t('verify') : t('signIn')}
              <ArrowRight size={17} />
            </button>
          </form>
          {mfa && (
            <button
              className="text-button"
              onClick={() => {
                setRecovery(!recovery);
                setCode('');
                setError('');
              }}
              disabled={busy}
            >
              {t(recovery ? 'mfaUseAuthenticator' : 'mfaUseRecovery')}
            </button>
          )}
          <div className="login-security">
            <ShieldCheck size={16} /> MyBusiness · {t('provisional')}
          </div>
        </div>
      </main>
    </div>
  );
}
