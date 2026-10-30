// server/static.ts
// The game's page, served by the room server itself when it has a STATIC_DIR (server/index.ts): one address, behind
// one tunnel (tools/play.ts) or one deploy (Dockerfile), is the game and its server.
import type http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// The game's page and what it loads, from `root`: index.html for /, its manifest (a phone's home screen), and the
// files under css/, dist/ and assets/ (the rest of the folder, its sources, tools and dotfiles among them, is never
// served). True when it answered.
const STATIC_FOLDERS = ['css', 'dist', 'assets'];
const STATIC_FILES = ['index.html', 'manifest.webmanifest'];
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ktx2': 'image/ktx2',
  '.webmanifest': 'application/manifest+json', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wasm': 'application/wasm'
};
export function serveStatic(root: string, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    return false;
  }
  const parts = pathname.split('/').filter(Boolean);
  if (parts.some((part) => part.startsWith('.') || part.includes('\\'))) return false; // (no dotfiles, no climbing out)
  const allowed = parts.length === 0 || (parts.length === 1 && STATIC_FILES.includes(parts[0])) || (parts.length > 1 && STATIC_FOLDERS.includes(parts[0]));
  if (!allowed) return false;
  const base = path.resolve(root);
  const file = path.resolve(base, parts.length ? parts.join('/') : 'index.html');
  if (!file.startsWith(base + path.sep)) return false;
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()];
  if (!type) return false;
  let size: number;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    size = stat.size;
  } catch {
    return false;
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'cache-control': 'no-cache' });
  if (req.method === 'HEAD') res.end();
  else fs.createReadStream(file).pipe(res);
  return true;
}
