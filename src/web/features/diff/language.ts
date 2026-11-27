/** File names whose grammar their extension doesn't tell. */
const BY_NAME: Readonly<Record<string, string>> = {
  dockerfile: 'docker',
  containerfile: 'docker',
  makefile: 'make',
  gnumakefile: 'make',
  'cmakelists.txt': 'cmake',
  jenkinsfile: 'groovy',
  gemfile: 'ruby',
  rakefile: 'ruby',
  podfile: 'ruby',
  brewfile: 'ruby',
  '.bashrc': 'shellscript',
  '.bash_profile': 'shellscript',
  '.zshrc': 'shellscript',
  '.profile': 'shellscript',
  '.editorconfig': 'ini',
  '.gitconfig': 'ini',
  '.npmrc': 'ini',
  '.babelrc': 'json',
  '.prettierrc': 'json',
  '.eslintrc': 'json',
};

/** Extensions that aren't a grammar's id or alias. */
const BY_EXTENSION: Readonly<Record<string, string>> = {
  mts: 'typescript',
  cts: 'typescript',
  mjs: 'javascript',
  cjs: 'javascript',
  htm: 'html',
  xhtml: 'html',
  svg: 'xml',
  plist: 'xml',
  xsd: 'xml',
  csproj: 'xml',
  props: 'xml',
  zsh: 'shellscript',
  bash: 'shellscript',
  h: 'c',
  hh: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  kts: 'kotlin',
  gradle: 'groovy',
  tf: 'terraform',
  tfvars: 'terraform',
  ps1: 'powershell',
  psm1: 'powershell',
  cfg: 'ini',
  conf: 'ini',
  lock: 'yaml',
  mdx: 'mdx',
  markdown: 'markdown',
  geojson: 'json',
  webmanifest: 'json',
};

/** Plain text: never worth a grammar. */
const PLAIN = new Set(['txt', 'text', 'log']);

/**
 * The Shiki grammar for a path, or null for plain text. `resolve` turns a
 * grammar id or alias ("ts") into the grammar's id ("typescript"), or null
 * when Shiki has no such grammar.
 */
export function languageFor(path: string, resolve: (idOrAlias: string) => string | null): string | null {
  const name = (path.split('/').at(-1) ?? path).toLowerCase();
  const byName = BY_NAME[name];
  if (byName) return resolve(byName);
  if (name.startsWith('.env')) return resolve('dotenv');
  if (name.startsWith('dockerfile.') || name.endsWith('.dockerfile')) return resolve('docker');

  const dot = name.lastIndexOf('.');
  if (dot <= 0 && !name.startsWith('.')) return null;
  const extension = name.slice(dot + 1);
  if (PLAIN.has(extension)) return null;
  return resolve(BY_EXTENSION[extension] ?? extension);
}
