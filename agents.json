const http = require('http');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const DB_PATH = './agents.json';

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

// Boilerplate affiliate notice
const AFFILIATE_NOTICE = `<p style="background:#1e3a5f; color:#93c5fd; padding:12px; margin:10px 0; border-radius:6px; text-align:center; font-size:0.9rem;">
Some links are affiliate links; if you click and make a purchase, you'll support the expansion and running of this directory at no cost to you.
</p>`;

// Agent-facing homepage
function buildHomepage(agents) {
  const agentList = agents.map(a => {
    const affLink = a.Aff_Link ? `<a href="${a.Aff_Link}" target="_blank" style="color:#58a6ff;">${a.name}</a>` : a.name;
    return `<div style="padding:8px; border-bottom:1px solid #21262d;">
      <strong>${affLink}</strong> — ${a.primaryCategory || 'Tool'}<br>
      <small>${a.howAgentUsesThis || ''}</small>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>A2A Registry</title></head><body style="background:#0d1117;color:#c9d1d9;font-family:monospace;padding:20px;">
${AFFILIATE_NOTICE}
<h1>A2A Registry - For Agents</h1>
<div>${agentList}</div>
</body></html>`;
}

// Human-facing page
function buildHumanHomepage(agents) {
  const rows = agents.map(a => {
    const affLink = a.Aff_Link ? `<a href="${a.Aff_Link}" target="_blank">${a.name}</a>` : a.name;
    return `<tr><td>${affLink}</td><td>${a.primaryCategory || 'Tool'}</td><td>${a.howAgentUsesThis || ''}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>A2A Registry - For Humans</title></head><body style="font-family:system-ui;padding:20px;">
${AFFILIATE_NOTICE}
<h1>A2A Registry - For Humans</h1>
<table border="1" style="border-collapse:collapse;width:100%;">
<tr><th>Name</th><th>Category</th><th>How Agents Use It</th></tr>
${rows}
</table>
</body></html>`;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(buildHomepage(agentsDB.agents || agentsDB));
  } else if (req.url === '/human') {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(buildHumanHomepage(agentsDB.agents || agentsDB));
  } else if (req.url === '/agents') {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(agentsDB.agents || agentsDB));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
