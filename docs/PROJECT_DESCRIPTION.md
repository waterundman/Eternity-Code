# Eternity Code

> **MetaDesign-Driven Autonomous Software Engineering**

An AI-powered autonomous iteration system built on [OpenCode](https://github.com/anomalyco/opencode) that transforms software development from "manual iteration" to "AI-driven autonomous iteration" through a structured MetaDesign framework.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  HUMAN LAYER                                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Human Developer                                                │   │
│  │  • Define MetaRequirements (design.yaml)                        │   │
│  │  • Review & Accept/Reject Decision Cards                        │   │
│  │  • Approve Blueprints                                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────┤
│  TUI LAYER  (packages/opencode/src/cli/cmd/tui/)                        │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌─────────┐ │
│  │ Welcome   │ │ Loop      │ │ Sidebar   │ │ CardPanel │ │Anomaly  │ │
│  │ Screen    │ │ Route     │ │ REQ/NEG   │ │ Decision  │ │Panel    │ │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘ └─────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│  META CORE  (packages/opencode/src/meta/)                               │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌─────────┐ │
│  │ context-  │ │ index.ts  │ │ paths.ts  │ │ cards.ts  │ │cognition│ │
│  │ loader.ts │ │ design()  │ │ MetaPaths │ │ writeCard │ │.ts      │ │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘ └─────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│  AGENT DISPATCH LAYER  (meta/agents/)       │ WATCHDOG (meta/watchdog/) │
│  ┌─────────────────────────────────────┐    │ ┌─────────────────────┐   │
│  │ Dispatcher • Registry • Context     │    │ │ Watchdog.guard()    │   │
│  │ Builder • Parsers                   │    │ │ RepetitionDetector  │   │
│  ├─────────────────────────────────────┤    │ │ CircuitBreaker      │   │
│  │ Agent Roles:                        │    │ │ • infinite_loop     │   │
│  │ • card-reviewer (Rubric 4D)         │◄──┤ │ • token_overflow    │   │
│  │ • coverage-assessor                 │    │ │ • hallucination     │   │
│  │ • planner                           │    │ │ • rate_limit        │   │
│  │ • task-executor                     │    │ └─────────────────────┘   │
│  │ • eval-scorer (bash tools)          │    ├───────────────────────────┤
│  │ • contract-drafter/validator        │    │  EXECUTION (meta/execute) │
│  │ • insight-writer                    │    │  ┌─────────────────────┐   │
│  │ • restructure-planner               │    │  │ planner.ts          │   │
│  └─────────────────────────────────────┘    │  │ runner.ts           │   │
│                                              │  │ negotiateContract() │   │
│                                              │  └─────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────┤
│  .meta/ FILE SYSTEM                                                     │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌─────────┐ │
│  │ design/   │ │ cognition/│ │negatives/ │ │execution/ │ │anomalies│ │
│  │ design.yaml│ │blueprints │ │ NEG-*.yaml│ │cards/     │ │Watchdog │ │
│  │ schema/   │ │insights   │ │           │ │plans/     │ │logs     │ │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘ └─────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│  WEB DASHBOARD  (meta/dashboard/)  localhost:7777                       │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌─────────┐ │
│  │ server.ts │ │ html.ts   │ │ REQ       │ │ Loop      │ │Watchdog │ │
│  │ /api/*    │ │ Zero-dep  │ │ Coverage  │ │ History   │ │ Status  │ │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘ └─────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│  TWO-SPEED SYSTEM                                                       │
│  ┌─────────────────────────┐   ┌─────────────────────────────────┐     │
│  │ Weak Model              │   │ SOTA Model                      │     │
│  │ (opencode/mimov2pro)    │   │ (codex/gpt-5.4)                 │     │
│  │ • Daily iteration       │   │ • Weekly restructuring          │     │
│  │ • Execute blueprints    │   │ • Update cognition/             │     │
│  │ • Write logs/cards      │   │ • Test model_assumptions        │     │
│  └─────────────────────────┘   └─────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Core Features

### 1. MetaDesign Framework

The foundation of Eternity Code. A `design.yaml` defines project constraints, requirements, and iteration strategy.

```yaml
project:
  id: my-project
  stage: prototype  # prototype | mvp | growth | mature
  core_value: "..."
  anti_value: "..."

requirements:
  - id: REQ-001
    text: "Feature X"
    priority: p1
    coverage: 0.3
    acceptance_checklist:  # Acceptance Checklist driven
      - id: check-1
        verify: "bun test passes"

constraints:
  immutable_modules: [...]
  compliance: [...]

rejected_directions: [...]  # Negative Space
eval_factors: [...]         # Evaluation factors with real measurement
search_policy: {...}
watchdog: {...}             # Watchdog configuration
two_speed_policy: {...}     # Two-speed development
```

### 2. Loop State Machine

The core iteration mechanism with **8 phases**:

```
① analyze  →  ② generate  →  ③ decide  →  ④ plan
                                        ↓
⑧ close    ←  ⑦ evaluate  ←  ⑥ execute ←  ⑤ contract
```

| Phase | Description |
|-------|-------------|
| **analyze** | Analyze code state, identify improvement opportunities |
| **generate** | Generate Decision Cards (improvement proposals) |
| **decide** | Human or AI reviews and accepts/rejects cards |
| **plan** | Decompose accepted cards into executable tasks |
| **contract** | Negotiate Sprint Contract (verifiable completion criteria) |
| **execute** | Execute tasks with git commit per task |
| **evaluate** | Evaluate results with real tool measurements |
| **close** | Update coverage, log results, trigger optimization |

### 3. Sub-Agent Dispatch Layer

All agent invocations go through the **Dispatcher** — the single entry point:

| Agent Role | Purpose |
|------------|---------|
| **card-reviewer** | Independent 4D Rubric scoring (req_alignment, neg_conflict, cost_honesty, feasibility) |
| **coverage-assessor** | REQ coverage with checklist-driven calculation |
| **planner** | Card → Plan decomposition (3-5 tasks) |
| **task-executor** | Single task execution with fresh context |
| **eval-scorer** | Real bash tool execution for measurements |
| **contract-drafter** | Convert task specs to verifiable criteria |
| **contract-validator** | Validate contract objectivity |
| **insight-writer** | Extract design insights |
| **prediction-auditor** | Audit prediction accuracy |
| **restructure-planner** | Global code quality diagnosis (SOTA) |

### 4. Watchdog System

Real-time anomaly detection with automatic circuit breaking:

**Anomaly Types:**
- `infinite_loop` — Tool call count exceeded threshold
- `token_overflow` — Context exceeds model limit
- `network_error` — Network connectivity issues
- `hallucination_loop` — Same tool+params repeated
- `empty_response` — Model returned empty content
- `rate_limit` — API 429 rate limited

**Circuit Breaker States:**
```
closed ──(failures)──► open ──(timeout)──► half-open ──(success)──► closed
                           │                          │
                           └────────(failure)─────────┘
```

### 5. Two-Speed Development

| Mode | Model | Frequency | Responsibility |
|------|-------|-----------|----------------|
| **Daily** | Weak model (opencode/mimov2pro) | High | Incremental iteration, execute blueprints |
| **Weekly** | SOTA model (codex/gpt-5.4) | Low | Global restructuring, update cognition/ |

### 6. Negative Space (NEG)

Explicitly rejected directions that the system must avoid:
- `permanent` — Never allowed
- `conditional` — Allowed when condition is met
- `phase` — Allowed after specific phase

### 7. Web Dashboard

Browser-based monitoring at `localhost:7777`:
- REQ coverage bars
- NEG status
- EVAL baselines
- Loop history with score deltas
- Card decision status (dual scoring: confidence + weighted)
- Execution plans/tasks with git SHA
- **Watchdog status** (circuit breakers, anomaly logs)

---

## File System Layout (.meta/)

```
.meta/
├── design/
│   ├── design.yaml          # Project definition (full read every loop)
│   └── schema/              # Validation schemas
├── cognition/               # SOTA writes, weak model reads
│   ├── blueprints/
│   │   └── BLUEPRINT-current.yaml  # Current execution intent
│   └── insights/
│       └── INS-*.yaml       # Design insights
├── negatives/               # Full read every loop
│   └── NEG-*.yaml           # Rejected directions
└── execution/
    ├── cards/               # CARD-*.yaml
    ├── plans/               # PLAN-*.yaml
    ├── loops/               # loop-*.yaml (8-phase state machine)
    ├── logs/                # LOG-YYYYMMDD-loopNNN.md
    ├── agent-tasks/         # task-uuid.yaml (sub-agent records)
    └── anomalies/           # ANOMALY-YYYYMMDD.yaml (Watchdog logs)
```

---

## Utility Modules

| Module | Purpose |
|--------|---------|
| `file-io.ts` | Async file operations, atomic writes, LRU cache |
| `validation.ts` | Runtime type validation (no external deps) |
| `errors.ts` | Structured error handling (AppError, ErrorCode) |
| `resource-manager.ts` | Resource cleanup, prevent memory leaks |
| `performance.ts` | Performance monitoring (P50/P95/P99) |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Bun |
| Language | TypeScript |
| Framework | Effect (functional) |
| Frontend | SolidJS + Tailwind CSS |
| API | Hono |
| Database | Drizzle ORM |
| Package Manager | Bun Workspaces |

---

## Quick Start

```bash
# Install
curl -fsSL https://eternity-code.ai/install | bash

# Or via npm
npm i -g eternity-code-ai@latest

# Set API key
export OPENROUTER_API_KEY=your_key

# Start TUI
eternity-code

# Start Dashboard
eternity-code dashboard  # http://localhost:7777

# Run a Loop
/meta run

# View Cards
/meta cards

# Execute selected cards
/meta execute
```

---

## Comparison

| Feature | Eternity Code | Claude Code | GitHub Copilot |
|---------|---------------|-------------|----------------|
| Open Source | ✅ | ❌ | ❌ |
| Auto Iteration | ✅ | ❌ | ❌ |
| Multi-Agent Dispatch | ✅ | ❌ | ❌ |
| Quality Monitoring | ✅ | ❌ | ❌ |
| Circuit Breaking | ✅ | ❌ | ❌ |
| Two-Speed Dev | ✅ | ❌ | ❌ |
| Negative Space | ✅ | ❌ | ❌ |

---

## Project Structure

```
opencode-dev/
├── packages/
│   ├── eternity-code/          # Core MetaDesign system
│   │   └── src/meta/
│   │       ├── agents/         # Sub-Agent dispatch layer
│   │       │   ├── dispatcher.ts
│   │       │   ├── registry.ts
│   │       │   ├── roles/      # 10+ specialized agents
│   │       │   └── parsers/    # Output parsers
│   │       ├── execution/      # Task execution
│   │       ├── watchdog/       # Anomaly monitoring
│   │       ├── dashboard/      # Web panel
│   │       ├── utils/          # Utility modules
│   │       ├── design.ts       # design.yaml management
│   │       ├── loop.ts         # Loop runtime
│   │       ├── cards.ts        # Card management
│   │       ├── execute.ts      # Execution orchestration
│   │       ├── evaluator.ts    # Evaluator
│   │       └── optimizer.ts    # Optimizer
│   ├── console/                # Web console
│   ├── sdk/                    # SDK
│   └── web/                    # Website
├── docs/                       # Documentation
├── specs/                      # Specifications
└── plugin/                     # Plugin system
```

---

## License

MIT
