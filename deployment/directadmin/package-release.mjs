import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const root = process.cwd(),
  target = path.resolve(process.env.MYBUSINESS_RELEASE_DIR ?? '.data/directadmin-release');
if (fs.existsSync(target))
  throw new Error(
    'Release directory already exists; retain it and choose a new path before rebuilding.',
  );
fs.mkdirSync(target, { recursive: true });
for (const name of ['app.cjs', 'server.mjs'])
  fs.copyFileSync(`deployment/directadmin/${name}`, `${target}/${name}`);
fs.cpSync('.data/directadmin-compiled', `${target}/dist`, { recursive: true });
fs.mkdirSync(`${target}/web`);
fs.cpSync('apps/web/.next', `${target}/web/.next`, {
  recursive: true,
  filter: (source) => !/(?:^|\/)(?:cache|dev|standalone)(?:\/|$)/.test(source),
});
if (fs.existsSync('apps/web/public'))
  fs.cpSync('apps/web/public', `${target}/web/public`, { recursive: true });
fs.copyFileSync('deployment/directadmin/next.config.mjs', `${target}/web/next.config.mjs`);
fs.cpSync('prisma/migrations', `${target}/prisma/migrations`, { recursive: true });
const clientRequire = createRequire(
  fs.realpathSync(path.join(root, 'node_modules/@prisma/client/package.json')),
);
const generated = path.dirname(clientRequire.resolve('.prisma/client/package.json'));
fs.cpSync(generated, `${target}/generated-prisma`, { recursive: true });
const app = JSON.parse(fs.readFileSync('package.json', 'utf8')),
  web = JSON.parse(fs.readFileSync('apps/web/package.json', 'utf8'));
const names = [
  '@better-auth/expo',
  '@nestjs/common',
  '@nestjs/core',
  '@nestjs/platform-express',
  '@nestjs/swagger',
  '@prisma/adapter-pg',
  '@prisma/client',
  'better-auth',
  'dotenv',
  'express',
  'pg',
  'reflect-metadata',
  'rxjs',
  'zod',
];
const dependencies = Object.fromEntries(names.map((name) => [name, app.dependencies[name]]));
Object.assign(dependencies, web.dependencies);
fs.writeFileSync(
  `${target}/package.json`,
  JSON.stringify(
    {
      name: 'mybusiness-hosted',
      version: '0.1.0',
      private: true,
      type: 'module',
      engines: { node: '>=24' },
      scripts: {
        start: 'node app.cjs',
        migrate: 'node dist/scripts/migrate.js',
        postinstall: 'node install-prisma.cjs',
      },
      dependencies,
    },
    null,
    2,
  ) + '\n',
);
fs.writeFileSync(
  `${target}/install-prisma.cjs`,
  `const fs=require('node:fs');fs.cpSync('generated-prisma','node_modules/.prisma/client',{recursive:true});\n`,
);
fs.writeFileSync(
  `${target}/web/package.json`,
  JSON.stringify({ name: 'mybusiness-web', private: true, type: 'module' }),
);
console.log(
  `Prepared ${path.relative(root, target)}. Generate the deployment lockfile, then archive this directory; no environment, credentials, local database, or test records are included.`,
);
