# Leviathan Bridge (Project Leviathan)

Leviathan Bridge is a local-first React app for turning raw contact lists into a scored, searchable "contact universe" with AI-assisted enrichment and strategy-aware prioritization.

It is built around:
- CSV ingestion for people/investor data
- thesis/context memory for values and strategy constraints
- AI-driven enrichment with evidence gating
- dashboard and operational review workflows
- optional cloud sync via Puter account sign-in
- organization workspace (thesis/context + invites + dedupe)

## What The App Does

- Maintains a **Contact Universe** with statuses: `New`, `Enriched`, `Review Needed`, `Discarded`
- Ingests CSV files using AI-assisted column mapping with heuristic fallback
- Runs contact enrichment and scoring across:
  - investor fit
  - values alignment
  - government access
  - maritime relevance
  - connector score
- Verifies evidence links and applies quality gates before accepting enrichment
- Supports an assistant chat interface with tool-like actions:
  - contact search
  - batch enrichment
- Supports an **Organization** workspace:
  - create/join via invite code
  - shared mission thesis + strategic context
  - deterministic duplicate-contact merging
  - export/import org sync packages for cross-account consolidation
- Stores thesis/rules and context documents as chunked memory used in prompts
- Shows operational metrics in a dashboard (distribution, confidence, risk, priority queue)
- Persists data locally and can sync/pull backups from Puter file storage
- Includes a live debug panel for runtime diagnostics

## Tech Stack

- React 18 + TypeScript (strict mode)
- Vite 5
- Tailwind CSS 4
- Recharts
- Papa Parse
- Puter SDK (`https://js.puter.com/v2/`) for auth, AI calls, and file sync
- Vitest + Testing Library

## Requirements

- Node.js 20+ recommended
- npm
- Browser internet access (for Puter SDK and model calls)

## Local Development

1. Install dependencies:
   `npm install`
2. Start the app:
   `npm run dev`
3. Open:
   `http://localhost:3000`

Notes:
- The app currently relies on Puter runtime loaded from `index.html`.
- A local `GEMINI_API_KEY` is not required for the current in-app Puter flow.

## Usage Flow

1. Open **Ingestion** and upload a CSV with contacts.
2. Optionally upload or paste **Thesis & Rules** and **Strategic Context**.
3. Use **Assistant** to search contacts or run enrichment batches.
4. Review results in **Universe** and individual contact detail panels.
5. Monitor summary metrics in **Dashboard**.
6. Use **Settings** for focus mode, model depth, export/import, and cloud sync.

## Scripts

- `npm run dev` - run local dev server
- `npm run build` - type-check and production build
- `npm run preview` - preview production build
- `npm run test` - run unit tests (Vitest)
- `npm run share` - local tunnel helper via `localhost.run`
- `npm run lint` - lint script is present but currently requires eslint packages to be installed/configured

## Project Structure

- `App.tsx` - app shell, tabs, auth, sync, state orchestration
- `components/` - UI modules (Dashboard, Universe, Assistant, Ingestion, Settings, Debug)
- `components/OrganizationHub.tsx` - organization creation/join/invite/dedupe UI
- `services/geminiService.ts` - enrichment/chat orchestration and model fallback logic
- `services/enrichmentGuards.ts` - normalization and quality gates
- `services/csvService.ts` - CSV parsing and mapping
- `services/storageService.ts` - local persistence and cloud sync
- `services/organizationService.ts` - organization, invite, dedupe, and sync package logic
- `services/bridgeMemory.ts` - thesis/context chunk memory
- `types.ts` - shared domain types

## Testing

Run all tests:

`npm run test -- --run`

The repository includes service-level tests for enrichment fallback/error behavior and guardrails, plus a lightweight app smoke test.

## Build Output

Build with:

`npm run build`

Output is generated in:

`dist/`

## Deployment

A GitHub Pages workflow is included at:

`.github/workflows/deploy-pages.yml`

It builds on pushes to `main` and deploys the `dist` artifact.

## Known Limitations

- Runtime dependency on Puter SDK and Puter auth/session behavior
- No dedicated backend service in this repository (client-heavy architecture)
- Linting dependencies are not fully wired by default
