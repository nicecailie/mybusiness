import fs from 'node:fs';
import path from 'node:path';
const records = new Map();
const packageSection =
  fs.readFileSync('pnpm-lock.yaml', 'utf8').split('\npackages:\n')[1]?.split('\nsnapshots:\n')[0] ??
  '';
const active = new Set(
  [...packageSection.matchAll(/^  (?:'([^']+)'|([^:\n]+)):\s*$/gm)].map((m) => m[1] ?? m[2]),
);
function collect(file) {
  try {
    const p = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (p.name && p.version && active.has(`${p.name}@${p.version}`))
      records.set(`${p.name}@${p.version}`, {
        name: p.name,
        version: p.version,
        license: typeof p.license === 'string' ? p.license : (p.license?.type ?? 'UNDECLARED'),
        homepage: p.homepage ?? null,
      });
  } catch {
    /* Missing package metadata remains a delivery review dependency. */
  }
}
for (const directory of fs.readdirSync('node_modules/.pnpm', { withFileTypes: true })) {
  if (!directory.isDirectory()) continue;
  const root = path.join('node_modules/.pnpm', directory.name, 'node_modules');
  if (!fs.existsSync(root)) continue;
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (ent.name.startsWith('@') && ent.isDirectory()) {
      for (const name of fs.readdirSync(path.join(root, ent.name)))
        collect(path.join(root, ent.name, name, 'package.json'));
    } else if (ent.isDirectory()) collect(path.join(root, ent.name, 'package.json'));
  }
}
const sorted = [...records.values()].sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);
fs.writeFileSync(
  'docs/dependency-licenses.json',
  JSON.stringify(
    {
      generated: '2026-10-27',
      source: 'Installed package declarations; metadata inventory, not legal approval',
      packages: sorted,
    },
    null,
    2,
  ) + '\n',
);
const lines = [
  '# Dependency metadata inventory',
  '',
  'Generated from installed package manifests. Full transitive metadata is in dependency-licenses.json. Distribution license remains undecided; private repository, no unilateral license grant. No ERP source was copied. Re-run `pnpm licenses:inventory` after dependency changes. Review license texts and missing declarations before distribution.',
  '',
  '| Direct dependency | Pinned version | Declared license |',
  '| --- | --- | --- |',
];
for (const manifest of ['package.json', 'apps/web/package.json', 'apps/mobile/package.json']) {
  const p = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  for (const [name, version] of Object.entries({ ...p.dependencies, ...p.devDependencies })) {
    const info = sorted.find((r) => r.name === name && r.version === version);
    lines.push(`| ${name} | ${version} | ${info?.license ?? 'Review required'} |`);
  }
}
fs.writeFileSync('docs/DEPENDENCIES.md', lines.join('\n') + '\n');
console.log(`Inventoried ${sorted.length} installed packages.`);
