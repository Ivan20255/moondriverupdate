// Moon Express Driver Trip Sheet — Server with Valhalla Truck Routing Proxy
// Serves static files AND proxies Valhalla API requests to bypass CORS

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 5000;
const VALHALLA_HOST = 'valhalla1.openstreetmap.de';

// MIME types for static files
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  // CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Valhalla Proxy: POST /valhalla/* ──────────────────────────
  if (req.url.startsWith('/valhalla/') && req.method === 'POST') {
    const valhallaPath = '/' + req.url.slice('/valhalla/'.length);
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const options = {
        hostname: VALHALLA_HOST,
        port: 443,
        path: valhallaPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'MoonExpress-TripSheet/1.0'
        }
      };

      const proxyReq = https.request(options, proxyRes => {
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': proxyRes.headers['content-type'] || 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        proxyRes.pipe(res);
      });

      proxyReq.on('error', err => {
        console.error('Valhalla proxy error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Valhalla proxy error', detail: err.message }));
      });

      proxyReq.setTimeout(15000, () => {
        proxyReq.destroy();
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Valhalla proxy timeout' }));
      });

      proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  // ── PC*Miler Proxy: POST /pcmiler/api ──────────────────────────
  if (req.url.startsWith('/pcmiler/api') && req.method === 'POST') {
    const authKey = req.headers['x-pcmiler-auth'] || '';

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const options = {
        hostname: 'pcmiler.alk.com',
        port: 443,
        path: '/APIs/REST/v1.0/Service.svc/route/routeReports?dataVersion=Current',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Authorization': authKey,
          'User-Agent': 'MoonExpress-TripSheet/1.0'
        }
      };

      const proxyReq = https.request(options, proxyRes => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': proxyRes.headers['content-type'] || 'application/json',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(data);
        });
      });

      proxyReq.on('error', err => {
        console.error('PC*Miler proxy error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'PC*Miler proxy error', detail: err.message }));
      });

      proxyReq.setTimeout(15000, () => {
        proxyReq.destroy();
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'PC*Miler proxy timeout' }));
      });

      proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  // ── Database API: /api/db ─────────────────────────────────────
  const dbPath = path.join(__dirname, 'data', 'db.json');
  if (!fs.existsSync(path.dirname(dbPath))) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  if (req.url === '/api/db') {
    if (req.method === 'GET') {
      fs.readFile(dbPath, 'utf8', (err, data) => {
        if (err) {
          if (err.code === 'ENOENT') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ drivers: [], globalDeductions: [], reports: [] }));
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to read database' }));
          }
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      });
      return;
    }
    
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        fs.writeFile(dbPath, body, 'utf8', (err) => {
          if (err) {
            console.error('Failed to write database:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to save database' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        });
      });
      return;
    }
  }
  
  // ── Receipt Upload API: /api/upload ───────────────────────────
  if (req.url === '/api/upload' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const receiptsDir = path.join(__dirname, 'data', 'receipts');
        if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
        
        const base64Data = payload.image.replace(/^data:image\/png;base64,/, "");
        const fileName = `${payload.id}_${payload.type}.png`;
        const filePath = path.join(receiptsDir, fileName);
        
        fs.writeFileSync(filePath, base64Data, 'base64');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, url: `/data/receipts/${fileName}` }));
      } catch (err) {
        console.error('Failed to upload receipt:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to upload' }));
      }
    });
    return;
  }

  // ── Mock Email API: /api/send ──────────────────────────────
  if (req.url === '/api/send' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const outboxDir = path.join(__dirname, 'data', 'outbox');
        if (!fs.existsSync(outboxDir)) fs.mkdirSync(outboxDir, { recursive: true });
        
        // Save the mock email payload to a file
        const fileName = `email_${Date.now()}.json`;
        fs.writeFileSync(path.join(outboxDir, fileName), JSON.stringify(payload, null, 2));
        
        console.log(`[EMAIL DISPATCHED] To: ${payload.to} | Subject: ${payload.subject}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to dispatch email' }));
      }
    });
    return;
  }

  // ── Static File Server ────────────────────────────────────────
  let filePath = req.url.split('?')[0];
  if (filePath === '/') filePath = '/index.html';
  filePath = path.join(__dirname, filePath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🚛 Moon Express Trip Sheet Server`);
  console.log(`  ──────────────────────────────────`);
  console.log(`  Local:    http://localhost:${PORT}`);
  console.log(`  Network:  http://0.0.0.0:${PORT}`);
  console.log(`  PC*Miler: /pcmiler/* (truck mileage proxy)`);
  console.log(`  ──────────────────────────────────\n`);
});
