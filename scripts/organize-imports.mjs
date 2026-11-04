import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
const paths = process.argv.slice(2).map((p) => path.resolve(p));
const options = {
  allowJs: false,
  jsx: ts.JsxEmit.ReactJSX,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  esModuleInterop: true,
};
const host = {
  getScriptFileNames: () => paths,
  getScriptVersion: () => '1',
  getScriptSnapshot: (file) =>
    fs.existsSync(file) ? ts.ScriptSnapshot.fromString(fs.readFileSync(file, 'utf8')) : undefined,
  getCurrentDirectory: () => process.cwd(),
  getCompilationSettings: () => options,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
};
const service = ts.createLanguageService(host);
for (const file of paths) {
  const changes = service.organizeImports({ type: 'file', fileName: file }, {}, {});
  for (const change of changes) {
    let source = fs.readFileSync(change.fileName, 'utf8');
    for (const edit of change.textChanges.sort((a, b) => b.span.start - a.span.start))
      source =
        source.slice(0, edit.span.start) +
        edit.newText +
        source.slice(edit.span.start + edit.span.length);
    fs.writeFileSync(change.fileName, source);
  }
}
