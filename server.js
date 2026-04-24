const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const dataDir = path.join(root, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
const outboxDir = path.join(dataDir, 'outbox');
const dbFile = path.join(dataDir, 'admin-config.json');
const port = process.env.PORT || 3000;
const adminPassword = process.env.ADMIN_PASSWORD || 'moonadmin';

for (const dir of [dataDir, uploadsDir, outboxDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    ...headers
  });
  res.end(payload);
}

function readBody(req, limitBytes = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeName(value) {
  return String(value || 'file').replace(/[^a-z0-9_.-]/gi, '_').slice(0, 120);
}

async function handleApi(req, res) {
  if (req.url === '/api/auth' && req.method === 'POST') {
    const raw = await readBody(req, 1024 * 1024);
    const parsed = JSON.parse(raw || '{}');
    return send(res, 200, { ok: String(parsed.password || '') === adminPassword });
  }

  if (req.url === '/api/db' && req.method === 'GET') {
    if (!fs.existsSync(dbFile)) return send(res, 200, {});
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return fs.createReadStream(dbFile).pipe(res);
  }

  if (req.url === '/api/db' && req.method === 'POST') {
    const raw = await readBody(req);
    const parsed = JSON.parse(raw || '{}');
    fs.writeFileSync(dbFile, JSON.stringify(parsed, null, 2));
    return send(res, 200, { ok: true });
  }

  if (req.url === '/api/upload' && req.method === 'POST') {
    const raw = await readBody(req, 45 * 1024 * 1024);
    const parsed = JSON.parse(raw || '{}');
    const id = safeName(parsed.id || Date.now());
    const type = safeName(parsed.type || 'upload');
    const image = String(parsed.image || '');
    const base64 = image.includes(',') ? image.split(',').pop() : image;
    if (!base64) return send(res, 400, { ok: false, error: 'Missing image' });
    const file = path.join(uploadsDir, `${id}_${type}.png`);
    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
    return send(res, 200, { ok: true, file: path.relative(root, file) });
  }

  if (req.url === '/api/send' && req.method === 'POST') {
    const raw = await readBody(req, 45 * 1024 * 1024);
    const file = path.join(outboxDir, `message_${Date.now()}.json`);
    fs.writeFileSync(file, raw || '{}');
    return send(res, 200, {
      ok: true,
      message: 'Saved to server outbox. Configure an email provider before using live email delivery.'
    });
  }

  send(res, 404, { ok: false, error: 'Not found' });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const cleanPath = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.normalize(path.join(root, cleanPath));

  if (!filePath.startsWith(root)) return send(res, 403, 'Forbidden');
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    const fallback = path.join(root, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(fallback).pipe(res);
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) return await handleApi(req, res);
    serveStatic(req, res);
  } catch (err) {
    console.error(err);
    send(res, 500, { ok: false, error: err.message || 'Server error' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Moon2026 running on http://localhost:${port}`);
});
