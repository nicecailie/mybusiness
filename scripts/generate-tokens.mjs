import fs from 'node:fs';
const tokens = JSON.parse(fs.readFileSync('packages/design-tokens/tokens.json', 'utf8'));
const css =
  '/* Generated from tokens.json by pnpm tokens:generate. */\n:root {\n' +
  Object.entries(tokens.color)
    .map(([key, value]) => `  --${key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}: ${value};`)
    .join('\n') +
  '\n  --green: var(--primary);\n  --green-hover: var(--primary-hover);\n  --soft: #eef4ef;\n}\n';
fs.writeFileSync('packages/design-tokens/tokens.css', css);
