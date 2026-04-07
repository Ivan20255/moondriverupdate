const https = require('https');

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('Timeout')));
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function testValhallaSegmented() {
  const charlotte = { lat: 35.1287, lon: -80.9338 };
  const elpaso = { lat: 31.7619, lon: -106.4424 };
  const midpoint = {
    lat: (charlotte.lat + elpaso.lat) / 2,
    lon: (charlotte.lon + elpaso.lon) / 2
  };

  const body = JSON.stringify({
    locations: [
      { lat: charlotte.lat, lon: charlotte.lon, type: 'break' },
      { lat: midpoint.lat, lon: midpoint.lon, type: 'break' },
      { lat: elpaso.lat, lon: elpaso.lon, type: 'break' }
    ],
    costing: 'truck',
    units: 'miles'
  });
  
  try {
    const res = await fetchUrl('https://valhalla1.openstreetmap.de/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    console.log('Status:', res.status, res.data.substring(0, 100));
  } catch (err) {
    console.error(err);
  }
}

testValhallaSegmented();
