import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { countLines } from '../core/metrics.js';

const run = promisify(execFile);
const excluded = new Set(['.git', 'node_modules', 'dist', 'build', 'vendor', '.venv', 'venv', 'work', 'artifacts', 'generated', '.next', 'coverage', '__pycache__', 'target', 'bin', 'obj', 'appdata', '.dsh', '.codex', '.agents', '.cache', '.npm', '.pnpm-store']);
const extensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte', '.html', '.css', '.scss', '.sass', '.less', '.py', '.pyi', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.swift', '.m', '.mm', '.php', '.sh', '.bash', '.ps1', '.sql', '.r', '.R', '.lua', '.dart', '.ex', '.exs', '.erl', '.hrl', '.clj', '.cljs', '.scala', '.jl', '.zig', '.f90', '.f95', '.proto', '.graphql', '.gql', '.md', '.mdx', '.json', '.yaml', '.yml', '.toml', '.xml']);
const decoder = new TextDecoder('utf-8', { fatal: true });
extensions.add('.txt');

export const fingerprint = text => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

const normalizeName = name => process.platform === 'win32' ? name.replaceAll('\\', '/').toLowerCase() : name;

// execFile 对非零退出码给出数字 code（git 在非仓库目录返回 128），只有 ENOENT 之类才是字符串。
const gitUnavailable = error => error.code === 128 || error.code === 'ENOENT';
const gitListTooLarge = error => error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';

/** 一次取全量 git 文件清单；逐文件调用会为每个文件重复 spawn 一次 git。 */
export async function gitFileList(root) {
  const { stdout } = await run('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  return new Set(stdout.split('\0').filter(Boolean).map(normalizeName));
}

export async function includedByGit(root, relative) {
  return (await gitFileList(root)).has(normalizeName(relative));
}

export function sourcePath(relative) {
  const parts = relative.replaceAll('\\', '/').split('/');
  if (parts.some(part => excluded.has(part.toLowerCase()) || part === '..')) return false;
  const name = parts.at(-1);
  if (/^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock)$/i.test(name)) return false;
  if (/(\.min\.|\.generated\.|\.g\.cs$|\.map$)/i.test(name)) return false;
  return extensions.has(path.extname(name).toLowerCase());
}

export async function safeRelative(root, candidate) {
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) return null;
  let cursor = root;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) return null;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      break;
    }
  }
  const normalized = relative.replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function walk(root, warnings, relative = '') {
  const results = [];
  let entries;
  try { entries = await readdir(path.join(root, relative), { withFileTypes: true }); }
  catch (error) {
    if (!relative || !['EACCES', 'EPERM', 'ENOENT'].includes(error.code)) throw error;
    warnings.push(`unreadable-directory:${relative}`);
    return results;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || excluded.has(entry.name.toLowerCase())) continue;
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) results.push(...await walk(root, warnings, name));
    else if (entry.isFile() && sourcePath(name)) results.push(name);
  }
  return results;
}

export async function scanProject(inputRoot, selection) {
  const root = path.resolve(inputRoot);
  if ((await lstat(root)).isSymbolicLink()) throw new Error('Project root must not be a symbolic link');
  const canonical = await realpath(root);
  let names;
  const warnings = [];
  const ignored = [];
  let mode = 'filesystem';
  let included = null;
  if (selection) {
    names = selection.paths;
    mode = selection.mode;
    // 选定路径同样按 git 规则复核，整批只取一次清单。
    // 局部扫描必须失败即止：悄悄退回文件系统口径会把被忽略文件的行数并进项目总量。
    if (mode === 'git') included = await gitFileList(canonical);
  } else try {
    included = await gitFileList(canonical);
    names = [...included];
    mode = 'git';
  } catch (error) {
    // git 不可用或清单过大时退回文件系统遍历，此时 .gitignore 规则完全不生效，必须明确告知。
    if (!gitUnavailable(error) && !gitListTooLarge(error)) throw error;
    if (gitListTooLarge(error)) warnings.push('git-list-too-large');
    warnings.push('gitignore-rules-not-applied');
    names = await walk(canonical, warnings);
  }
  const files = {};
  let total = 0;
  for (const name of [...new Set(names)].sort()) {
    if (!sourcePath(name)) continue;
    try {
      const relative = await safeRelative(canonical, name);
      if (!relative) continue;
      if (included && !included.has(relative)) { ignored.push(relative); continue; }
      const absolute = path.join(canonical, relative);
      if (!(await lstat(absolute)).isFile()) continue;
      const buffer = await readFile(absolute);
      if (buffer.includes(0)) { warnings.push(`binary:${relative}`); continue; }
      let text;
      try { text = decoder.decode(buffer); }
      catch { warnings.push(`encoding:${relative}`); continue; }
      const lines = countLines(text);
      files[relative] = { lines, hash: fingerprint(text) };
      total += lines;
    } catch (error) {
      if (error.code === 'ENOENT') { warnings.push(`changed-during-scan:${name}`); continue; }
      if (['EACCES', 'EPERM'].includes(error.code)) { warnings.push(`unreadable-file:${name}`); continue; }
      throw error;
    }
  }
  return { root: canonical, total, files, warnings, ignored, mode };
}
