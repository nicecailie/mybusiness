import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const files = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.expo'].includes(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p) && !p.endsWith('.d.ts')) files.push(path.resolve(p));
  }
}
walk('apps');
walk('packages');
const graph = new Map();
for (const file of files) {
  const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    ),
    deps = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const spec = statement.moduleSpecifier.text;
    if (!spec.startsWith('.')) continue;
    const raw = path.resolve(path.dirname(file), spec).replace(/\.js$/, '');
    const target = [raw + '.ts', raw + '.tsx', path.join(raw, 'index.ts')].find((p) =>
      files.includes(p),
    );
    if (target) deps.push(target);
    if (
      file.includes('/packages/domain/') &&
      target &&
      !target.includes('/packages/domain/') &&
      !target.includes('/packages/contracts/')
    )
      throw new Error(`Domain imports IO or UI: ${file}`);
    if (file.includes('/packages/') && target?.startsWith(path.resolve('apps') + path.sep))
      throw new Error(`Shared package imports an app: ${file}`);
  }
  graph.set(file, deps);
}
const active = new Set(),
  done = new Set();
function visit(file, stack) {
  if (active.has(file))
    throw new Error(
      `Import cycle: ${[...stack, file].map((p) => path.relative(process.cwd(), p)).join(' -> ')}`,
    );
  if (done.has(file)) return;
  active.add(file);
  for (const dep of graph.get(file) ?? []) visit(dep, [...stack, file]);
  active.delete(file);
  done.add(file);
}
for (const file of files) visit(file, []);
console.log(`Checked ${files.length} modules: no import cycles or forbidden package dependencies.`);
