import { google } from 'googleapis';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CREDENTIALS = JSON.parse(fs.readFileSync(path.join(__dirname, 'client-secret.json'))).web;
const TOKENS_FILE = path.join(__dirname, 'tokens.json');
const PROPERTY_ID = '540752503';
const PORT = 3001;
const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

const oauth2Client = new google.auth.OAuth2(
  CREDENTIALS.client_id,
  CREDENTIALS.client_secret,
  'http://localhost:3001/callback'
);

// Load saved tokens if they exist
if (fs.existsSync(TOKENS_FILE)) {
  oauth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKENS_FILE)));
  console.log('✅ Loaded saved credentials');
}

oauth2Client.on('tokens', (tokens) => {
  const existing = fs.existsSync(TOKENS_FILE) ? JSON.parse(fs.readFileSync(TOKENS_FILE)) : {};
  const merged = { ...existing, ...tokens };
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(merged, null, 2));
  console.log('🔄 Tokens refreshed and saved');
});

// ── GA4 helper ──
async function runReport(body) {
  const analyticsData = google.analyticsdata({ version: 'v1beta', auth: oauth2Client });
  const res = await analyticsData.properties.runReport({
    property: `properties/${PROPERTY_ID}`,
    requestBody: body,
  });
  return res.data;
}

async function runRealtimeReport(body) {
  const analyticsData = google.analyticsdata({ version: 'v1beta', auth: oauth2Client });
  const res = await analyticsData.properties.runRealtimeReport({
    property: `properties/${PROPERTY_ID}`,
    requestBody: body,
  });
  return res.data;
}

// ── Fetch all metrics ──
async function fetchAllData(range) {
  const dateRange = { startDate: range, endDate: 'today' };

  const prevLen = range === '7daysAgo' ? 7 : range === '30daysAgo' ? 30 : range === '90daysAgo' ? 90 : 365;
  const prevRange = { startDate: `${prevLen * 2}daysAgo`, endDate: `${prevLen + 1}daysAgo` };

  const [overview, overviewPrev, sessionsByDay, sources, devices, countries, browsers,
    topPages, events, landingPages, channelsByDay, newReturning, engagementByDay, rt] = await Promise.all([
    runReport({ dateRanges:[dateRange], metrics:[{name:'sessions'},{name:'totalUsers'},{name:'newUsers'},{name:'screenPageViews'},{name:'averageSessionDuration'},{name:'bounceRate'},{name:'screenPageViewsPerSession'},{name:'engagedSessions'},{name:'engagementRate'},{name:'eventCount'}] }),
    runReport({ dateRanges:[prevRange], metrics:[{name:'sessions'},{name:'totalUsers'},{name:'newUsers'},{name:'screenPageViews'},{name:'averageSessionDuration'},{name:'bounceRate'},{name:'screenPageViewsPerSession'},{name:'engagedSessions'},{name:'engagementRate'},{name:'eventCount'}] }),
    runReport({ dateRanges:[dateRange], dimensions:[{name:'date'}], metrics:[{name:'sessions'},{name:'totalUsers'},{name:'engagedSessions'}], orderBys:[{dimension:{dimensionName:'date'}}] }),
    runReport({ dateRanges:[dateRange], dimensions:[{name:'sessionDefaultChannelGrouping'}], metrics:[{name:'sessions'},{name:'totalUsers'}], orderBys:[{metric:{metricName:'sessions'},desc:true}] }),
    runReport({ dateRanges:[dateRange], dimensions:[{name:'deviceCategory'}], metrics:[{name:'sessions'}], orderBys:[{metric:{metricName:'sessions'},desc:true}] }),
    runReport({ dateRanges:[dateRange], dimensions:[{name:'country'}], metrics:[{name:'sessions'},{name:'totalUsers'}], orderBys:[{metric:{metricName:'sessions'},desc:true}], limit:10 }),
    runReport({ dateRanges:[dateRange], dimensions:[{name:'browser'}], metrics:[{name:'sessions'}], orderBys:[{metric:{metricName:'sessions'},desc:true}], limit:8 }),
    runReport({ dateRanges:[dateRange], dimensions:[{name:'pagePath'}], metrics:[{name:'screenPageViews'},{name:'userEngagementDuration'},{name:'totalUsers'}], orderBys:[{metric:{metricName:'screenPageViews'},desc:true}], limit:10 }),
    runReport({ dateRanges:[dateRange], dimensions:[{name:'eventName'}], metrics:[{name:'eventCount'}], orderBys:[{metric:{metricName:'eventCount'},desc:true}], limit:12 }),
    runReport({ dateRanges:[dateRange], dimensions:[{name:'landingPage'}], metrics:[{name:'sessions'},{name:'totalUsers'},{name:'bounceRate'}], orderBys:[{metric:{metricName:'sessions'},desc:true}], limit:8 }),
    runReport({ dateRanges:[dateRange], dimensions:[{name:'date'},{name:'sessionDefaultChannelGrouping'}], metrics:[{name:'sessions'}], orderBys:[{dimension:{dimensionName:'date'}}] }),
    runReport({ dateRanges:[dateRange], dimensions:[{name:'newVsReturning'}], metrics:[{name:'totalUsers'},{name:'sessions'},{name:'engagementRate'}] }),
    runReport({ dateRanges:[dateRange], dimensions:[{name:'date'}], metrics:[{name:'engagementRate'},{name:'averageSessionDuration'}], orderBys:[{dimension:{dimensionName:'date'}}] }),
    runRealtimeReport({ dimensions:[{name:'country'},{name:'unifiedScreenName'}], metrics:[{name:'activeUsers'}] }),
  ]);

  return { overview, overviewPrev, sessionsByDay, sources, devices, countries, browsers, topPages, events, landingPages, channelsByDay, newReturning, engagementByDay, rt };
}

