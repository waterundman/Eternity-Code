# Dashboard Decision Runtime Notes

## Current Capability

Dashboard now supports persisting decisions for an already-generated pending loop through `POST /api/loop/decide`.

This path is no longer an experimental placeholder. It now:

- validates that the target cards are still pending
- requires a complete decision set for the visible pending loop
- writes card decisions back to `.meta/cards`
- updates loop state in `.meta/loops`
- writes rejected directions when cards are rejected
- records prompt feedback signals for accepted and rejected cards

## Current Boundary

Dashboard still does **not** start a brand-new loop on its own.

- `POST /api/loop/decide`: real
- `POST /api/loop/start`: still experimental

The missing piece for loop start is a real session bridge, not more dashboard-only state.

## Frontend Contract

The dashboard decision UI now expects:

- every pending card must be explicitly accepted or rejected before submit
- rejected cards may include an optional rejection note
- rejection notes are sent to the backend and persisted with the card decision

## Follow-up

If we keep pushing this area, the next high-value step is:

1. Attach dashboard loop start to a real interactive session bridge.
2. Reuse the same bridge for live phase streaming instead of relying only on filesystem state.
