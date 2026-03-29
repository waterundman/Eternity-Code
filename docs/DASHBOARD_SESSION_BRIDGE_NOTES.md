# Dashboard Session Bridge Notes

## What Changed

The dashboard is now attached to the live TUI session instead of relying on experimental placeholders.

Implemented bridge:

- `POST /api/loop/start`
  Now creates or reuses a real session and queues `/meta`.
- `POST /api/coverage/assess`
  Now runs coverage assessment through the live TUI-backed session bridge.

## Runtime Shape

Bridge registry:

- `opencode-dev/packages/eternity-code/src/meta/dashboard/bridge.ts`

TUI registration:

- `opencode-dev/packages/eternity-code/src/cli/cmd/tui/app.tsx`

Dashboard API usage:

- `opencode-dev/packages/eternity-code/src/meta/dashboard/server.ts`

## Current Behavior

- Dashboard actions reuse the current TUI route session when available.
- If no session is active, loop start creates a new session automatically.
- Loop start navigates the TUI into the loop route after queueing `/meta`.
- Coverage assessment uses the live prompt path instead of a mock or local fake.

## Guardrails

- Loop start is rejected when the runtime phase is not `idle` or `complete`.
- Loop start is rejected while another dashboard-triggered start request is still in flight.
- Dashboard actions require a valid current model selection from the TUI runtime.

## Remaining Follow-up

- Split the large inline dashboard script in `html.ts` into modules.
- Decide whether coverage assessment should always reuse the visible session or create a dedicated background session.