// ── HTTP Server ──
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // OAuth callback
  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    if (!code) { res.writeHead(400); res.end('Missing code'); return; }
    try {
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);
      fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;background:#07070D;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px;">
        <div style="font-size:48px;">&#x2705;</div>
        <div style="font-size:24px;font-weight:700;">Connected!</div>
        <div style="color:#8A8A9A;">Closing in 3 seconds&hellip;</div>
        <script>setTimeout(()=>window.close(),3000)</script>
      </body></html>`);
      console.log('✅ Authentication successful! Tokens saved.');
    } catch(e) {
      console.error('Auth error:', e.message);
      res.writeHead(500); res.end('Auth failed: ' + e.message);
    }
    return;
  }

  // Analytics data API
  if (url.pathname === '/api/data') {
    if (!oauth2Client.credentials?.access_token && !oauth2Client.credentials?.refresh_token) {
      res.writeHead(401, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ error: 'not_authenticated' }));
      return;
    }
    const range = url.searchParams.get('range') || '30daysAgo';
    try {
      const data = await fetchAllData(range);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(data));
    } catch(e) {
      console.error('Data fetch error:', e.message);
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Auth check
  if (url.pathname === '/api/auth-status') {
    const authed = !!(oauth2Client.credentials?.access_token || oauth2Client.credentials?.refresh_token);
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ authenticated: authed }));
    return;
  }

  // Auth URL
  if (url.pathname === '/api/auth-url') {
    const authUrl = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ url: authUrl }));
    return;
  }

  // Serve dashboard
  if (url.pathname === '/' || url.pathname === '/dashboard') {
    const file = path.join(__dirname, 'dashboard.html');
    res.writeHead(200, {'Content-Type':'text/html'});
    res.end(fs.readFileSync(file));
    return;
  }

  // Serve static files (images, etc.)
  const filePath = path.join(__dirname, url.pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const types = {'.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.js':'application/javascript','.css':'text/css'};
    res.writeHead(200, {'Content-Type': types[ext] || 'application/octet-stream'});
    res.end(fs.readFileSync(filePath));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, async () => {
  console.log(`\n🚀 HyperImplement Analytics Server running at http://localhost:${PORT}\n`);

  const authed = !!(oauth2Client.credentials?.access_token || oauth2Client.credentials?.refresh_token);
  if (!authed) {
    const authUrl = oauth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
    console.log('🔐 First-time setup — opening Google sign-in...\n');
    console.log('   If browser doesn\'t open, go to:\n  ', authUrl, '\n');
    // Auto-open browser
    const { default: open } = await import('open');
    await open(authUrl);
  } else {
    console.log('✅ Already authenticated — opening dashboard...\n');
    const { default: open } = await import('open');
    await open(`http://localhost:${PORT}`);
  }
});
