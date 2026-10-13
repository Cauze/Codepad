/*
 * Pure path helpers, kept free of app imports so they can be tested on their own (tests/unit).
 */

/**
 * Resolve `src` (a link or image address, relative to the Markdown file's folder `baseDir`, which ends in a
 * separator) to an absolute path, or null if it isn't a local file. Windows paths come back with backslashes,
 * macOS paths with slashes; which one applies follows `baseDir`.
 */
export function resolveLocal(baseDir: string, src: string): string | null {
  let rel = src.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(rel) && !/^(file:|[a-zA-Z]:[\\/])/.test(rel)) return null; // http:, data:, mailto: ...
  const posix = baseDir ? baseDir.startsWith('/') : /^(file:\/\/\/(?![a-zA-Z]:)|\/)/i.test(rel);
  rel = posix ? rel.replace(/^file:\/\//i, '') : rel.replace(/^file:\/+/i, '');
  rel = rel.split(/[?#]/)[0] ?? '';
  try { rel = decodeURIComponent(rel); } catch { /* leave it as written */ }
  if (!rel) return null;

  if (posix) {
    const out: string[] = [];
    for (const part of (rel.startsWith('/') ? rel : baseDir + rel).split('/')) {
      if (part === '.' || part === '') continue;
      if (part === '..') out.pop(); else out.push(part);
    }
    return '/' + out.join('/');
  }

  const absolute = /^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith('\\\\');
  const full = absolute ? rel : baseDir + rel;
  const unc = full.startsWith('\\\\');
  const out: string[] = [];
  for (const part of full.split(/[\\/]+/)) {
    if (part === '.' || part === '') continue;
    if (part === '..') { if (out.length > 1) out.pop(); } else out.push(part);
  }
  return (unc ? '\\\\' : '') + out.join('\\');
}
