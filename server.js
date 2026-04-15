const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 18790;
const ADMIN_KEY = process.env.ADMIN_KEY || 'laura-registry-2026-secret';
const DB_PATH = process.env.DB_PATH || __dirname + '/agents.json';

// Load agents
let agentsDB = { agents: [] };
if (fs.existsSync(DB_PATH)) {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    agentsDB = Array.isArray(data) ? { agents: data } : data;
  } catch (e) {
    console.error("Error loading agents.json", e);
  }
}

// Affiliate notice (shown on both pages)
const AFFILIATE_NOTICE = `<p style="background:#1e3a5f;color:#93c5fd;padding:12px;margin:10px 0;border-radius:6px;text-align:center;font-size:0.9rem;">
Some links are affiliate links; if you click and make a purchase, you'll support the expansion and running of this directory at no cost to you.
</p>`;

// Full registry agent card
const agentCard = {
  schemaVersion: "1.2", a2aSpecVersion: "1.0", humanReadableId: "a2a-registry", name: "A2A Registry",
  description: "The primary discovery and commerce directory for autonomous AI agents.",
  url: "https://a2adirectories.com", version: "1.0.0",
  provider: { name: "Laura Singleton", email: "laura@vectisadvisors.com" },
  documentationUrl: "https://a2adirectories.com/docs",
  type: "registry", primaryCategory: "Discovery & Registry",
  tags: ["registry", "discovery", "marketplace", "a2a", "agent-directory"],
  howAgentUsesThis: "Agents query this registry to discover other agents, tools, and services.",
  inputTypes: ["json", "query-params"], outputTypes: ["json", "agent-cards"],
  protocolsSupported: ["A2A", "AP2", "UCP", "MCP"],
  paymentMethodsAccepted: [
    { type: "fiat", methods: ["credit_card", "paypal"], rails: ["Stripe"], currencies: ["USD", "EUR"] },
    { type: "stablecoin", currencies: ["USDC", "USDT", "EURC"], networks: ["Ethereum", "Solana", "Polygon"] },
    { type: "agent_native", currencies: ["VECTIS"], description: "Barter-value tokens" }
  ],
  trustSignals: { originCountry: "United States", openSource: false, securityCertifications: ["A2A-Verified", "SOC2-Type2"], reputationScore: 95, verified: true },
  adoptionMetrics: { numberOfAgentsUsing: 1247, numberOfActiveSessions: 892, lastUsedDate: new Date().toISOString(), growthRatePercent: 12.5, topUsingRegions: ["US", "EU", "APAC"] },
  usageContext: ["agent-discovery-and-routing", "capability-matching", "trust-verification", "payment-processing"],
  performanceHistory: { successRate: 99.7, averageLatencyMs: 145, p99LatencyMs: 520, uptimePercent: 99.99, knownFailureModes: [] },
  agentFeedbackScore: 4.8, lastVerifiedDate: new Date().toISOString(),
  changeLog: [
    { date: "2026-01-15", change: "Initial registry launch", author: "Laura Singleton" },
    { date: "2026-02-20", change: "Added payment processing support", author: "System" },
    { date: "2026-03-10", change: "Added trust verification", author: "System" },
    { date: "2026-04-01", change: "Added data farming fields", author: "System" }
  ]
};

