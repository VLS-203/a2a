'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR      = path.join(__dirname, 'wardrobe-data');
const UPLOADS_DIR   = path.join(DATA_DIR, 'uploads');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

// ── Storage ─────────────────────────────────────────────────────────────────

function ensureDirs() {
  [DATA_DIR, UPLOADS_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
  if (!fs.existsSync(PROFILES_FILE))
    fs.writeFileSync(PROFILES_FILE, '{"profiles":{}}');
}

function loadDB() {
  try { return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')); }
  catch(e) { return { profiles: {} }; }
}

function saveDB(data) {
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(data, null, 2));
}

function saveImage(b64, mime) {
  const ext = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg';
  const filename = crypto.randomUUID() + ext;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), Buffer.from(b64, 'base64'));
  return filename;
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 52428800) reject(new Error('Too large')); });
    req.on('end',  () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
    req.on('error', reject);
  });
}

// ── Anthropic client ─────────────────────────────────────────────────────────

function getClient() {
  const Anthropic = require('@anthropic-ai/sdk');
  const opts = { apiKey: process.env.ANTHROPIC_API_KEY };
  try {
    if (process.env.HTTPS_PROXY) {
      const { HttpsProxyAgent } = require('https-proxy-agent');
      opts.httpAgent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
    }
  } catch(_) {}
  return new Anthropic(opts);
}

// ── Claude calls ─────────────────────────────────────────────────────────────

async function analyzeItem(b64, mime) {
  if (!process.env.ANTHROPIC_API_KEY)
    return { category:'unknown', subcategory:'Item', colors:['unknown'], pattern:'solid',
             styleAesthetic:'casual', formalityLevel:3, seasons:['spring','summer','autumn','winter'],
             versatilityScore:3, description:'Add ANTHROPIC_API_KEY to enable AI analysis.', colorFamily:'neutral', _mock:true };

  const client = getClient();
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: [
        { type:'image', source:{ type:'base64', media_type:mime, data:b64 } },
        { type:'text',  text: [
          'Analyze this clothing or accessory item.',
          'Return ONLY valid JSON with no markdown or explanation:',
          '{"category":"top|bottom|dress|outerwear|shoes|bag|jewelry|accessory|other",',
          '"subcategory":"e.g. silk midi dress",',
          '"colors":["primary color","secondary if present"],',
          '"pattern":"solid|stripes|floral|plaid|geometric|animal print|abstract|other",',
          '"fabric":"e.g. linen or unknown",',
          '"styleAesthetic":"casual|business|formal|athletic|bohemian|minimalist|romantic|edgy|classic",',
          '"formalityLevel":3,',
          '"seasons":["spring","summer"],',
          '"versatilityScore":3,',
          '"description":"one sentence",',
          '"colorFamily":"neutral|warm|cool|earth|bright|pastel"}'
        ].join(' ') }
      ]
    }]
  });

  try {
    const t = msg.content[0].text.trim();
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    return s >= 0 ? JSON.parse(t.slice(s, e+1)) : { description: t, category:'unknown' };
  } catch(_) {
    return { category:'unknown', description: msg.content[0].text.slice(0,120) };
  }
}

async function runWardrobeAnalysis(profile, items) {
  if (!process.env.ANTHROPIC_API_KEY)
    return { error:'no_api_key', capsuleScore:0,
             summary:'Add your ANTHROPIC_API_KEY environment variable to enable wardrobe analysis.',
             strengths:[], coreItems:[], reconsiderItems:[], gaps:[], outfits:[], stylingTips:[], colorPalette:{bestColors:[],avoidColors:[],neutrals:[]} };

  const client = getClient();
  const list = items.length
    ? items.map((it,i) => {
        const a = it.analysis || {};
        return `${i+1}. ${a.subcategory||a.category||'Item'} – ${(a.colors||[]).join('/')||'unknown'}, ${a.pattern||'solid'}, ${a.styleAesthetic||'versatile'} (versatility ${a.versatilityScore||3}/5, formality ${a.formalityLevel||3}/5)`;
      }).join('\n')
    : 'No items uploaded yet.';

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role:'user',
      content: `You are an expert capsule wardrobe stylist and personal shopper. Provide a detailed, warm, and practical wardrobe analysis.

CLIENT PROFILE
Name: ${profile.name||'Client'}
Color Season: ${profile.coloring?.season||'unknown'}
Skin Tone: ${profile.coloring?.skinTone||''}
Body Shape: ${profile.bodyShape||'unknown'}
Style Goals: ${(profile.styleGoals||[]).join(', ')||'classic, versatile'}
Occasions Needed: ${(profile.occasions||[]).join(', ')||'everyday, work, social'}
Budget: ${profile.preferences?.budget||'medium'}
Favourite Colours: ${(profile.preferences?.favoriteColors||[]).join(', ')||'none specified'}
Colours to Avoid: ${(profile.preferences?.avoidColors||[]).join(', ')||'none'}

CURRENT WARDROBE (${items.length} piece${items.length!==1?'s':''})
${list}

Return ONLY valid JSON (no markdown, no trailing commas):
{
  "capsuleScore": 65,
  "summary": "2-3 warm sentences summarising the wardrobe",
  "strengths": ["specific strength 1", "specific strength 2"],
  "coreItems": [{"index":1,"reason":"why this is a capsule cornerstone"}],
  "reconsiderItems": [{"index":2,"reason":"why this may not serve the profile well"}],
  "gaps": [
    {"priority":1,"item":"white linen button-down","category":"top","why":"creates 8+ outfit combinations with existing pieces","colorSuggestion":"crisp white or ivory","estimatedCost":"$35–$80","whereToShop":"Quince, Everlane, Madewell"}
  ],
  "outfits": [
    {"name":"Effortless Monday","occasion":"work/everyday","itemIndices":[1,3],"description":"Tuck the blouse into the wide-leg trousers for a polished silhouette","tip":"Add a thin gold belt to define the waist"}
  ],
  "stylingTips": [
    "body-shape-specific tip",
    "color-season-specific tip",
    "capsule building tip"
  ],
  "colorPalette": {
    "bestColors": ["color1","color2","color3","color4","color5"],
    "avoidColors": ["color1","color2"],
    "neutrals": ["color1","color2","color3"]
  }
}`
    }]
  });

  try {
    const t = resp.content[0].text.trim();
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    return s >= 0 ? JSON.parse(t.slice(s, e+1)) : { error:'parse_error', capsuleScore:0, summary:t.slice(0,300) };
  } catch(err) {
    return { error:'parse_error', capsuleScore:0, summary: resp.content[0].text.slice(0,300) };
  }
}

// ── SPA HTML ─────────────────────────────────────────────────────────────────

function buildPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Capsule Wardrobe AI</title>
<style>
:root {
  --bg:      #faf8f5;
  --card:    #ffffff;
  --pri:     #b5836b;
  --pri-dk:  #8f5e48;
  --pri-lt:  #f5ece7;
  --sage:    #7a9e7e;
  --sage-lt: #e8f2e9;
  --txt:     #2c1f18;
  --muted:   #7a6358;
  --border:  #e8ddd8;
  --sh:      0 2px 16px rgba(44,31,24,.09);
  --r:       14px;
  --r-sm:    8px;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--txt);line-height:1.6}
a{color:var(--pri)}
img{max-width:100%}
.hidden{display:none!important}

