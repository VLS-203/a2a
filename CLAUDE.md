# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start the server
npm start          # or: node server.js
PORT=3000 node server.js   # custom port
```

No test runner or linter is configured. Test manually with curl:

```bash
# List agents
curl http://localhost:18790/agents

# Request an API key
curl -X POST http://localhost:18790/request-key \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","agentName":"MyAgent"}'

# Register an agent (replace KEY with the key from above)
curl -X POST http://localhost:18790/register \
  -H "Content-Type: application/json" \
  -H "X-API-Key: KEY" \
  -d '{"name":"MyAgent","description":"...","url":"https://myagent.example.com"}'
```

## Architecture

This is a single-file Node.js HTTP service — no frameworks, no npm dependencies. Everything lives in `server.js` (~271 lines) using only Node.js built-ins (`http`, `fs`, `crypto`, `path`). **IMPORTANT: Do not add npm dependencies.** The zero-dependency constraint is intentional.

**Data layer:** Two flat JSON files serve as the database:
- `agents.json` — the registry of all registered agents, loaded into memory at startup and written synchronously on each `POST /register`
- `keys.json` — API keys indexed by key value, written synchronously on each `POST /request-key`

All file I/O uses `fs.readFileSync`/`fs.writeFileSync` (not async). Data is loaded once at startup into module-level variables; mutations update the in-memory object and then persist it.

**IMPORTANT: `keys.json` contains live API keys.** Do not log, expose, or carelessly overwrite it.

**Request handling:** A single `http.createServer` handler routes by `method + url`. CORS preflight is handled for all routes. The two `GET /` routes (`/` and `/human`) return inline HTML strings built as template literals from the in-memory agent list — there is no templating engine.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | — | Agent-facing HTML homepage (dark theme) |
| GET | `/human` | — | Human-facing HTML homepage (light theme) |
| GET | `/.well-known/agent-card.json` | — | Registry's own agent card |
| GET | `/agents` | — | JSON list of all registered agents |
| GET | `/agents/:id` | — | JSON for a single agent by ID |
| POST | `/register` | `X-API-Key` header | Add a new agent to the registry |
| POST | `/request-key` | — | Generate a new API key (email + agentName in body) |

## Agent Card Schema

The core data model is the **agent card** (schema v1.2, A2A spec v1.0). Beyond standard fields (name, description, url, version, provider), each card carries:

- **Capabilities:** `input_types` / `output_types` — what data formats the agent accepts/produces
- **Protocols:** which agent communication protocols are supported (A2A, MCP, etc.)
- **Payment:** multi-currency support across fiat, stablecoins, and the native VECTIS token
- **Trust signals:** verification status, security certifications, reputation score, origin country
- **Adoption & Performance:** live metrics (sessions, growth rate, latency percentiles, uptime)

See `agents.json` for canonical examples of fully populated agent cards.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `18790` | HTTP listen port |
| `ADMIN_KEY` | `laura-registry-2026-secret` | Master API key bypassing key lookup |
| `DB_PATH` | `./agents.json` | Path to agents database file |

For personal overrides (custom port, local test data, etc.) that shouldn't be committed, create a `CLAUDE.local.md` in the project root and add it to `.gitignore`.
