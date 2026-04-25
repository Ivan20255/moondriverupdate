const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const dataDir = path.join(root, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
const outboxDir = path.join(dataDir, 'outbox');
const dbFile = path.join(dataDir, 'admin-config.json');
const port = process.env.PORT || 3000;
const adminPassword = process.env.ADMIN_PASSWORD || 'moonadmin';
const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || '';

for (const dir of [dataDir, uploadsDir, outboxDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
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
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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

function extForMime(mime) {
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  return '.bin';
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = options.body || '';
    const request = https.request({
      hostname: target.hostname,
      path: `${target.pathname}${target.search}`,
      method: options.method || 'GET',
      headers: {
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(options.headers || {})
      }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: response.statusCode || 0, data: responseBody ? JSON.parse(responseBody) : {}, body: responseBody });
        } catch (err) {
          reject(new Error(`Invalid JSON response: ${responseBody.slice(0, 160)}`));
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('Google Maps request timed out')));
    if (body) request.write(body);
    request.end();
  });
}

function formatMiles(meters) {
  const miles = Number(meters || 0) / 1609.344;
  if (!miles) return '';
  return `${miles >= 100 ? Math.round(miles) : miles.toFixed(1)} mi`;
}

function formatDuration(duration) {
  const seconds = Number(String(duration || '').replace(/s$/, ''));
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (!hours) return `${minutes || 1} min`;
  if (!minutes) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

function normalizeRoutesApiRoutes(routes) {
  return (routes || []).map((route, index) => {
    const meters = Number(route.distanceMeters || 0);
    return {
      summary: route.description || `Route ${index + 1}`,
      distanceText: route.localizedValues?.distance?.text || formatMiles(meters),
      duration: route.localizedValues?.duration?.text || formatDuration(route.duration),
      miles: meters ? meters / 1609.344 : 0,
      encodedPolyline: route.polyline?.encodedPolyline || ''
    };
  }).filter(route => route.miles > 0);
}

async function fetchRoutesApi(originZip, destinationZip, key) {
  const body = JSON.stringify({
    origin: { address: `${originZip}, USA` },
    destination: { address: `${destinationZip}, USA` },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_UNAWARE',
    computeAlternativeRoutes: true,
    polylineQuality: 'OVERVIEW',
    polylineEncoding: 'ENCODED_POLYLINE',
    units: 'IMPERIAL',
    languageCode: 'en-US',
    regionCode: 'US'
  });

  const response = await requestJson('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.description,routes.polyline.encodedPolyline,routes.localizedValues'
    },
    body
  });
  if (response.status < 200 || response.status >= 300 || response.data.error) {
    throw new Error(response.data.error?.message || `Google Routes HTTP ${response.status}`);
  }

  const routes = normalizeRoutesApiRoutes(response.data.routes);
  if (!routes.length) throw new Error('Google Routes returned no drivable routes');
  return routes;
}

async function fetchLegacyDirections(originZip, destinationZip, key) {
  const params = new URLSearchParams({
    origin: originZip,
    destination: destinationZip,
    alternatives: 'true',
    mode: 'driving',
    units: 'imperial',
    key
  });
  const response = await requestJson(`https://maps.googleapis.com/maps/api/directions/json?${params}`);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Google Maps HTTP ${response.status}`);
  }
  const data = response.data;
  if (data.status !== 'OK') {
    throw new Error(data.error_message || data.status || 'Google Maps route failed');
  }
  const routes = (data.routes || []).map(route => {
    const leg = route.legs && route.legs[0] ? route.legs[0] : {};
    const meters = Number(leg.distance?.value || 0);
    return {
      summary: route.summary || 'Route',
      distanceText: leg.distance?.text || '',
      duration: leg.duration?.text || '',
      miles: meters ? meters / 1609.344 : 0,
      encodedPolyline: route.overview_polyline?.points || ''
    };
  }).filter(route => route.miles > 0);
  if (!routes.length) throw new Error('Google Maps returned no drivable routes');
  return routes;
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
    const raw = await readBody(req, 60 * 1024 * 1024);
    const parsed = JSON.parse(raw || '{}');
    const id = safeName(parsed.id || Date.now());
    const type = safeName(parsed.type || 'upload');
    const payload = String(parsed.image || parsed.dataUrl || parsed.file || '');
    const match = payload.match(/^data:([^;]+);base64,(.+)$/);
    const mime = parsed.mime || (match ? match[1] : 'image/png');
    const base64 = match ? match[2] : (payload.includes(',') ? payload.split(',').pop() : payload);
    if (!base64) return send(res, 400, { ok: false, error: 'Missing file data' });
    const filename = parsed.filename
      ? `${id}_${type}_${safeName(parsed.filename)}`
      : `${id}_${type}${extForMime(mime)}`;
    const file = path.join(uploadsDir, filename);
    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
    return send(res, 200, { ok: true, file: path.relative(root, file) });
  }

  if (req.url === '/api/google-routes' && req.method === 'POST') {
    const raw = await readBody(req, 1024 * 1024);
    const parsed = JSON.parse(raw || '{}');
    const originZip = String(parsed.originZip || '').replace(/\D/g, '').slice(0, 5);
    const destinationZip = String(parsed.destinationZip || '').replace(/\D/g, '').slice(0, 5);
    const key = String(parsed.apiKey || googleMapsApiKey || '').trim();
    if (!/^\d{5}$/.test(originZip) || !/^\d{5}$/.test(destinationZip)) {
      return send(res, 400, { ok: false, error: 'Enter valid 5-digit ZIP codes' });
    }
    if (!key) return send(res, 400, { ok: false, error: 'Missing Google Maps API key' });

    try {
      const routes = await fetchRoutesApi(originZip, destinationZip, key);
      return send(res, 200, { ok: true, source: 'routes', routes });
    } catch (routesErr) {
      try {
        const routes = await fetchLegacyDirections(originZip, destinationZip, key);
        return send(res, 200, { ok: true, source: 'directions', routes });
      } catch (directionsErr) {
        return send(res, 400, {
          ok: false,
          error: routesErr.message || directionsErr.message || 'Google Maps route failed'
        });
      }
    }
  }

  if (req.url === '/api/send' && req.method === 'POST') {
    const raw = await readBody(req, 60 * 1024 * 1024);
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
    if (req.method === 'OPTIONS') return send(res, 204, '');
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
