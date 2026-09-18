import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { safeRelative, sourcePath } from './scan.js';

// 字符串编辑器只返回提示文本，按明确参数重建预期内容，再由采集器核对磁盘哈希。
export async function editorEvidence(root, args) {
  if (!['create', 'str_replace', 'insert'].includes(args?.command) || typeof args.path !== 'string') return null;
  const relative = await safeRelative(root, args.path);
  if (!relative || !sourcePath(relative)) return null;
  let before;
  try { before = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path.join(root, relative))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; before = null; }
  let after;
  if (args.command === 'create' && before === null && typeof args.file_text === 'string') after = args.file_text;
  if (typeof before === 'string' && args.command === 'str_replace' && typeof args.old_str === 'string' && args.old_str && (args.new_str === undefined || typeof args.new_str === 'string')) {
    const at = before.indexOf(args.old_str);
    if (at >= 0 && before.indexOf(args.old_str, at + 1) < 0) after = before.slice(0, at) + (args.new_str ?? '') + before.slice(at + args.old_str.length);
  }
  if (typeof before === 'string' && args.command === 'insert' && typeof args.new_str === 'string') {
    const lines = before.split('\n');
    if (Number.isInteger(args.insert_line) && args.insert_line >= 0 && args.insert_line <= lines.length) after = [...lines.slice(0, args.insert_line), ...args.new_str.split('\n'), ...lines.slice(args.insert_line)].join('\n');
  }
  return typeof after === 'string' ? { path: relative, before, after, operation: before === null ? 'create' : 'update' } : null;
}
