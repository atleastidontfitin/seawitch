import fs from 'node:fs';
import path from 'node:path';

export function outputPathFor(sourceFile: string, srcRoot: string, outRoot: string): string {
  const relative = path.relative(srcRoot, sourceFile).replace(/\.sea\.mmd$/, '.ts');
  return path.join(outRoot, relative);
}

export function rewriteSpecifier(options: {
  sourceFile: string;
  outputFile: string;
  specifier: string;
  srcRoot: string;
  outRoot: string;
}): string {
  const target = options.specifier.endsWith('.sea.mmd')
    ? outputPathFor(path.resolve(path.dirname(options.sourceFile), options.specifier), options.srcRoot, options.outRoot).replace(
        /\.ts$/,
        '.js',
      )
    : path.resolve(path.dirname(options.sourceFile), options.specifier);
  let relative = path.relative(path.dirname(options.outputFile), target);
  if (!relative.startsWith('.')) {
    relative = `./${relative}`;
  }
  return relative.split(path.sep).join('/');
}

export function resolveImportFile(sourceFile: string, specifier: string): string | undefined {
  const absolute = path.resolve(path.dirname(sourceFile), specifier);
  if (specifier.endsWith('.sea.mmd')) {
    return fs.existsSync(absolute) ? absolute : undefined;
  }
  if (!specifier.endsWith('.js')) {
    return undefined;
  }
  const withoutExtension = absolute.slice(0, -3);
  const candidates = [absolute, `${withoutExtension}.ts`, `${withoutExtension}.tsx`, `${withoutExtension}.d.ts`];
  return candidates.find((candidate) => fs.existsSync(candidate));
}
