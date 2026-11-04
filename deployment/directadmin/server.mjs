import { config } from 'dotenv';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import next from 'next';

config({ path: new URL('./.env', import.meta.url), quiet: true });
process.env.API_NO_START = 'true';
const { createApplication } = await import('./dist/apps/api/src/main.js');
const api = await createApplication();
await api.init();
const web = next({
  dev: false,
  dir: fileURLToPath(new URL('./web', import.meta.url)),
  webpack: true,
});
await web.prepare();
const webHandler = web.getRequestHandler();
const apiHandler = api.getHttpAdapter().getInstance();
const server = createServer((req, res) => {
  if ((req.url ?? '').split('?')[0].startsWith('/api/')) {
    apiHandler(req, res);
    return;
  }
  const nonce = randomBytes(24).toString('base64');
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`;
  req.headers['content-security-policy'] = csp;
  req.headers['x-nonce'] = nonce;
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'private, no-store');
  void webHandler(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end('The request could not be completed.');
  });
});
server.listen(Number(process.env.PORT ?? 3000), () => console.log('MyBusiness web and API ready.'));
async function shutdown() {
  server.close();
  await web.close();
  await api.close();
  const { db, pool } = await import('./dist/apps/api/src/database.js');
  await db.$disconnect();
  await pool.end();
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
