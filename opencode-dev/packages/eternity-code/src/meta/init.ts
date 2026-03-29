import path from "path"
import fs from "fs/promises"
import yaml from "js-yaml"
import type { MetaDesign } from "./types.js"
import { MetaPaths } from "./paths.js"

type MetaStage = MetaDesign["project"]["stage"]

export interface MetaInitOptions {
  projectName?: string
  stage?: MetaStage
}

export interface MetaInitResult {
  created: boolean
  projectName: string
  stage: MetaStage
  designPath: string
  createdPaths: string[]
  summary: string
}

export async function metaInit(cwd: string, options: MetaInitOptions = {}): Promise<MetaInitResult> {
  const designPath = MetaPaths.design(cwd)
  const relativeDesignPath = path.relative(cwd, designPath) || ".meta/design/design.yaml"

  const existing = await loadExistingDesign(designPath)
  if (existing) {
    return {
      created: false,
      projectName: existing.project.name,
      stage: existing.project.stage,
      designPath,
      createdPaths: [],
      summary: [
        "[MetaDesign] design.yaml already exists.",
        "",
        `Project: ${existing.project.name}`,
        `Stage: ${existing.project.stage}`,
        "",
        "No files were changed.",
        "",
        "Next:",
        `1. Edit ${relativeDesignPath} directly to refine requirements and constraints.`,
        "2. Run /meta to start the next improvement loop.",
      ].join("\n"),
    }
  }

  const context = await inferProjectContext(cwd, options)
  const createdPaths = [
    ".meta/design/",
    ".meta/design/schema/",
    ".meta/cognition/",
    ".meta/cognition/insights/",
    ".meta/cognition/blueprints/",
    ".meta/execution/",
    ".meta/execution/cards/",
    ".meta/execution/plans/",
    ".meta/execution/loops/",
    ".meta/execution/logs/",
    ".meta/execution/agent-tasks/",
    ".meta/negatives/",
    relativeDesignPath
  ]

  await Promise.all([
    fs.mkdir(path.dirname(designPath), { recursive: true }),
    fs.mkdir(MetaPaths.schema(cwd), { recursive: true }),
    fs.mkdir(MetaPaths.insights(cwd), { recursive: true }),
    fs.mkdir(MetaPaths.blueprints(cwd), { recursive: true }),
    fs.mkdir(MetaPaths.cards(cwd), { recursive: true }),
    fs.mkdir(MetaPaths.plans(cwd), { recursive: true }),
    fs.mkdir(MetaPaths.loops(cwd), { recursive: true }),
    fs.mkdir(MetaPaths.logs(cwd), { recursive: true }),
    fs.mkdir(MetaPaths.agentTasks(cwd), { recursive: true }),
    fs.mkdir(MetaPaths.negatives(cwd), { recursive: true }),
  ])

  const now = new Date().toISOString()
  const design: MetaDesign & {
    _schema_version: string
    _schema_type: string
    project: MetaDesign["project"] & {
      created_at: string
      updated_at: string
    }
  } = {
    _schema_version: "1.0.0",
    _schema_type: "meta_design",
    project: {
      id: crypto.randomUUID(),
      name: context.projectName,
      stage: context.stage,
      core_value: `Deliver the core workflow of ${context.projectName} clearly and reliably.`,
      anti_value: "Do not trade away clarity or maintainability for short-term feature volume.",
      tech_stack: {
        primary: context.techStack,
        forbidden: [],
      },
      created_at: now,
      updated_at: now,
    },
    requirements: [
      {
        id: "REQ-001",
        text: `Users can complete the primary workflow of ${context.projectName} end-to-end without blocking errors.`,
        priority: "p0",
        coverage: 0,
        coverage_note: "Initial scaffold created by /meta-init.",
        last_checked: now,
        signal: {
          type: "behavior",
          spec: "The core workflow succeeds for a representative happy-path scenario.",
        },
      },
    ],
    constraints: {
      immutable_modules: [],
      stable_interfaces: [],
      performance_budget: [],
      compliance: [],
    },
    rejected_directions: [],
    eval_factors: [
      {
        id: "EVAL-001",
        name: "Core workflow completion",
        role: {
          type: "objective",
        },
        measurement: {
          type: "metric",
          spec: "Share of critical workflow steps that can be completed successfully.",
        },
        threshold: {
          baseline: "0%",
          floor: "60%",
          target: "90%",
        },
        relations: {
          weight: 1,
        },
        lifecycle: {
          active_from: context.stage,
        },
      },
    ],
    search_policy: {
      mode: "balanced",
      max_cards_per_loop: 3,
      exploration_rate: 0.25,
      candidate_sources: [
        { source: "coverage_gap", weight: 0.45 },
        { source: "eval_regression", weight: 0.3 },
        { source: "tech_debt", weight: 0.15 },
        { source: "free_exploration", weight: 0.1 },
      ],
    },
    loop_history: {
      total_loops: 0,
      last_loop_id: "",
      last_loop_at: now,
      loops: [],
    },
    updated_at: now,
  }

  await fs.writeFile(designPath, yaml.dump(design, { lineWidth: 120 }), "utf8")

  return {
    created: true,
    projectName: context.projectName,
    stage: context.stage,
    designPath,
    createdPaths,
    summary: [
      "[MetaDesign] Initialized project metadata.",
      "",
      `Project: ${context.projectName}`,
      `Stage: ${context.stage}`,
      `Tech stack: ${context.techStack.join(", ")}`,
      "",
      "Created:",
      ...createdPaths.map((item) => `- ${item}`),
      "",
      "Next:",
      `1. Edit ${relativeDesignPath} to refine requirements, guardrails, and eval factors.`,
      "2. Run /meta to generate the first improvement loop.",
    ].join("\n"),
  }
}

async function inferProjectContext(cwd: string, options: MetaInitOptions) {
  const pkg = await readPackageJson(cwd)
  const folderName = path.basename(cwd)
  const rawName = options.projectName?.trim() || pkg?.name?.trim() || folderName

  return {
    projectName: normalizeProjectName(rawName),
    stage: options.stage ?? "mvp",
    techStack: detectTechStack(pkg),
  }
}

async function loadExistingDesign(designPath: string): Promise<MetaDesign | null> {
  try {
    const content = await fs.readFile(designPath, "utf8")
    return yaml.load(content) as MetaDesign
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === "ENOENT") return null
    throw error
  }
}

async function readPackageJson(cwd: string): Promise<any | null> {
  const pkgPath = path.join(cwd, "package.json")
  try {
    const content = await fs.readFile(pkgPath, "utf8")
    return JSON.parse(content)
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === "ENOENT") return null
    return null
  }
}

function normalizeProjectName(input: string) {
  return input
    .replace(/^@[^/]+\//, "")
    .replace(/[-_]+/g, " ")
    .trim() || "project"
}

function detectTechStack(pkg: any | null) {
  const dependencies = {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
  }

  const stack = new Set<string>()
  if (pkg) stack.add("node")
  if (pkg?.packageManager?.toLowerCase().includes("bun")) stack.add("bun")
  if ("typescript" in dependencies) stack.add("typescript")
  if ("react" in dependencies) stack.add("react")
  if ("solid-js" in dependencies) stack.add("solid")
  if ("vue" in dependencies) stack.add("vue")
  if ("svelte" in dependencies) stack.add("svelte")
  if ("next" in dependencies) stack.add("nextjs")
  if ("vite" in dependencies) stack.add("vite")

  return stack.size > 0 ? Array.from(stack) : ["unknown"]
}
