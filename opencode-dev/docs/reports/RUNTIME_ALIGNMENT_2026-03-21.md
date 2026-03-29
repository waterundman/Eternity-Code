# Runtime Alignment Update - 2026-03-21

This note captures the current runtime truth after reviewing the root `docs/` folder and the legacy reports under `opencode-dev/docs/reports`.

## What was aligned in this iteration

- `MetaDesignProvider` now loads `.meta/design.yaml` through the shared runtime loader in `packages/opencode/src/meta/design.ts`.
- The provider now resolves the workspace directory from the active SDK context instead of reading from a hard-coded `process.cwd()` path only.
- `WelcomeScreen` is no longer mock data. It now renders real project state from `.meta/design.yaml`.
- The startup `Home` route now uses the MetaDesign welcome view plus the existing prompt, so startup is finally MetaDesign-aware instead of showing the old prompt-only shell.
- Visible mojibake on the startup screen was removed from the welcome area, MCP hint, and tip label.

## Important behavior clarifications

- The current startup experience is a hybrid `welcome + prompt` screen, not a separate `/chat` route.
- The docs often mention `/chat`, but the current runtime behavior is: users can type a normal prompt directly on the home screen.
- `/meta-init`, `/meta`, `/meta-decide`, `/meta-execute`, `/meta-eval`, and `/meta-optimize` remain the real MetaDesign command surface.

## Still not fully aligned

- Several legacy docs and reports are still affected by encoding corruption and describe behavior that is no longer accurate.
- `CardPanel` still does not implement the richer reject-note flow described in some UI docs.
- Some reports still describe `/meta-execute` as a direct executor, while the current runtime treats it as safe local execution planning.

## Recommended next iteration

1. Implement the reject-note input flow in `CardPanel` so the decision UX matches the reports more closely.
2. Clean or replace the mojibake-heavy GSD/UI docs with one current, source-of-truth runtime guide.
3. Add local sample `.meta/cards`, `.meta/loops`, and `.meta/plans` fixtures so the TUI and dashboard can demonstrate the full loop without requiring a live model run.