/* Nav */
nav{background:var(--card);border-bottom:1px solid var(--border);padding:.75rem 1.5rem;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.nav-logo{font-size:1.1rem;font-weight:700;color:var(--pri);letter-spacing:-.02em}
.nav-logo span{color:var(--txt)}
.nav-links{display:flex;gap:1rem;font-size:.85rem}
.nav-links button{background:none;border:none;cursor:pointer;color:var(--muted);padding:.25rem .5rem;border-radius:var(--r-sm)}
.nav-links button:hover{color:var(--pri)}

/* Buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;padding:.65rem 1.4rem;border-radius:50px;font-size:.9rem;font-weight:600;cursor:pointer;border:none;transition:.15s}
.btn-primary{background:var(--pri);color:#fff}
.btn-primary:hover{background:var(--pri-dk)}
.btn-outline{background:transparent;border:1.5px solid var(--pri);color:var(--pri)}
.btn-outline:hover{background:var(--pri-lt)}
.btn-ghost{background:transparent;border:none;color:var(--muted);font-size:.85rem;cursor:pointer;padding:.4rem .8rem}
.btn-ghost:hover{color:var(--pri)}
.btn-sm{padding:.4rem .9rem;font-size:.8rem}
.btn:disabled{opacity:.5;cursor:not-allowed}

/* Sections */
section{min-height:calc(100vh - 57px);padding:2rem 1rem}
.container{max-width:860px;margin:0 auto}

/* Landing */
#s-landing{background:linear-gradient(165deg,#fdf6f1 0%,#f5ebe4 40%,#edf4ee 100%);display:flex;align-items:center;justify-content:center;text-align:center;padding:3rem 1rem}
.hero-badge{display:inline-block;background:var(--pri-lt);color:var(--pri);font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:.3rem .9rem;border-radius:50px;margin-bottom:1.25rem}
.hero h1{font-size:clamp(1.75rem,5vw,3rem);font-weight:800;line-height:1.15;margin-bottom:1rem;letter-spacing:-.03em}
.hero h1 em{color:var(--pri);font-style:normal}
.hero p{font-size:1.05rem;color:var(--muted);max-width:500px;margin:0 auto 2rem}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1.25rem;margin-top:3.5rem;text-align:left}
.feature{background:rgba(255,255,255,.7);border:1px solid var(--border);border-radius:var(--r);padding:1.25rem}
.feature-icon{font-size:1.5rem;margin-bottom:.75rem}
.feature h3{font-size:.95rem;font-weight:700;margin-bottom:.35rem}
.feature p{font-size:.82rem;color:var(--muted)}

