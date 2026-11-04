import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

const origin = 'http://localhost:3000';

// Independent RFC 6238 test authenticator. No application code generates a user's codes.
function authenticatorCode(uri: string): string {
  const secret = new URL(uri).searchParams.get('secret');
  assert.ok(secret);
  let bits = '';
  for (const character of secret.replace(/=+$/, '').toUpperCase()) {
    const value = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character);
    assert.ok(value >= 0);
    bits += value.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}

class AuthBrowser {
  private cookies = new Map<string, string>();
  async call(path: string, body?: unknown, requestOrigin = origin): Promise<Response> {
    const send = () =>
      fetch(`${origin}/api/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          origin: requestOrigin,
          'Content-Type': 'application/json',
          cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    let response = await send();
    // Respect Better Auth's real throttling instead of disabling it for the test.
    if (response.status === 429) {
      const wait = Number(response.headers.get('retry-after') ?? 10);
      assert.ok(Number.isFinite(wait) && wait >= 0 && wait <= 60, 'Bounded authentication retry');
      await response.arrayBuffer();
      await delay((wait + 1) * 1000);
      response = await send();
    }
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0]!;
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator),
        value = pair.slice(separator + 1);
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    return response;
  }
}

void test('authenticator enrollment, challenge and single-use recovery use real HTTP sessions', async () => {
  assert.equal(process.env.ALLOW_DEMO_SEED, 'true', 'Use an isolated development database.');
  assert.notEqual(process.env.NODE_ENV, 'production');
  const admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const email = `mfa-${randomUUID()}@example.test`;
  const password = randomBytes(24).toString('hex');
  const fixture = betterAuth({
    database: admin,
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true },
  });
  let actorId: string | undefined;
  try {
    actorId = (await fixture.api.signUpEmail({ body: { name: 'MFA test actor', email, password } }))
      .user.id;
    await admin.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [actorId]);
    const browser = new AuthBrowser(),
      oldBrowser = new AuthBrowser();
    for (const client of [browser, oldBrowser]) {
      assert.equal((await client.call('auth/sign-in/email', { email, password })).status, 200);
    }
    const status = async () => {
      const row = await admin.query<{ twoFactorEnabled: boolean | null }>(
        'SELECT "twoFactorEnabled" FROM "user" WHERE id=$1',
        [actorId],
      );
      return row.rows[0]?.twoFactorEnabled === true;
    };
    assert.equal(
      (
        await browser.call('auth/two-factor/enable', {
          password: 'incorrect-password',
          method: 'totp',
        })
      ).status,
      400,
    );
    assert.equal(await status(), false);
    assert.equal(
      (
        await browser.call(
          'auth/two-factor/enable',
          { password, method: 'totp' },
          'https://attacker.invalid',
        )
      ).status,
      403,
    );
    const enable = await browser.call('auth/two-factor/enable', { password, method: 'totp' });
    assert.equal(enable.status, 200);
    const setup = (await enable.json()) as { totpURI: string; backupCodes: string[] };
    assert.ok(setup.totpURI.startsWith('otpauth://totp/'));
    assert.ok(setup.backupCodes.length > 0);
    assert.equal(await status(), false, 'Generating a key alone must not enable MFA.');
    assert.equal(
      (await browser.call('auth/two-factor/verify-totp', { code: 'invalid' })).status,
      401,
    );
    assert.equal(await status(), false);
    assert.equal(
      (
        await browser.call('auth/two-factor/verify-totp', {
          code: authenticatorCode(setup.totpURI),
        })
      ).status,
      200,
    );
    assert.equal(await status(), true);
    assert.equal((await browser.call('auth/revoke-other-sessions', {})).status, 200);
    assert.equal(await (await oldBrowser.call('auth/get-session')).json(), null);
    assert.equal((await browser.call('auth/sign-out', {})).status, 200);

    const next = new AuthBrowser();
    const passwordOnly = await next.call('auth/sign-in/email', { email, password });
    assert.equal(passwordOnly.status, 200);
    assert.equal((await passwordOnly.json()).twoFactorRedirect, true);
    assert.equal(
      (await next.call('v1/contexts')).status,
      401,
      'Password alone cannot authorize domain requests.',
    );
    assert.equal((await next.call('auth/two-factor/verify-totp', { code: 'invalid' })).status, 401);
    assert.equal(
      (await next.call('auth/two-factor/verify-totp', { code: authenticatorCode(setup.totpURI) }))
        .status,
      200,
    );
    assert.equal((await next.call('v1/contexts')).status, 200);
    await next.call('auth/sign-out', {});

    const recovery = new AuthBrowser();
    await recovery.call('auth/sign-in/email', { email, password });
    assert.equal(
      (await recovery.call('auth/two-factor/verify-backup-code', { code: setup.backupCodes[0] }))
        .status,
      200,
    );
    assert.equal((await recovery.call('v1/contexts')).status, 200);
    await recovery.call('auth/sign-out', {});
    await recovery.call('auth/sign-in/email', { email, password });
    assert.equal(
      (await recovery.call('auth/two-factor/verify-backup-code', { code: setup.backupCodes[0] }))
        .status,
      401,
      'A recovery code cannot be reused.',
    );
    assert.equal((await recovery.call('v1/contexts')).status, 401);
  } finally {
    // Only this test's disposable auth identity; no merchant or financial records are touched.
    if (actorId) await admin.query('DELETE FROM "user" WHERE id=$1', [actorId]);
    await admin.end();
  }
});
