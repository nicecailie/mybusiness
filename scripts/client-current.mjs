// Reuse only a generated client for the same schema and installed Prisma version.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
try {
  const clientRequire = createRequire(require.resolve('@prisma/client'));
  const generated = clientRequire.resolve('.prisma/client/schema.prisma');
  const tokens = (value) => value.match(/"(?:[^"\\]|\\.)*"|[^\s]+/g).join('');
  if (
    tokens(readFileSync(generated, 'utf8')) !== tokens(readFileSync('prisma/schema.prisma', 'utf8'))
  )
    process.exit(1);
  if (
    clientRequire('.prisma/client').Prisma.prismaVersion.client !==
    require('@prisma/client/package.json').version
  )
    process.exit(1);
} catch {
  process.exit(1);
}
console.log('Existing generated client matches the schema and installed Prisma version.');