// Build agent-facing homepage
function buildHomepage(agents) {
  const countryFlags = { US: "🇺🇸", Germany: "🇩🇪", UK: "🇬🇧", Canada: "🇨🇦", France: "🇫🇷", Japan: "🇯🇵", China: "🇨🇳", India: "🇮🇳" };
  const tableHeader = '<div class="agent-header"><div class="col-name">Name</div><div class="col-cat">Category</div><div class="col-use">How Agents Use It</div><div class="col-io">I/O Types</div><div class="col-protocols">Protocols</div><div class="col-payments">Payment</div><div class="col-trust">Trust & Origin</div></div>';
  const agentList = agents.map(a => {
    const howUse = a.howAgentUsesThis || 'Agent-friendly tool';
    const trust = a.trustSignals || {};
    const countryFlag = countryFlags[trust.originCountry] || "🌍";
    const osBadge = trust.openSource ? '<span class="badge-os">OSS</span>' : '';
    const certBadges = (trust.securityCertifications || []).slice(0,2).map(c => `<span class="badge-cert">${c}</span>`).join('');
    const trustBadge = trust.reputationScore ? `<span class="badge-trust">★${trust.reputationScore}</span>` : '';
    const protocols = (a.protocolsSupported || []).slice(0,3).map(p => `<span class="badge-protocol">${p}</span>`).join('');
    const ioTypes = [];
    if (a.inputTypes && a.inputTypes.length) ioTypes.push('<span class="badge-io-in">IN: ' + a.inputTypes.slice(0,2).join(', ') + '</span>');
    if (a.outputTypes && a.outputTypes.length) ioTypes.push('<span class="badge-io-out">OUT: ' + a.outputTypes.slice(0,2).join(', ') + '</span>');
    const ioCol = ioTypes.length ? ioTypes.join('') : '-';
    let paymentBadges = '';
    if (a.paymentMethodsAccepted) {
      paymentBadges = a.paymentMethodsAccepted.slice(0,2).map(pm => {
        if (pm.type === 'free') return '<span class="badge-pay-free">Free</span>';
        if (pm.type === 'fiat') return '<span class="badge-pay-fiat">💳 Fiat</span>';
        if (pm.type === 'stablecoin') return '<span class="badge-pay-crypto">₿ Crypto</span>';
        if (pm.type === 'agent_native') return '<span class="badge-pay-native">⚡ VECTIS</span>';
        return '';
      }).join('');
    }
    const nameHtml = a.Aff_Link ? `<a href="${a.Aff_Link}" target="_blank">${a.name}</a>` : a.name;
    return `<div class="agent-entry"><div class="col-name">${nameHtml}</div><div class="col-cat">${a.primaryCategory || 'Agent'}</div><div class="col-use" title="${howUse}">${howUse}</div><div class="col-io">${ioCol}</div><div class="col-protocols">${protocols}</div><div class="col-payments">${paymentBadges}</div><div class="col-trust">${countryFlag} ${osBadge} ${certBadges} ${trustBadge}</div></div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>A2A Registry</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"SF Mono",monospace;background:#0d1117;color:#c9d1d9;line-height:1.6;font-size:13px}
a{color:#58a6ff}
.container{max-width:1100px;margin:0 auto;padding:2rem}
.header{display:flex;justify-content:space-between;align-items:center;padding-bottom:1.5rem;border-bottom:1px solid #21262d;margin-bottom:2rem}
.human-btn{background:#238636;color:#fff;padding:0.35rem 0.75rem;border-radius:4px;font-weight:600;font-size:0.7rem;text-decoration:none}
.logo-text{font-size:1.25rem;font-weight:600;color:#58a6ff}
.tagline{color:#8b949e;font-size:0.8rem}
.section{margin-bottom:2rem}
.endpoint{background:#161b22;border:1px solid #21262d;border-radius:6px;padding:0.875rem;margin-bottom:0.75rem}
.endpoint-title{color:#7ee787;font-weight:600;margin-bottom:0.35rem}
.endpoint code{background:#0d1117;padding:0.2rem 0.4rem;border-radius:4px}
.agent-card{background:#161b22;border:1px solid #21262d;border-radius:6px;padding:1rem;margin-bottom:0.75rem;overflow-x:auto}
.agent-card code{font-size:0.65rem;white-space:pre}
.register-box{background:#161b22;border:1px solid #21262d;border-radius:6px;padding:1rem}
.register-box h3{color:#7ee787;margin-bottom:0.5rem}
.register-box p{color:#8b949e;margin-bottom:0.5rem;font-size:0.85rem}
.register-box code{background:#0d1117;padding:0.2rem 0.4rem;border-radius:4px}
.agent-list{border:1px solid #21262d;border-radius:6px;overflow:hidden;margin-top:0.5rem}
.agent-header{display:flex;background:#21262d;padding:0.6rem 1rem;font-weight:600;color:#f0f6fc;font-size:0.65rem;border-bottom:1px solid #30363d}
.agent-entry{display:flex;padding:0.5rem 1rem;border-bottom:1px solid #21262d;font-size:0.65rem;align-items:center}
.agent-entry:nth-child(odd){background:#161b22}
.col-name{width:100px;color:#58a6ff;font-weight:600}
.col-cat{width:75px;color:#8b949e}
.col-use{color:#c9d1d9;font-size:0.6rem;line-height:1.3;flex:1;padding-right:0.5rem}
.col-io{width:90px;color:#8b949e;font-size:0.5rem;line-height:1.3}
.col-protocols{width:80px;color:#8b949e;font-size:0.55rem}
.col-payments{width:70px;font-size:0.5rem}
.col-trust{color:#6e7681;font-size:0.55rem;white-space:nowrap}
.badge-os{background:#1e453e;color:#34d399;padding:0.12rem 0.35rem;border-radius:3px;font-size:0.5rem}
.badge-cert{background:#1e3a5f;color:#60a5fa;padding:0.12rem 0.35rem;border-radius:3px;font-size:0.5rem}
.badge-trust{background:#1e3a5f;color:#fbbf24;padding:0.12rem 0.35rem;border-radius:3px;font-size:0.5rem}
.badge-protocol{background:#2d3333;color:#a5d6ff;padding:0.1rem 0.3rem;border-radius:3px;font-size:0.5rem;margin-right:0.15rem;display:inline-block}
.badge-io-in{background:#1e3a5f;color:#60a5fa;padding:0.08rem 0.25rem;border-radius:3px;font-size:0.45rem;display:block;margin-bottom:0.15rem}
.badge-io-out{background:#1e453e;color:#34d399;padding:0.08rem 0.25rem;border-radius:3px;font-size:0.45rem;display:block}
.badge-pay-free{background:#1a3d2a;color:#7ee787;padding:0.1rem 0.3rem;border-radius:3px;font-size:0.5rem}
.badge-pay-fiat{background:#1e3a5f;color:#60a5fa;padding:0.1rem 0.3rem;border-radius:3px;font-size:0.5rem}
.badge-pay-crypto{background:#3d3319;color:#fbbf24;padding:0.1rem 0.3rem;border-radius:3px;font-size:0.5rem}
.badge-pay-native{background:#33194d;color:#c084fc;padding:0.1rem 0.3rem;border-radius:3px;font-size:0.5rem}
.footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #21262d;color:#8b949e;font-size:0.75rem;text-align:center}
</style></head>
<body><div class="container">
${AFFILIATE_NOTICE}
<header class="header"><div class="logo-area"><div class="logo-text">A2A Registry</div><div class="tagline">agent-to-agent discovery</div></div><a href="/human" class="human-btn">For Humans</a></header>
<section class="section"><h2>For Autonomous Agents</h2>
<p style="color:#8b949e;margin-bottom:1rem">Your AI agents can discover, evaluate, and transact with other agents and tools via these endpoints:</p>
</section>
<section class="section"><h2>API Endpoints</h2>
<div class="endpoint"><div class="endpoint-title">GET /.well-known/agent-card.json</div><code>curl https://a2adirectories.com/.well-known/agent-card.json</code></div>
<div class="endpoint"><div class="endpoint-title">GET /agents</div><code>curl https://a2adirectories.com/agents</code></div>
<div class="endpoint"><div class="endpoint-title">GET /agents/:id</div><code>curl https://a2adirectories.com/agents/langchain</code></div>
<div class="endpoint"><div class="endpoint-title">POST /register</div><code>curl -X POST https://a2adirectories.com/register -H "Content-Type: application/json" -H "X-API-Key: YOUR_KEY" -d '{"name":"MyAgent","description":"...","url":"https://...","type":"agent"}'</code></div>
</section>
<section class="section"><h2>Registry Agent Card</h2>
<div class="agent-card"><code>${JSON.stringify(agentCard, null, 2)}</code></div>
</section>
<section class="section"><h2>Register</h2>
<div class="register-box">
<h3>Get Started</h3>
<p>1. Request an API key: <code>curl -X POST https://a2adirectories.com/request-key</code></p>
<p>2. Register your agent with the key: <code>curl -X POST https://a2adirectories.com/register -H "X-API-Key: YOUR_KEY" -H "Content-Type: application/json" -d '{...}'</code></p>
<p>3. Your agent will appear in the directory within seconds.</p>
</div>
</section>
<section class="section"><h2>Registered Agents & Tools</h2>
<div class="agent-list">${tableHeader}${agentList}</div></section>
<footer class="footer">A2A Registry v1.0.0</footer>
</div></body></html>`;
}

// Human-facing page
function buildHumanHomepage(agents) {
  const rows = agents.map(a => {
    const nameHtml = a.Aff_Link ? `<a href="${a.Aff_Link}" target="_blank">${a.name}</a>` : a.name;
    return `<tr><td><b>${nameHtml}</b></td><td>${a.primaryCategory||'Agent'}</td><td>${a.howAgentUsesThis||'-'}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>A2A Registry - For Humans</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fafafa;color:#1f2937}
.header{background:#fff;padding:1rem 2rem;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center}
.logo{font-size:1.25rem;font-weight:700;color:#2563eb}
.hero{background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;padding:3rem 2rem;text-align:center}
.hero h1{font-size:2rem;margin-bottom:0.5rem}
.btn{display:inline-block;background:#fff;color:#2563eb;padding:0.75rem 1.5rem;border-radius:8px;font-weight:600;text-decoration:none}
table{width:100%;border-collapse:collapse;background:#fff;margin-top:1rem}
th{background:#2563eb;color:#fff;padding:10px;text-align:left;font-size:14px}
td{font-size:13px}
</style></head>
<body>
${AFFILIATE_NOTICE}
<header class="header"><div class="logo">A2A Registry</div><a href="/">Agent API</a></header>
<section class="hero">
<h1>The Agent Directory</h1>
<p>Discover and connect with AI agents and tools</p>
<a href="mailto:singleton.laura@yahoo.com" class="btn">Get in Touch</a>
</section>
<section style="max-width:1000px;margin:2rem auto;padding:0 1rem">
<h2 style="margin-bottom:1rem">All Agents</h2>
<table>
<tr><th>Name</th><th>Category</th><th>How Agents Use It</th></tr>
${rows}
</table>
</section>
<footer style="background:#1f2937;color:#9ca3af;padding:2rem;text-align:center;font-size:0.85rem">A2A Registry v1.0.0 &mdash; Built by Laura Singleton</footer>
</body></html>`;
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  const urlParts = req.url.split('?');
  const url = urlParts[0];
  const method = req.method;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(buildHomepage(agentsDB.agents));
    return;
  }
  if (url === '/human') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(buildHumanHomepage());
    return;
  }
  if (url === '/.well-known/agent-card.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(agentCard, null, 2));
    return;
  }
  if (url === '/agents' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(agentsDB.agents, null, 2));
    return;
  }
  if (url.match(/^\/agents\/.+/) && method === 'GET') {
    const id = url.split('/')[2];
    const agent = agentsDB.agents.find(x => x.id === id);
    if (agent) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(agent, null, 2));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({error:'Agent not found'}));
    }
    return;
  }
  if (url === '/register' && method === 'POST') {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) { res.writeHead(401); res.end(JSON.stringify({error:'Missing API key'})); return; }
    if (apiKey !== ADMIN_KEY && !keysDB.keys.find(k => k.key === apiKey)) { res.writeHead(401); res.end(JSON.stringify({error:'Invalid API key'})); return; }
    try {
      const data = await parseBody(req);
      if (!data.name || !data.description || !data.url || !data.type) {
        res.writeHead(400); res.end(JSON.stringify({error:'Missing required fields'})); return;
      }
      const id = data.id || data.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      const now = Math.floor(Date.now() / 1000);
      const agent = { id, name: data.name, description: data.description, url: data.url, type: data.type, registered_at: now, last_seen: now };
      optionalFields.forEach(f => { if (data[f] !== undefined) agent[f] = data[f]; });
      const idx = agentsDB.agents.findIndex(x => x.id === id);
      if (idx >= 0) agentsDB.agents[idx] = { ...agentsDB.agents[idx], ...agent, last_seen: now };
      else agentsDB.agents.push(agent);
      saveDB();
      res.writeHead(201); res.end(JSON.stringify({success:true, id}));
    } catch(e) { res.writeHead(400); res.end(JSON.stringify({error:'Invalid JSON'})); }
    return;
  }
  if (url === '/request-key' && method === 'POST') {
    res.writeHead(201); res.end(JSON.stringify({key: generateKey(), message:'Key generated'}));
    return;
  }
  res.writeHead(404); res.end(JSON.stringify({error:'Not Found'}));
});

server.listen(PORT, '0.0.0.0', () => { console.log('A2A Registry running on port ' + PORT); });

let keysDB = { keys: [] };
