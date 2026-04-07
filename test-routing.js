const https = require('https');

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('Timeout')));
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function test() {
  // Charlotte NC (35.1287, -80.9338) -> El Paso TX (31.7619, -106.4424)
  const osrmUrl = "https://routing.openstreetmap.de/routed-car/route/v1/driving/-80.9338,35.1287;-106.4424,31.7619?overview=false";
  try {
    const res = await fetchUrl(osrmUrl);
    console.log('OSRM DE:', res.status, res.data.substring(0, 100));
  } catch(e) {
    console.log('OSRM DE Error:', e.message);
  }
}

test();
