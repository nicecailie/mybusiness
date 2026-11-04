import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
// Better Auth intentionally permits only three sign-ins per ten seconds.
// Independent acceptance suites share the local proxy IP; preserve the limiter.
for (const file of [
  'http.test.ts',
  'mfa-http.test.ts',
  'review-http.test.ts',
  'core-http.test.ts',
]) {
  console.log(`Waiting for the authentication rate window before ${file}.`);
  await setTimeout(11000);
  const code = await new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'tsx', '--test', `tests/${file}`], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (status) => resolve(status ?? 1));
  });
  if (code !== 0) process.exit(code);
}