/* Wizard */
#s-profile{padding:2rem 1rem}
.wizard-header{text-align:center;margin-bottom:2rem}
.wizard-header h2{font-size:1.6rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.3rem}
.wizard-header p{color:var(--muted);font-size:.9rem}
.progress-bar{display:flex;align-items:center;justify-content:center;gap:0;margin-bottom:2.5rem}
.prog-step{width:32px;height:32px;border-radius:50%;border:2px solid var(--border);background:var(--card);color:var(--muted);font-size:.8rem;font-weight:700;display:flex;align-items:center;justify-content:center;transition:.3s;flex-shrink:0}
.prog-step.active{border-color:var(--pri);background:var(--pri);color:#fff}
.prog-step.done{border-color:var(--sage);background:var(--sage);color:#fff}
.prog-line{height:2px;width:48px;background:var(--border);transition:.3s}
.prog-line.done{background:var(--sage)}
.wizard-step{display:none}
.wizard-step.active{display:block}

/* Cards / selectors */
.card{background:var(--card);border:1.5px solid var(--border);border-radius:var(--r);padding:1.5rem;margin-bottom:1rem}
.card.selected{border-color:var(--pri);background:var(--pri-lt)}
.grid-2{display:grid;grid-template-columns:repeat(2,1fr);gap:.75rem}
.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem}
.grid-auto{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.75rem}

/* Season cards */
.season-card{border:1.5px solid var(--border);border-radius:var(--r);padding:1rem;cursor:pointer;transition:.2s;background:var(--card)}
.season-card:hover{border-color:var(--pri)}
.season-card.selected{border-color:var(--pri);box-shadow:0 0 0 3px var(--pri-lt)}
.season-swatches{display:flex;gap:4px;margin-bottom:.6rem}
.swatch{width:20px;height:20px;border-radius:50%;flex-shrink:0}
.season-name{font-weight:700;font-size:.9rem;margin-bottom:.2rem}
.season-desc{font-size:.75rem;color:var(--muted)}

/* Body shape cards */
.shape-card{border:1.5px solid var(--border);border-radius:var(--r);padding:1rem;cursor:pointer;transition:.2s;background:var(--card);text-align:center}
.shape-card:hover{border-color:var(--pri)}
.shape-card.selected{border-color:var(--pri);box-shadow:0 0 0 3px var(--pri-lt)}
.shape-fig{width:42px;height:70px;background:var(--pri-lt);border:2px solid var(--pri);margin:0 auto .6rem;border-radius:3px}
.shape-card.selected .shape-fig{background:var(--pri)}
.s-hour{clip-path:polygon(15% 0%,85% 0%,100% 32%,78% 50%,100% 68%,85% 100%,15% 100%,0% 68%,22% 50%,0% 32%)}
.s-pear{clip-path:polygon(28% 0%,72% 0%,78% 42%,100% 100%,0% 100%,22% 42%)}
.s-apple{clip-path:polygon(22% 0%,78% 0%,100% 48%,92% 100%,8% 100%,0% 48%)}
.s-rect{clip-path:polygon(22% 0%,78% 0%,78% 100%,22% 100%)}
.s-inv{clip-path:polygon(0% 0%,100% 0%,80% 100%,20% 100%)}
.shape-name{font-weight:700;font-size:.85rem;margin-bottom:.2rem}
.shape-desc{font-size:.72rem;color:var(--muted);line-height:1.3}

/* Style tag pills */
.style-tags{display:flex;flex-wrap:wrap;gap:.5rem}
.style-tag{padding:.4rem .9rem;border-radius:50px;border:1.5px solid var(--border);font-size:.82rem;cursor:pointer;transition:.15s;background:var(--card);font-weight:500}
.style-tag:hover{border-color:var(--pri);color:var(--pri)}
.style-tag.selected{background:var(--pri);border-color:var(--pri);color:#fff}

/* Form fields */
.field-group{margin-bottom:1.25rem}
.field-group label{display:block;font-size:.82rem;font-weight:600;color:var(--muted);margin-bottom:.35rem;text-transform:uppercase;letter-spacing:.04em}
.field-group input,.field-group select{width:100%;padding:.7rem .9rem;border:1.5px solid var(--border);border-radius:var(--r-sm);font-size:.9rem;background:var(--card);color:var(--txt);transition:.15s}
.field-group input:focus,.field-group select:focus{outline:none;border-color:var(--pri)}
.meas-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.75rem}
.color-chips{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.4rem}
.color-chip{width:24px;height:24px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:.15s}
.color-chip.selected{border-color:var(--txt);transform:scale(1.2)}
.color-chip-label{display:none}

/* Wizard nav buttons */
.wizard-nav{display:flex;justify-content:space-between;align-items:center;margin-top:1.75rem;padding-top:1.25rem;border-top:1px solid var(--border)}
.step-info{font-size:.8rem;color:var(--muted)}

/* Upload section */
#s-upload{padding:2rem 1rem}
.upload-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:.75rem}
.upload-header h2{font-size:1.5rem;font-weight:800;letter-spacing:-.02em}
.dropzone{border:2.5px dashed var(--border);border-radius:var(--r);padding:2.5rem 1.5rem;text-align:center;cursor:pointer;transition:.2s;background:var(--card);margin-bottom:1.5rem}
.dropzone:hover,.dropzone.over{border-color:var(--pri);background:var(--pri-lt)}
.dropzone-icon{font-size:2rem;margin-bottom:.5rem}
.dropzone p{font-size:.9rem;color:var(--muted)}
.dropzone em{font-style:normal;color:var(--pri);font-weight:600}
#file-input{display:none}
.category-bar{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1.25rem;align-items:center}
.category-bar span{font-size:.8rem;font-weight:600;color:var(--muted);margin-right:.25rem}
.cat-btn{padding:.35rem .8rem;border-radius:50px;border:1.5px solid var(--border);font-size:.78rem;cursor:pointer;background:var(--card);transition:.15s;font-weight:500}
.cat-btn:hover{border-color:var(--pri);color:var(--pri)}
.cat-btn.active{background:var(--pri);border-color:var(--pri);color:#fff}

/* Item grid */
.items-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.75rem;margin-bottom:1.5rem}
.item-card{background:var(--card);border:1.5px solid var(--border);border-radius:var(--r);overflow:hidden;position:relative;transition:.2s}
.item-card:hover{border-color:var(--pri)}
.item-img{width:100%;aspect-ratio:1;object-fit:cover;display:block;background:#f5f0ed}
.item-img-placeholder{width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:2rem;background:#f5f0ed}
.item-body{padding:.6rem .7rem}
.item-cat-badge{display:inline-block;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;background:var(--pri-lt);color:var(--pri);padding:.15rem .45rem;border-radius:50px;margin-bottom:.3rem}
.item-desc{font-size:.72rem;color:var(--muted);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.item-delete{position:absolute;top:.4rem;right:.4rem;background:rgba(255,255,255,.9);border:none;cursor:pointer;color:#c0392b;font-size:.9rem;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;opacity:0;transition:.2s;font-weight:700}
.item-card:hover .item-delete{opacity:1}
.item-analyzing{position:absolute;inset:0;background:rgba(255,255,255,.85);display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:.75rem;color:var(--muted)}
.spinner{width:20px;height:20px;border:2.5px solid var(--border);border-top-color:var(--pri);border-radius:50%;animation:spin .7s linear infinite;margin-bottom:.4rem}
@keyframes spin{to{transform:rotate(360deg)}}
.analyze-bar{background:var(--card);border:1.5px solid var(--border);border-radius:var(--r);padding:1.25rem 1.5rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.analyze-bar-info{font-size:.88rem;color:var(--muted)}
.analyze-bar-info strong{color:var(--txt)}
.empty-state{text-align:center;padding:3rem 1.5rem;color:var(--muted)}
.empty-state-icon{font-size:2.5rem;margin-bottom:.75rem}

/* Results */
#s-results{padding:2rem 1rem}
.results-top{display:flex;align-items:flex-start;gap:1.5rem;margin-bottom:1.75rem;flex-wrap:wrap}
.score-circle{width:100px;height:100px;border-radius:50%;background:conic-gradient(var(--pri) 0deg,var(--pri-lt) 0deg);display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;position:relative;font-size:.7rem;color:var(--muted);font-weight:600}
.score-num{font-size:1.6rem;font-weight:800;color:var(--txt);line-height:1}
.results-summary h2{font-size:1.5rem;font-weight:800;letter-spacing:-.02em;margin-bottom:.5rem}
.results-summary p{font-size:.9rem;color:var(--muted);line-height:1.55}

/* Tabs */
.tabs{display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:1.5rem}
.tab-btn{padding:.6rem 1.25rem;font-size:.88rem;font-weight:600;color:var(--muted);border:none;background:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:.15s}
.tab-btn.active{color:var(--pri);border-bottom-color:var(--pri)}
.tab-content{display:none}
.tab-content.active{display:block}

/* Gap cards */
.gap-card{background:var(--card);border:1.5px solid var(--border);border-radius:var(--r);padding:1.1rem 1.25rem;margin-bottom:.75rem;display:flex;gap:1rem;align-items:flex-start}
.gap-priority{width:28px;height:28px;border-radius:50%;background:var(--pri);color:#fff;font-size:.75rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:.15rem}
.gap-body h4{font-size:.9rem;font-weight:700;margin-bottom:.2rem}
.gap-body p{font-size:.8rem;color:var(--muted);margin-bottom:.4rem}
.gap-meta{display:flex;flex-wrap:wrap;gap:.4rem}
.gap-tag{font-size:.72rem;background:var(--pri-lt);color:var(--pri-dk);padding:.15rem .5rem;border-radius:50px;font-weight:600}
.gap-tag.cost{background:var(--sage-lt);color:#3d6b42}
.gap-tag.shop{background:#eef2f8;color:#2c4a8a}

/* Outfit boards */
.outfit-card{background:var(--card);border:1.5px solid var(--border);border-radius:var(--r);overflow:hidden;margin-bottom:1.25rem}
.outfit-card-header{padding:.85rem 1.1rem .6rem;display:flex;justify-content:space-between;align-items:baseline}
.outfit-card-header h4{font-size:.95rem;font-weight:700}
.outfit-occasion{font-size:.75rem;color:var(--muted)}
.outfit-board{display:flex;gap:6px;padding:.5rem .75rem;overflow-x:auto;min-height:110px}
.outfit-item-img{width:90px;height:90px;object-fit:cover;border-radius:var(--r-sm);flex-shrink:0;background:#f5f0ed;border:1px solid var(--border)}
.outfit-item-placeholder{width:90px;height:90px;border-radius:var(--r-sm);flex-shrink:0;background:var(--pri-lt);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:1.3rem}
.outfit-details{padding:.75rem 1.1rem 1rem}
.outfit-desc{font-size:.83rem;color:var(--muted);margin-bottom:.45rem}
.outfit-tip{font-size:.78rem;background:var(--sage-lt);color:#3d6b42;padding:.45rem .75rem;border-radius:var(--r-sm)}
.outfit-tip::before{content:"✦ Tip: "}

/* Color palette */
.palette-row{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem}
.palette-chip{display:flex;align-items:center;gap:.35rem;font-size:.75rem;font-weight:500;padding:.3rem .6rem;border-radius:50px;background:var(--card);border:1px solid var(--border)}
.palette-dot{width:14px;height:14px;border-radius:50%;border:1px solid rgba(0,0,0,.12);flex-shrink:0}

/* Tips */
.tip-list{list-style:none;display:flex;flex-direction:column;gap:.6rem}
.tip-list li{display:flex;gap:.6rem;font-size:.85rem;color:var(--muted)}
.tip-list li::before{content:"✦";color:var(--pri);flex-shrink:0;margin-top:.05rem}

/* Core items list */
.core-item{display:flex;align-items:flex-start;gap:.75rem;padding:.75rem 0;border-bottom:1px solid var(--border)}
.core-item:last-child{border-bottom:none}
.core-img{width:52px;height:52px;border-radius:var(--r-sm);object-fit:cover;flex-shrink:0;background:#f0ebe8;border:1px solid var(--border)}
.core-img-ph{width:52px;height:52px;border-radius:var(--r-sm);flex-shrink:0;background:var(--pri-lt);display:flex;align-items:center;justify-content:center;font-size:1.1rem;border:1px solid var(--border)}
.core-info h4{font-size:.85rem;font-weight:700;margin-bottom:.2rem}
.core-info p{font-size:.78rem;color:var(--muted)}

/* Toast */
#toast{position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%) translateY(8px);background:#2c1f18;color:#fff;padding:.65rem 1.25rem;border-radius:50px;font-size:.83rem;opacity:0;pointer-events:none;transition:.25s;z-index:999;white-space:nowrap}
#toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

/* Loading overlay */
#loading-overlay{position:fixed;inset:0;background:rgba(250,248,245,.85);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:200}
#loading-overlay .spinner{width:36px;height:36px;border-width:3px;margin-bottom:1rem}
#loading-overlay p{color:var(--muted);font-size:.9rem}

/* Responsive */
@media(max-width:600px){
  .grid-2,.grid-3{grid-template-columns:1fr 1fr}
  .results-top{flex-direction:column}
  .score-circle{align-self:center}
}
</style>
</head>
<body>

<nav>
  <div class="nav-logo">capsule<span>ai</span></div>
  <div class="nav-links">
    <button onclick="goTo('landing')" id="nl-home">Home</button>
    <button onclick="goTo('profile')" id="nl-profile">Profile</button>
    <button onclick="goTo('upload')" id="nl-upload">Wardrobe</button>
    <button onclick="goTo('results')" id="nl-results">Analysis</button>
  </div>
</nav>

<!-- ── Landing ──────────────────────────────────────────────── -->
<section id="s-landing">
  <div class="container">
    <div class="hero">
      <div class="hero-badge">AI-Powered Style</div>
      <h1>Your <em>Perfect Wardrobe</em><br>Curated by AI</h1>
      <p>Input your style profile, photo your clothes, and discover which pieces work, what gaps to fill, and outfits built from what you already own.</p>
      <button class="btn btn-primary" onclick="goTo('profile')" style="font-size:1rem;padding:.8rem 2rem">Get Started</button>
    </div>
    <div class="features">
      <div class="feature">
        <div class="feature-icon">✦</div>
        <h3>Your Style DNA</h3>
        <p>Measurements, color season, body shape, and aesthetic goals all in one profile.</p>
      </div>
      <div class="feature">
        <div class="feature-icon">✦</div>
        <h3>Smart Wardrobe Scan</h3>
        <p>Photo each piece — AI instantly identifies category, color, style, and versatility.</p>
      </div>
      <div class="feature">
        <div class="feature-icon">✦</div>
        <h3>Gap Analysis</h3>
        <p>Know exactly what's missing and what to buy first to multiply your outfit options.</p>
      </div>
      <div class="feature">
        <div class="feature-icon">✦</div>
        <h3>Outfit Boards</h3>
        <p>See curated looks built from your actual pieces — with expert styling tips.</p>
      </div>
    </div>
  </div>
</section>

<!-- ── Profile Wizard ────────────────────────────────────────── -->
<section id="s-profile" class="hidden">
  <div class="container">
    <div class="wizard-header">
      <h2>Build Your Style Profile</h2>
      <p>This takes about 3 minutes and makes every recommendation personal to you.</p>
    </div>

    <!-- Progress -->
    <div class="progress-bar">
      <div class="prog-step active" id="prog-1">1</div>
      <div class="prog-line" id="pline-1"></div>
      <div class="prog-step" id="prog-2">2</div>
      <div class="prog-line" id="pline-2"></div>
      <div class="prog-step" id="prog-3">3</div>
      <div class="prog-line" id="pline-3"></div>
      <div class="prog-step" id="prog-4">4</div>
    </div>

    <!-- Step 1: Measurements -->
    <div id="step-1" class="wizard-step active">
      <div class="card">
        <h3 style="margin-bottom:1rem;font-size:1.1rem">About You</h3>
        <div class="field-group">
          <label>Your Name</label>
          <input type="text" id="f-name" placeholder="e.g. Laura">
        </div>
        <h3 style="margin:.75rem 0 .75rem;font-size:1rem;color:var(--muted)">Measurements (optional but helpful)</h3>
        <div class="meas-grid">
          <div class="field-group">
            <label>Height</label>
            <input type="text" id="f-height" placeholder='5&apos;7" or 170cm'>
          </div>
          <div class="field-group">
            <label>Bust</label>
            <input type="text" id="f-bust" placeholder='36" or 91cm'>
          </div>
          <div class="field-group">
            <label>Waist</label>
            <input type="text" id="f-waist" placeholder='28" or 71cm'>
          </div>
          <div class="field-group">
            <label>Hips</label>
            <input type="text" id="f-hips" placeholder='38" or 96cm'>
          </div>
          <div class="field-group">
            <label>Inseam</label>
            <input type="text" id="f-inseam" placeholder='30" or 76cm'>
          </div>
          <div class="field-group">
            <label>Shoe Size</label>
            <input type="text" id="f-shoe" placeholder="US 8 / EU 38">
          </div>
        </div>
      </div>
      <div class="wizard-nav">
        <span class="step-info">Step 1 of 4</span>
        <button class="btn btn-primary" onclick="goStep(2)">Continue &rarr;</button>
      </div>
    </div>

    <!-- Step 2: Color Season -->
    <div id="step-2" class="wizard-step">
      <div class="card">
        <h3 style="margin-bottom:.4rem;font-size:1.1rem">Your Color Season</h3>
        <p style="font-size:.82rem;color:var(--muted);margin-bottom:1rem">Color analysis identifies the palette that makes your complexion glow. Choose the season whose colors feel most "you."</p>
        <div class="grid-2" id="season-grid">
          <div class="season-card" onclick="selectSeason('spring')">
            <div class="season-swatches">
              <div class="swatch" style="background:#f4956e"></div>
              <div class="swatch" style="background:#f5c842"></div>
              <div class="swatch" style="background:#7bc67e"></div>
              <div class="swatch" style="background:#f08cb0"></div>
              <div class="swatch" style="background:#5ecfe3"></div>
            </div>
            <div class="season-name">Spring</div>
            <div class="season-desc">Warm undertones · Light to medium depth · Bright &amp; clear colors</div>
          </div>
          <div class="season-card" onclick="selectSeason('summer')">
            <div class="season-swatches">
              <div class="swatch" style="background:#c9a8d4"></div>
              <div class="swatch" style="background:#8ab4d1"></div>
              <div class="swatch" style="background:#e8b0bc"></div>
              <div class="swatch" style="background:#96b5a2"></div>
              <div class="swatch" style="background:#b8c7d8"></div>
            </div>
            <div class="season-name">Summer</div>
            <div class="season-desc">Cool undertones · Light to medium depth · Soft &amp; muted colors</div>
          </div>
          <div class="season-card" onclick="selectSeason('autumn')">
            <div class="season-swatches">
              <div class="swatch" style="background:#c4622a"></div>
              <div class="swatch" style="background:#8b7355"></div>
              <div class="swatch" style="background:#5a7a3a"></div>
              <div class="swatch" style="background:#c4a235"></div>
              <div class="swatch" style="background:#7a3b2e"></div>
            </div>
            <div class="season-name">Autumn</div>
            <div class="season-desc">Warm undertones · Medium to deep depth · Rich &amp; muted tones</div>
          </div>
          <div class="season-card" onclick="selectSeason('winter')">
            <div class="season-swatches">
              <div class="swatch" style="background:#0d2b6b"></div>
              <div class="swatch" style="background:#6b1020"></div>
              <div class="swatch" style="background:#1c6b3c"></div>
              <div class="swatch" style="background:#1a1a2e"></div>
              <div class="swatch" style="background:#6b0f5e"></div>
            </div>
            <div class="season-name">Winter</div>
            <div class="season-desc">Cool undertones · High contrast · Deep or icy-bright colors</div>
          </div>
        </div>
      </div>
      <div class="card" style="margin-top:.75rem">
        <h3 style="margin-bottom:.75rem;font-size:.95rem;color:var(--muted)">Your Coloring Details (optional)</h3>
        <div class="grid-3">
          <div class="field-group">
            <label>Skin Tone</label>
            <select id="f-skin">
              <option value="">Select</option>
              <option value="fair">Fair / Porcelain</option>
              <option value="light">Light / Ivory</option>
              <option value="medium">Medium / Beige</option>
              <option value="olive">Olive</option>
              <option value="tan">Tan / Caramel</option>
              <option value="dark">Deep / Ebony</option>
            </select>
          </div>
          <div class="field-group">
            <label>Hair Color</label>
            <input type="text" id="f-hair" placeholder="e.g. dark brown">
          </div>
          <div class="field-group">
            <label>Eye Color</label>
            <input type="text" id="f-eyes" placeholder="e.g. hazel">
          </div>
        </div>
      </div>
      <div class="wizard-nav">
        <button class="btn-ghost" onclick="goStep(1)">&larr; Back</button>
        <span class="step-info">Step 2 of 4</span>
        <button class="btn btn-primary" onclick="goStep(3)">Continue &rarr;</button>
      </div>
    </div>

    <!-- Step 3: Body Shape -->
    <div id="step-3" class="wizard-step">
      <div class="card">
        <h3 style="margin-bottom:.4rem;font-size:1.1rem">Your Body Shape</h3>
        <p style="font-size:.82rem;color:var(--muted);margin-bottom:1rem">Body shape guides which silhouettes flatter you most. Not about size — purely about proportions.</p>
        <div class="grid-3" id="shape-grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">
          <div class="shape-card" onclick="selectShape('hourglass')">
            <div class="shape-fig s-hour"></div>
            <div class="shape-name">Hourglass</div>
            <div class="shape-desc">Bust ≈ hips, defined waist</div>
          </div>
          <div class="shape-card" onclick="selectShape('pear')">
            <div class="shape-fig s-pear"></div>
            <div class="shape-name">Pear</div>
            <div class="shape-desc">Hips wider than shoulders</div>
          </div>
          <div class="shape-card" onclick="selectShape('apple')">
            <div class="shape-fig s-apple"></div>
            <div class="shape-name">Apple</div>
            <div class="shape-desc">More volume in midsection</div>
          </div>
          <div class="shape-card" onclick="selectShape('rectangle')">
            <div class="shape-fig s-rect"></div>
            <div class="shape-name">Rectangle</div>
            <div class="shape-desc">Similar width throughout</div>
          </div>
          <div class="shape-card" onclick="selectShape('inverted-triangle')">
            <div class="shape-fig s-inv"></div>
            <div class="shape-name">Inverted Triangle</div>
            <div class="shape-desc">Shoulders wider than hips</div>
          </div>
        </div>
      </div>
      <div class="wizard-nav">
        <button class="btn-ghost" onclick="goStep(2)">&larr; Back</button>
        <span class="step-info">Step 3 of 4</span>
        <button class="btn btn-primary" onclick="goStep(4)">Continue &rarr;</button>
      </div>
    </div>

    <!-- Step 4: Style & Preferences -->
    <div id="step-4" class="wizard-step">
      <div class="card">
        <h3 style="margin-bottom:.75rem;font-size:1.1rem">Your Style Aesthetic</h3>
        <p style="font-size:.82rem;color:var(--muted);margin-bottom:.9rem">Select all that resonate with you.</p>
        <div class="style-tags" id="style-tags">
          <span class="style-tag" onclick="toggleTag(this,'minimalist')">Minimalist</span>
          <span class="style-tag" onclick="toggleTag(this,'classic')">Classic / Timeless</span>
          <span class="style-tag" onclick="toggleTag(this,'romantic')">Romantic / Feminine</span>
          <span class="style-tag" onclick="toggleTag(this,'business')">Business Professional</span>
          <span class="style-tag" onclick="toggleTag(this,'casual-chic')">Casual Chic</span>
          <span class="style-tag" onclick="toggleTag(this,'bohemian')">Bohemian</span>
          <span class="style-tag" onclick="toggleTag(this,'edgy')">Edgy / Modern</span>
          <span class="style-tag" onclick="toggleTag(this,'athleisure')">Athleisure</span>
          <span class="style-tag" onclick="toggleTag(this,'preppy')">Preppy</span>
          <span class="style-tag" onclick="toggleTag(this,'eclectic')">Eclectic</span>
        </div>
      </div>
      <div class="card" style="margin-top:.75rem">
        <h3 style="margin-bottom:.75rem;font-size:1.1rem">Occasions You Dress For</h3>
        <div class="style-tags" id="occasion-tags">
          <span class="style-tag" onclick="toggleTag(this,'everyday-casual')">Everyday Casual</span>
          <span class="style-tag" onclick="toggleTag(this,'work-office')">Work / Office</span>
          <span class="style-tag" onclick="toggleTag(this,'smart-casual')">Smart Casual</span>
          <span class="style-tag" onclick="toggleTag(this,'formal-events')">Formal Events</span>
          <span class="style-tag" onclick="toggleTag(this,'dates-nights-out')">Dates &amp; Nights Out</span>
          <span class="style-tag" onclick="toggleTag(this,'travel')">Travel</span>
          <span class="style-tag" onclick="toggleTag(this,'active-outdoor')">Active / Outdoor</span>
          <span class="style-tag" onclick="toggleTag(this,'loungewear-home')">Loungewear / Home</span>
        </div>
      </div>
      <div class="card" style="margin-top:.75rem">
        <h3 style="margin-bottom:.75rem;font-size:1.1rem">Preferences</h3>
        <div class="grid-2">
          <div class="field-group">
            <label>Budget per item</label>
            <select id="f-budget">
              <option value="low">Budget-conscious (&lt;$50)</option>
              <option value="medium" selected>Mid-range ($50–$150)</option>
              <option value="high">Investment ($150–$400)</option>
              <option value="luxury">Luxury ($400+)</option>
            </select>
          </div>
        </div>
        <div class="field-group">
          <label>Colours you love (optional)</label>
          <input type="text" id="f-fav-colors" placeholder="e.g. navy, camel, dusty rose">
        </div>
        <div class="field-group">
          <label>Colours to avoid (optional)</label>
          <input type="text" id="f-avoid-colors" placeholder="e.g. orange, neon yellow">
        </div>
      </div>
      <div class="wizard-nav">
        <button class="btn-ghost" onclick="goStep(3)">&larr; Back</button>
        <span class="step-info">Step 4 of 4</span>
        <button class="btn btn-primary" onclick="saveProfileAndContinue()">Save &amp; Add Wardrobe &rarr;</button>
      </div>
    </div>
  </div>
</section>

<!-- ── Wardrobe Upload ────────────────────────────────────────── -->
<section id="s-upload" class="hidden">
  <div class="container">
    <div class="upload-header">
      <div>
        <h2>Your Wardrobe</h2>
        <p style="font-size:.85rem;color:var(--muted);margin-top:.25rem">Photo each piece — one item per photo works best.</p>
      </div>
      <button class="btn btn-outline btn-sm" onclick="goTo('profile')">Edit Profile</button>
    </div>

    <div class="dropzone" id="dropzone" onclick="document.getElementById('file-input').click()" ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')" ondrop="handleDrop(event)">
      <div class="dropzone-icon">+</div>
      <p><em>Click or drag &amp; drop</em> to upload photos</p>
      <p style="font-size:.75rem;margin-top:.25rem">JPG, PNG or WEBP · Multiple files OK</p>
    </div>
    <input type="file" id="file-input" accept="image/jpeg,image/png,image/webp" multiple onchange="handleFiles(this.files)">

    <div class="category-bar">
      <span>Category for next upload:</span>
      <button class="cat-btn active" onclick="setCat(this,'top')">Tops</button>
      <button class="cat-btn" onclick="setCat(this,'bottom')">Bottoms</button>
      <button class="cat-btn" onclick="setCat(this,'dress')">Dresses</button>
      <button class="cat-btn" onclick="setCat(this,'outerwear')">Outerwear</button>
      <button class="cat-btn" onclick="setCat(this,'shoes')">Shoes</button>
      <button class="cat-btn" onclick="setCat(this,'bag')">Bags</button>
      <button class="cat-btn" onclick="setCat(this,'jewelry')">Jewelry</button>
      <button class="cat-btn" onclick="setCat(this,'accessory')">Accessories</button>
    </div>

    <div class="items-grid" id="items-grid"></div>

    <div class="analyze-bar" id="analyze-bar">
      <div class="analyze-bar-info">
        <strong id="item-count">0 items</strong> uploaded
        <span id="analyzing-note" class="hidden" style="margin-left:.5rem;color:var(--pri)">— AI is reading your wardrobe…</span>
      </div>
      <button class="btn btn-primary" onclick="runAnalysis()" id="analyze-btn">Analyze My Wardrobe</button>
    </div>
  </div>
</section>

<!-- ── Results ────────────────────────────────────────────────── -->
<section id="s-results" class="hidden">
  <div class="container">
    <div class="results-top">
      <div class="score-circle" id="score-circle">
        <div class="score-num" id="score-num">—</div>
        <div>/ 100</div>
      </div>
      <div class="results-summary">
        <h2>Your Capsule Analysis</h2>
        <p id="results-summary-text">Run your analysis to see results.</p>
        <div id="results-strengths" style="margin-top:.75rem;display:flex;flex-wrap:wrap;gap:.4rem"></div>
      </div>
    </div>

    <div class="tabs">
      <button class="tab-btn active" onclick="showTab('capsule')">My Capsule</button>
      <button class="tab-btn" onclick="showTab('gaps')">Fill the Gaps</button>
      <button class="tab-btn" onclick="showTab('outfits')">Outfit Ideas</button>
      <button class="tab-btn" onclick="showTab('palette')">Color Palette</button>
    </div>

    <div class="tab-content active" id="tab-capsule">
      <h3 style="font-size:.9rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.75rem">Core Wardrobe Pieces</h3>
      <div id="core-items-list"></div>
      <h3 style="font-size:.9rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin:.75rem 0">Styling Tips for You</h3>
      <ul class="tip-list" id="styling-tips"></ul>
    </div>

    <div class="tab-content" id="tab-gaps">
      <p style="font-size:.85rem;color:var(--muted);margin-bottom:1rem">Prioritised shopping list to complete your capsule:</p>
      <div id="gaps-list"></div>
    </div>

    <div class="tab-content" id="tab-outfits">
      <p style="font-size:.85rem;color:var(--muted);margin-bottom:1rem">Outfits built from pieces you already own:</p>
      <div id="outfits-list"></div>
    </div>

    <div class="tab-content" id="tab-palette">
      <div class="card">
        <h3 style="font-size:1rem;font-weight:700;margin-bottom:.75rem">Your Best Colors</h3>
        <div class="palette-row" id="palette-best"></div>
        <h3 style="font-size:1rem;font-weight:700;margin:.85rem 0 .5rem">Your Neutrals</h3>
        <div class="palette-row" id="palette-neutrals"></div>
        <h3 style="font-size:1rem;font-weight:700;margin:.85rem 0 .5rem">Colors to Limit</h3>
        <div class="palette-row" id="palette-avoid"></div>
      </div>
    </div>

    <div style="display:flex;gap:.75rem;margin-top:1.5rem;flex-wrap:wrap">
      <button class="btn btn-outline" onclick="goTo('upload')">Add More Items</button>
      <button class="btn btn-outline" onclick="runAnalysis()">Re-Analyze</button>
    </div>
  </div>
</section>

<!-- ── Toast & Loading ─────────────────────────────────────────── -->
<div id="toast"></div>
<div id="loading-overlay" class="hidden">
  <div class="spinner"></div>
  <p id="loading-msg">Analyzing your wardrobe…</p>
</div>

<script>
// ── State ──────────────────────────────────────────────────────
const S = {
  profileId: localStorage.getItem('wardrobeProfileId') || null,
  currentSection: 'landing',
  currentStep: 1,
  selectedSeason: null,
  selectedShape: null,
  selectedStyles: new Set(),
  selectedOccasions: new Set(),
  items: [],
  currentCat: 'top',
  analysis: null,
  pendingAnalyses: 0
};

if (!S.profileId) {
  S.profileId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem('wardrobeProfileId', S.profileId);
}

// ── Navigation ─────────────────────────────────────────────────
function goTo(section) {
  document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
  document.getElementById('s-' + section).classList.remove('hidden');
  S.currentSection = section;
  window.scrollTo({top:0,behavior:'smooth'});
}

// ── Wizard steps ───────────────────────────────────────────────
function goStep(n) {
  document.querySelectorAll('.wizard-step').forEach(s => s.classList.remove('active'));
  document.getElementById('step-' + n).classList.add('active');

  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById('prog-' + i);
    el.classList.remove('active','done');
    if (i < n) el.classList.add('done');
    else if (i === n) el.classList.add('active');
    if (i < 4) {
      const ln = document.getElementById('pline-' + i);
      ln.classList.toggle('done', i < n);
    }
  }
  S.currentStep = n;
  window.scrollTo({top:0,behavior:'smooth'});
}

// ── Season selector ────────────────────────────────────────────
function selectSeason(season) {
  S.selectedSeason = season;
  document.querySelectorAll('.season-card').forEach(c => c.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
}

// ── Body shape selector ────────────────────────────────────────
function selectShape(shape) {
  S.selectedShape = shape;
  document.querySelectorAll('.shape-card').forEach(c => c.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
}

// ── Style / occasion tags ──────────────────────────────────────
function toggleTag(el, value) {
  const isStyle = el.closest('#style-tags');
  const set = isStyle ? S.selectedStyles : S.selectedOccasions;
  if (set.has(value)) { set.delete(value); el.classList.remove('selected'); }
  else { set.add(value); el.classList.add('selected'); }
}

// ── Category selector ──────────────────────────────────────────
function setCat(btn, cat) {
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  S.currentCat = cat;
}

// ── Toast ──────────────────────────────────────────────────────
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ── Loading overlay ────────────────────────────────────────────
function showLoading(msg) {
  document.getElementById('loading-msg').textContent = msg || 'Working…';
  document.getElementById('loading-overlay').classList.remove('hidden');
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

// ── API ────────────────────────────────────────────────────────
async function api(method, endpoint, body) {
  const opts = { method, headers: {'Content-Type':'application/json'} };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch('/wardrobe/api/' + endpoint, opts);
  return r.json();
}

// ── Save profile ───────────────────────────────────────────────
async function saveProfileAndContinue() {
  const profile = {
    name: document.getElementById('f-name').value.trim(),
    measurements: {
      height:  document.getElementById('f-height').value.trim(),
      bust:    document.getElementById('f-bust').value.trim(),
      waist:   document.getElementById('f-waist').value.trim(),
      hips:    document.getElementById('f-hips').value.trim(),
      inseam:  document.getElementById('f-inseam').value.trim(),
      shoeSize:document.getElementById('f-shoe').value.trim()
    },
    coloring: {
      season:    S.selectedSeason,
      skinTone:  document.getElementById('f-skin').value,
      hairColor: document.getElementById('f-hair').value.trim(),
      eyeColor:  document.getElementById('f-eyes').value.trim()
    },
    bodyShape:  S.selectedShape,
    styleGoals: [...S.selectedStyles],
    occasions:  [...S.selectedOccasions],
    preferences: {
      budget:         document.getElementById('f-budget').value,
      favoriteColors: document.getElementById('f-fav-colors').value.split(',').map(s=>s.trim()).filter(Boolean),
      avoidColors:    document.getElementById('f-avoid-colors').value.split(',').map(s=>s.trim()).filter(Boolean)
    }
  };

  showLoading('Saving your profile…');
  try {
    await api('POST', 'profile', { profileId: S.profileId, profile });
    toast('Profile saved!');
    goTo('upload');
  } catch(e) {
    toast('Could not save profile. Please try again.');
  } finally {
    hideLoading();
  }
}

// ── Image resize helper ────────────────────────────────────────
function resizeImageFile(file, maxDim, quality) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => {
          const r2 = new FileReader();
          r2.onload = e2 => resolve({ b64: e2.target.result.split(',')[1], mime: 'image/jpeg', previewUrl: e2.target.result });
          r2.readAsDataURL(blob);
        }, 'image/jpeg', quality || 0.82);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Upload a single item ───────────────────────────────────────
async function uploadSingleItem(file, category) {
  const tempId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2);

  // Show placeholder card while processing
  const grid = document.getElementById('items-grid');
  const card = document.createElement('div');
  card.className = 'item-card';
  card.id = 'card-' + tempId;
  const placeholder = document.createElement('div');
  placeholder.className = 'item-img-placeholder';
  placeholder.textContent = categoryEmoji(category);
  card.appendChild(placeholder);
  const analyzing = document.createElement('div');
  analyzing.className = 'item-analyzing';
  analyzing.innerHTML = '<div class="spinner"></div><span>Analyzing…</span>';
  card.appendChild(analyzing);
  grid.appendChild(card);

  try {
    const { b64, mime } = await resizeImageFile(file, 900, 0.82);
    const result = await api('POST', 'item', { profileId: S.profileId, imageBase64: b64, mimeType: mime, category });

    if (result.item) {
      S.items.push(result.item);
      renderItemCard(card, result.item);
    } else {
      card.remove();
      toast('Could not upload item.');
    }
  } catch(e) {
    card.remove();
    toast('Upload failed: ' + (e.message || 'unknown error'));
  }

  updateItemCount();
}

function categoryEmoji(cat) {
  const m = {top:'👕',bottom:'👖',dress:'👗',outerwear:'🧥',shoes:'👠',bag:'👜',jewelry:'💍',accessory:'🧣'};
  return m[cat] || '✦';
}

// ── Render a single item card ──────────────────────────────────
function renderItemCard(card, item) {
  const a = item.analysis || {};
  card.id = 'card-' + item.id;
  card.innerHTML = '';

  const img = document.createElement('img');
  img.className = 'item-img';
  img.src = '/wardrobe/uploads/' + item.filename;
  img.alt = a.subcategory || a.category || 'Item';
  card.appendChild(img);

  const body = document.createElement('div');
  body.className = 'item-body';
  body.innerHTML = \`
    <div class="item-cat-badge">\${a.subcategory || a.category || item.category}</div>
    <div class="item-desc">\${a.description || ''}</div>
  \`;
  card.appendChild(body);

  const del = document.createElement('button');
  del.className = 'item-delete';
  del.title = 'Remove';
  del.textContent = '×';
  del.onclick = e => { e.stopPropagation(); deleteItem(item.id); };
  card.appendChild(del);
}

// ── Re-render all item cards ───────────────────────────────────
function renderAllItems() {
  const grid = document.getElementById('items-grid');
  grid.innerHTML = '';
  S.items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'item-card';
    renderItemCard(card, item);
    grid.appendChild(card);
  });
  updateItemCount();
}

function updateItemCount() {
  const n = S.items.length;
  document.getElementById('item-count').textContent = n + ' item' + (n !== 1 ? 's' : '');
}

// ── Delete item ────────────────────────────────────────────────
async function deleteItem(itemId) {
  try {
    await api('DELETE', 'item/' + itemId + '?profileId=' + S.profileId, null);
    S.items = S.items.filter(it => it.id !== itemId);
    const card = document.getElementById('card-' + itemId);
    if (card) card.remove();
    updateItemCount();
    toast('Item removed.');
  } catch(e) {
    toast('Could not remove item.');
  }
}

// ── File handlers ──────────────────────────────────────────────
async function handleFiles(files) {
  for (const file of files) {
    await uploadSingleItem(file, S.currentCat);
  }
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.remove('over');
  handleFiles(e.dataTransfer.files);
}

// ── Run analysis ───────────────────────────────────────────────
async function runAnalysis() {
  if (S.items.length === 0) {
    toast('Upload at least one item first!');
    return;
  }
  showLoading('Analyzing your wardrobe with AI… this takes ~15 seconds');
  try {
    const result = await api('POST', 'analyze', { profileId: S.profileId });
    S.analysis = result.analysis;
    if (S.analysis && !S.analysis.error) {
      renderResults(S.analysis, S.items);
      goTo('results');
      toast('Analysis complete!');
    } else {
      toast((S.analysis && S.analysis.summary) || 'Analysis failed. Check your API key.');
      goTo('results');
    }
  } catch(e) {
    toast('Analysis failed: ' + e.message);
  } finally {
    hideLoading();
  }
}

// ── Render results ─────────────────────────────────────────────
function colorToCss(colorName) {
  const map = {
    navy:'#1a2e5a',camel:'#c4956a',ivory:'#f5f0e8',white:'#f8f8f8',black:'#1a1a1a',
    grey:'#9e9e9e',gray:'#9e9e9e',beige:'#d4c4a8',cream:'#fdf6e3',tan:'#c9a87c',
    brown:'#7a4e2d',rust:'#b7410e',terracotta:'#c0652b',blush:'#e8b4b8',rose:'#e8a0a0',
    pink:'#f48fb1',mauve:'#b08090',burgundy:'#800020',wine:'#6b1530',red:'#c0392b',
    coral:'#f08060',peach:'#ffab91',orange:'#e67e22',mustard:'#c9a825',gold:'#d4a017',
    yellow:'#f5c842',olive:'#7a8c2e',sage:'#87a985',green:'#3a7c52',emerald:'#2c8c6f',
    teal:'#2c8c8c',turquoise:'#40c0c0',sky:'#5bc0de',blue:'#3d7abf','royal blue':'#3b58c4',
    navy2:'#1e3a5f',lavender:'#b48abf',lilac:'#c9a8d4',purple:'#7b2d8b','dusty rose':'#c4909a',
    ecru:'#f0e8d0',taupe:'#a09080','off-white':'#f5f2eb'
  };
  const lower = colorName.toLowerCase();
  return map[lower] || null;
}

function paletteChip(color) {
  const bg = colorToCss(color) || '#c0b0a8';
  return \`<div class="palette-chip"><div class="palette-dot" style="background:\${bg}"></div>\${color}</div>\`;
}

function renderResults(analysis, items) {
  // Score circle
  const score = analysis.capsuleScore || 0;
  document.getElementById('score-num').textContent = score;
  const deg = Math.round(score * 3.6);
  document.getElementById('score-circle').style.background =
    \`conic-gradient(var(--pri) \${deg}deg, var(--pri-lt) \${deg}deg)\`;

  // Summary
  document.getElementById('results-summary-text').textContent = analysis.summary || '';

  // Strengths
  const strengthsEl = document.getElementById('results-strengths');
  strengthsEl.innerHTML = (analysis.strengths || []).map(s =>
    \`<span class="gap-tag" style="background:var(--sage-lt);color:#3d6b42">\${s}</span>\`
  ).join('');

  // Core items
  const coreList = document.getElementById('core-items-list');
  coreList.innerHTML = '';
  (analysis.coreItems || []).forEach(ci => {
    const item = items[ci.index - 1];
    if (!item) return;
    const a = item.analysis || {};
    const div = document.createElement('div');
    div.className = 'core-item';
    const imgOrPh = item.filename
      ? \`<img class="core-img" src="/wardrobe/uploads/\${item.filename}" alt="">\`
      : \`<div class="core-img-ph">\${categoryEmoji(item.category)}</div>\`;
    div.innerHTML = \`\${imgOrPh}<div class="core-info"><h4>\${a.subcategory||a.category||'Item'}</h4><p>\${ci.reason}</p></div>\`;
    coreList.appendChild(div);
  });
  if ((analysis.coreItems||[]).length === 0)
    coreList.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Upload more items to see your core pieces.</p>';

  // Styling tips
  const tipsEl = document.getElementById('styling-tips');
  tipsEl.innerHTML = (analysis.stylingTips || []).map(t => \`<li>\${t}</li>\`).join('');

  // Gaps
  const gapsList = document.getElementById('gaps-list');
  gapsList.innerHTML = '';
  (analysis.gaps || []).forEach(gap => {
    const div = document.createElement('div');
    div.className = 'gap-card';
    div.innerHTML = \`
      <div class="gap-priority">\${gap.priority}</div>
      <div class="gap-body">
        <h4>\${gap.item}</h4>
        <p>\${gap.why}</p>
        <div class="gap-meta">
          <span class="gap-tag">\${gap.colorSuggestion || ''}</span>
          \${gap.estimatedCost ? \`<span class="gap-tag cost">\${gap.estimatedCost}</span>\` : ''}
          \${gap.whereToShop ? \`<span class="gap-tag shop">\${gap.whereToShop}</span>\` : ''}
        </div>
      </div>\`;
    gapsList.appendChild(div);
  });
  if ((analysis.gaps||[]).length === 0)
    gapsList.innerHTML = '<p style="color:var(--muted)">Great news — no significant gaps found!</p>';

  // Outfits
  const outfitsList = document.getElementById('outfits-list');
  outfitsList.innerHTML = '';
  (analysis.outfits || []).forEach(outfit => {
    const div = document.createElement('div');
    div.className = 'outfit-card';
    const boardItems = (outfit.itemIndices || []).map(idx => {
      const it = items[idx - 1];
      if (!it) return \`<div class="outfit-item-placeholder">\${categoryEmoji('top')}</div>\`;
      return it.filename
        ? \`<img class="outfit-item-img" src="/wardrobe/uploads/\${it.filename}" alt="">\`
        : \`<div class="outfit-item-placeholder">\${categoryEmoji(it.category)}</div>\`;
    }).join('');
    div.innerHTML = \`
      <div class="outfit-card-header">
        <h4>\${outfit.name}</h4>
        <span class="outfit-occasion">\${outfit.occasion}</span>
      </div>
      <div class="outfit-board">\${boardItems}</div>
      <div class="outfit-details">
        <p class="outfit-desc">\${outfit.description || ''}</p>
        \${outfit.tip ? \`<div class="outfit-tip">\${outfit.tip}</div>\` : ''}
      </div>\`;
    outfitsList.appendChild(div);
  });
  if ((analysis.outfits||[]).length === 0)
    outfitsList.innerHTML = '<p style="color:var(--muted)">Upload more items to get outfit suggestions.</p>';

  // Palette
  const cp = analysis.colorPalette || {};
  document.getElementById('palette-best').innerHTML     = (cp.bestColors||[]).map(paletteChip).join('');
  document.getElementById('palette-neutrals').innerHTML = (cp.neutrals||[]).map(paletteChip).join('');
  document.getElementById('palette-avoid').innerHTML    = (cp.avoidColors||[]).map(paletteChip).join('');
}

// ── Tab switching ──────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector(\`.tab-btn[onclick*="\${name}"]\`).classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
}

// ── Init: load existing data ───────────────────────────────────
(async function init() {
  try {
    const data = await api('GET', 'profile/' + S.profileId);
    if (data.profile) {
      const p = data.profile;
      if (p.name)           document.getElementById('f-name').value         = p.name;
      if (p.measurements) {
        Object.entries(p.measurements).forEach(([k,v]) => {
          const map = {height:'f-height',bust:'f-bust',waist:'f-waist',hips:'f-hips',inseam:'f-inseam',shoeSize:'f-shoe'};
          if (map[k]) document.getElementById(map[k]).value = v;
        });
      }
      if (p.coloring) {
        if (p.coloring.season)    selectSeasonSilent(p.coloring.season);
        if (p.coloring.skinTone)  document.getElementById('f-skin').value  = p.coloring.skinTone;
        if (p.coloring.hairColor) document.getElementById('f-hair').value = p.coloring.hairColor;
        if (p.coloring.eyeColor)  document.getElementById('f-eyes').value = p.coloring.eyeColor;
      }
      if (p.bodyShape)    selectShapeSilent(p.bodyShape);
      if (p.styleGoals)   p.styleGoals.forEach(v => activateTag('#style-tags', v));
      if (p.occasions)    p.occasions.forEach(v  => activateTag('#occasion-tags', v));
      if (p.preferences) {
        if (p.preferences.budget)         document.getElementById('f-budget').value         = p.preferences.budget;
        if (p.preferences.favoriteColors) document.getElementById('f-fav-colors').value = (p.preferences.favoriteColors||[]).join(', ');
        if (p.preferences.avoidColors)    document.getElementById('f-avoid-colors').value   = (p.preferences.avoidColors||[]).join(', ');
      }
    }
    if (data.items && data.items.length) {
      S.items = data.items;
      renderAllItems();
    }
  } catch(_) {}
})();

function selectSeasonSilent(season) {
  S.selectedSeason = season;
  document.querySelectorAll('.season-card').forEach((c, i) => {
    const seasons = ['spring','summer','autumn','winter'];
    if (seasons[i] === season) c.classList.add('selected');
  });
}

function selectShapeSilent(shape) {
  S.selectedShape = shape;
  const shapes = ['hourglass','pear','apple','rectangle','inverted-triangle'];
  document.querySelectorAll('.shape-card').forEach((c, i) => {
    if (shapes[i] === shape) c.classList.add('selected');
  });
}

function activateTag(containerSel, value) {
  const container = document.querySelector(containerSel);
  if (!container) return;
  container.querySelectorAll('.style-tag').forEach(el => {
    if (el.getAttribute('onclick').includes("'" + value + "'")) {
      el.classList.add('selected');
      if (containerSel.includes('style')) S.selectedStyles.add(value);
      else S.selectedOccasions.add(value);
    }
  });
}
</script>
</body>
</html>`;
}

// ── API route handlers ────────────────────────────────────────────────────────

async function handleAPI(req, res, url, method) {
  // GET profile
  if (method === 'GET' && url.match(/^\/wardrobe\/api\/profile\/.+$/)) {
    const profileId = url.split('/').pop();
    const db = loadDB();
    const entry = db.profiles[profileId] || {};
    return json(res, 200, { profile: entry.profile || null, items: entry.items || [] });
  }

  // POST profile
  if (method === 'POST' && url === '/wardrobe/api/profile') {
    const body = await parseBody(req);
    const { profileId, profile } = body;
    if (!profileId || !profile) return json(res, 400, { error: 'Missing profileId or profile' });
    const db = loadDB();
    if (!db.profiles[profileId]) db.profiles[profileId] = { items: [] };
    db.profiles[profileId].profile = { ...profile, updatedAt: new Date().toISOString() };
    saveDB(db);
    return json(res, 200, { ok: true });
  }

  // POST item (upload + analyze)
  if (method === 'POST' && url === '/wardrobe/api/item') {
    const body = await parseBody(req);
    const { profileId, imageBase64, mimeType, category } = body;
    if (!profileId || !imageBase64) return json(res, 400, { error: 'Missing required fields' });

    const db = loadDB();
    if (!db.profiles[profileId]) db.profiles[profileId] = { items: [] };

    const filename = saveImage(imageBase64, mimeType || 'image/jpeg');
    const analysis = await analyzeItem(imageBase64, mimeType || 'image/jpeg');
    const item = {
      id: crypto.randomUUID(),
      filename,
      category: category || analysis.category || 'other',
      analysis,
      addedAt: new Date().toISOString()
    };

    db.profiles[profileId].items.push(item);
    saveDB(db);
    return json(res, 201, { item });
  }

  // DELETE item
  if (method === 'DELETE' && url.match(/^\/wardrobe\/api\/item\/.+/)) {
    const parts = url.split('?');
    const itemId = parts[0].split('/').pop();
    const profileId = new URLSearchParams(parts[1] || '').get('profileId');
    if (!profileId || !itemId) return json(res, 400, { error: 'Missing params' });

    const db = loadDB();
    const entry = db.profiles[profileId];
    if (!entry) return json(res, 404, { error: 'Profile not found' });

    const item = entry.items.find(i => i.id === itemId);
    if (item && item.filename) {
      const fp = path.join(UPLOADS_DIR, item.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    entry.items = entry.items.filter(i => i.id !== itemId);
    saveDB(db);
    return json(res, 200, { ok: true });
  }

  // POST analyze
  if (method === 'POST' && url === '/wardrobe/api/analyze') {
    const body = await parseBody(req);
    const { profileId } = body;
    if (!profileId) return json(res, 400, { error: 'Missing profileId' });

    const db = loadDB();
    const entry = db.profiles[profileId] || {};
    const profile = entry.profile || {};
    const items   = entry.items   || [];

    const analysis = await runWardrobeAnalysis(profile, items);
    // Store analysis result
    if (!db.profiles[profileId]) db.profiles[profileId] = { items: [] };
    db.profiles[profileId].lastAnalysis = { ...analysis, analyzedAt: new Date().toISOString() };
    saveDB(db);
    return json(res, 200, { analysis });
  }

  return null; // not handled
}

// ── Main request handler ──────────────────────────────────────────────────────

async function handleRequest(req, res, url, method) {
  // Serve SPA
  if (url === '/wardrobe' || url === '/wardrobe/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(buildPage());
    return true;
  }

  // Serve uploaded images
  if (url.startsWith('/wardrobe/uploads/')) {
    const filename = path.basename(url.split('?')[0]);
    if (!/^[\w\-]+\.(jpg|jpeg|png|webp)$/i.test(filename)) {
      res.writeHead(400); res.end('Bad filename'); return true;
    }
    const filepath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filepath)) { res.writeHead(404); res.end('Not found'); return true; }
    const ext = path.extname(filename).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public,max-age=86400' });
    fs.createReadStream(filepath).pipe(res);
    return true;
  }

  // API routes
  if (url.startsWith('/wardrobe/api/')) {
    const handled = await handleAPI(req, res, url, method);
    if (handled !== null) return true;
    json(res, 404, { error: 'Not found' });
    return true;
  }

  return false; // not a wardrobe route
}

module.exports = { ensureDirs, handleRequest };
