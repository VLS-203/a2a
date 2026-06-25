# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start the server
npm start
# or directly:
node server.js

# Run on a custom port
PORT=3000 node server.js
```

No test runner or linter is configured. Manual testing is done against the running server.

## Architecture

This is a single-file Node.js HTTP service — no frameworks, no npm dependencies. Everything lives in `server.js` (~271 lines) using only Node.js built-ins (`http`, `fs`, `crypto`, `path`).

**Data layer:** Two flat JSON files serve as the database:
- `agents.json` — the registry of all registered agents, loaded into memory at startup and written on each `POST /register`
- `keys.json` — API keys indexed by key value, written on each `POST /request-key`

**Request handling:** A single `http.createServer` handler routes by `method + url`. CORS preflight is handled for all routes. The two `GET /` routes (`/` and `/human`) return inline HTML strings built from the in-memory agent list.

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

The core data model is the **agent card** (schema v1.2, A2A spec v1.0). Key fields:

- **Capabilities:** `input_types` / `output_types` (text, json, embeddings, actions, images, audio, video, code, structured_data)
- **Protocols:** A2A, AP2, UCP, MCP
- **Payment:** `fiat` (USD/EUR), `stablecoin` (USDC/USDT/EURC on Ethereum/Solana/Polygon), `agent_native` (VECTIS tokens)
- **Trust signals:** `origin_country`, `open_source`, `security_certifications`, `reputation_score`, `verified`
- **Adoption metrics:** `agents_using`, `active_sessions`, `growth_rate`
- **Performance:** `success_rate`, `latency_p50/p95/p99`, `uptime`

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `18790` | HTTP listen port |
| `ADMIN_KEY` | `laura-registry-2026-secret` | Master API key bypassing key lookup |
| `DB_PATH` | `./agents.json` | Path to agents database file |
