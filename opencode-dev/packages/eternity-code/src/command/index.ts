import { BusEvent } from "@/bus/bus-event"
import { SessionID, MessageID } from "@/session/schema"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import PROMPT_META from "./template/meta.txt"
import PROMPT_META_DECIDE from "./template/meta-decide.txt"
import PROMPT_META_EXECUTE from "./template/meta-execute.txt"
import PROMPT_META_EVAL from "./template/meta-eval.txt"
import PROMPT_META_OPTIMIZE from "./template/meta-optimize.txt"
import PROMPT_META_INIT from "./template/meta-init.txt"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import { loadMetaDesign } from "../meta/index.js"
import { MetaPaths, listMetaEntryPaths, resolveMetaDesignPath } from "../meta/paths.js"
import * as fs from "fs"
import * as path from "path"
import yaml from "js-yaml"

export namespace Command {
  export const Event = {
    Executed: BusEvent.define(
      "command.executed",
      z.object({
        name: z.string(),
        sessionID: SessionID.zod,
        arguments: z.string(),
        messageID: MessageID.zod,
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      source: z.enum(["command", "mcp", "skill"]).optional(),
      // workaround for zod not supporting async functions natively so we use getters
      // https://zod.dev/v4/changelog?id=zfunction
      template: z.promise(z.string()).or(z.string()),
      subtask: z.boolean().optional(),
      hints: z.array(z.string()),
    })
    .meta({
      ref: "Command",
    })

  // for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
  export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

  export function hints(template: string): string[] {
    const result: string[] = []
    const numbered = template.match(/\$\d+/g)
    if (numbered) {
      for (const match of [...new Set(numbered)].sort()) result.push(match)
    }
    if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
    return result
  }

  export const Default = {
    INIT: "init",
    REVIEW: "review",
    META: "meta",
    META_INIT: "meta-init",
    META_DECIDE: "meta-decide",
    META_EXECUTE: "meta-execute",
    META_EVAL: "meta-eval",
    META_OPTIMIZE: "meta-optimize",
    META_RESTRUCTURE: "meta-restructure",
    META_INSIGHT: "meta-insight",
  } as const

  const state = Instance.state(async () => {
    const cfg = await Config.get()
    const metaDesign = await loadMetaDesign(Instance.directory)

    const result: Record<string, Info> = {
      [Default.INIT]: {
        name: Default.INIT,
        description: "create/update AGENTS.md",
        source: "command",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", Instance.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      },
      [Default.REVIEW]: {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        source: "command",
        get template() {
          return PROMPT_REVIEW.replace("${path}", Instance.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      },
    }

    // Always add meta-init command (available even without design.yaml)
    result[Default.META_INIT] = {
      name: Default.META_INIT,
      description: "initialize MetaDesign for this project",
      source: "command",
      get template() {
        if (metaDesign) {
          return `[MetaDesign] .meta/design/design.yaml already exists!\n\nProject: ${metaDesign.project.name}\nStage: ${metaDesign.project.stage}\n\nEdit .meta/design/design.yaml directly to make changes.`
        }
        return PROMPT_META_INIT
      },
      hints: [],
    }

    // Add meta command only if .meta/design.yaml exists
    if (metaDesign) {
      const maxCards = metaDesign.search_policy?.max_cards_per_loop ?? 3
      const lowCoverageReqs = [...(metaDesign.requirements ?? [])]
        .sort((a, b) => (a.coverage ?? 0) - (b.coverage ?? 0))
        .slice(0, 3)
        .map((r) => `  [${r.id}] coverage ${((r.coverage ?? 0) * 100).toFixed(0)}%: ${r.text}`)
        .join("\n")

      const activeNegs = (metaDesign.rejected_directions ?? [])
        .filter((n) => n.status === "active")
        .map((n) => `  [${n.id}] ${n.text}`)
        .join("\n")

      result[Default.META] = {
        name: Default.META,
        description: "run MetaDesign loop to generate improvement cards",
        source: "command",
        get template() {
          return `${PROMPT_META}

Current project: ${metaDesign.project.name} [stage: ${metaDesign.project.stage}]
Core value: ${metaDesign.project.core_value}
Anti value: ${metaDesign.project.anti_value}

Requirements with lowest coverage:
${lowCoverageReqs || "  (none)"}

Rejected directions (DO NOT propose anything in these directions):
${activeNegs || "  (none)"}

Generate exactly ${maxCards} cards.`
        },
        hints: [],
      }

      // Add meta-decide command for decision phase
      result[Default.META_DECIDE] = {
        name: Default.META_DECIDE,
        description: "decide on generated MetaDesign cards (accept/reject)",
        source: "command",
        get template() {
          // Find the latest loop with pending cards
          const loopFiles = listMetaEntryPaths(Instance.directory, "loops", ".yaml")
            .sort()
            .reverse()

          if (loopFiles.length === 0) return PROMPT_META_DECIDE

          const latestLoop = yaml.load(fs.readFileSync(loopFiles[0], "utf8")) as any
          if (!latestLoop.candidates?.presented_cards?.length) return PROMPT_META_DECIDE

          // Load the cards
          const cardFiles = listMetaEntryPaths(Instance.directory, "cards", ".yaml")
          const cards = latestLoop.candidates.presented_cards
            .map((id: string) => {
              const cardPath = cardFiles.find((filePath) =>
                filePath.endsWith(`\\${id}.yaml`) || filePath.endsWith(`/${id}.yaml`),
              )
              if (!cardPath || !fs.existsSync(cardPath)) return null
              return yaml.load(fs.readFileSync(cardPath, "utf8"))
            })
            .filter(Boolean)

          if (cards.length === 0) return PROMPT_META_DECIDE

          // Build context with cards
          let context = `${PROMPT_META_DECIDE}\n\nLoop: ${latestLoop.id}\nStatus: ${latestLoop.status}\n\nPending Cards:\n`
          cards.forEach((card: any, i: number) => {
            context += `\n${i + 1}. ${card.id} [${card.req_refs?.join(", ") || "no refs"}]\n`
            context += `   Objective: ${card.content.objective}\n`
            context += `   Approach: ${card.content.approach}\n`
            context += `   Benefit: ${card.content.benefit}\n`
            context += `   Risk: ${card.content.risk}\n`
            context += `   Confidence: ${(card.prediction.confidence * 100).toFixed(0)}%\n`
          })

          return context
        },
        hints: [],
      }

      // Add meta-execute command for execution-planning phase
      result[Default.META_EXECUTE] = {
        name: Default.META_EXECUTE,
        description: "prepare execution plans for accepted MetaDesign cards",
        source: "command",
        get template() {
          // Find the latest loop with accepted cards
          const loopFiles = listMetaEntryPaths(Instance.directory, "loops", ".yaml")
            .sort()
            .reverse()

          if (loopFiles.length === 0) return PROMPT_META_EXECUTE

          const latestLoop = yaml.load(fs.readFileSync(loopFiles[0], "utf8")) as any
          if (!latestLoop.decision_session?.accepted_cards?.length) return PROMPT_META_EXECUTE

          // Load the accepted cards
          const cardFiles = listMetaEntryPaths(Instance.directory, "cards", ".yaml")
          const acceptedCards = latestLoop.decision_session.accepted_cards
            .map((id: string) => {
              const cardPath = cardFiles.find((filePath) =>
                filePath.endsWith(`\\${id}.yaml`) || filePath.endsWith(`/${id}.yaml`),
              )
              if (!cardPath || !fs.existsSync(cardPath)) return null
              return yaml.load(fs.readFileSync(cardPath, "utf8"))
            })
            .filter(Boolean)

          if (acceptedCards.length === 0) return PROMPT_META_EXECUTE

          // Build context with accepted cards
          let context = `${PROMPT_META_EXECUTE}\n\nLoop: ${latestLoop.id}\n\nAccepted Cards to Execute:\n`
          acceptedCards.forEach((card: any, i: number) => {
            context += `\n${i + 1}. ${card.id} [${card.req_refs?.join(", ") || "no refs"}]\n`
            context += `   Objective: ${card.content.objective}\n`
            context += `   Approach: ${card.content.approach}\n`
            context += `   Benefit: ${card.content.benefit}\n`
          })

          return context
        },
        hints: [],
      }

      // Add meta-eval command for evaluation phase
      result[Default.META_EVAL] = {
        name: Default.META_EVAL,
        description: "evaluate MetaDesign execution results",
        source: "command",
        get template() {
          // Build context with eval factors
          let context = `${PROMPT_META_EVAL}\n\nEval Factors:\n`
          
          // Try to load design synchronously for template
          try {
            const designPath = resolveMetaDesignPath(Instance.directory)
            if (fs.existsSync(designPath)) {
              const design = yaml.load(fs.readFileSync(designPath, "utf8")) as any
              const factors = design.eval_factors ?? []
              factors.forEach((factor: any, i: number) => {
                context += `\n${i + 1}. ${factor.id} - ${factor.name}\n`
                context += `   Type: ${factor.measurement.type}\n`
                context += `   Baseline: ${factor.threshold.baseline}\n`
                context += `   Target: ${factor.threshold.target}\n`
                context += `   Floor: ${factor.threshold.floor}\n`
              })
            }
          } catch (e) {
            // Ignore errors in template generation
          }

          return context
        },
        hints: [],
      }

      // Add meta-optimize command for optimization phase
      result[Default.META_OPTIMIZE] = {
        name: Default.META_OPTIMIZE,
        description: "optimize MetaDesign search strategy based on history",
        source: "command",
        get template() {
          // Build context with loop history
          let context = `${PROMPT_META_OPTIMIZE}\n\nLoop History:\n`
          
          try {
            const designPath = resolveMetaDesignPath(Instance.directory)
            if (fs.existsSync(designPath)) {
              const design = yaml.load(fs.readFileSync(designPath, "utf8")) as any
              const history = design.loop_history ?? {}
              
              context += `\nTotal Loops: ${history.total_loops ?? 0}\n`
              
              const loops = history.loops ?? []
              loops.slice(-5).forEach((loop: any, i: number) => {
                context += `\n${i + 1}. ${loop.loop_id} - ${loop.status}\n`
                context += `   Cards: ${loop.cards_proposed ?? 0} proposed, ${loop.cards_accepted ?? 0} accepted\n`
              })
              
              // Add search policy info
              const policy = design.search_policy ?? {}
              context += `\n\nCurrent Search Policy:\n`
              context += `Mode: ${policy.mode ?? "balanced"}\n`
              context += `Max cards/loop: ${policy.max_cards_per_loop ?? 3}\n`
              
              const sources = policy.candidate_sources ?? []
              sources.forEach((source: any) => {
                context += `${source.source}: ${(source.weight * 100).toFixed(0)}%\n`
              })
            }
          } catch (e) {
            // Ignore errors in template generation
          }

          return context
        },
        hints: [],
      }

      // Add meta-restructure command for SOTA model restructuring
      result[Default.META_RESTRUCTURE] = {
        name: Default.META_RESTRUCTURE,
        description: "trigger SOTA model for global code restructuring",
        source: "command",
        get template() {
          // Build context with quality report
          let context = `You are a SOTA model tasked with global code restructuring.

Your task is to:
1. Analyze the entire codebase for path dependencies, duplicate definitions, and unclear responsibilities
2. Generate a comprehensive restructuring plan
3. The plan will be executed as a full rewrite, not incremental changes

`
          try {
            // Load quality report
            const { assessQuality } = require("../meta/quality-monitor.js")
            const report = assessQuality(Instance.directory)
            
            context += `Quality Report:\n`
            context += `Tech debt density: ${report.tech_debt_density.toFixed(1)} items/loop\n`
            context += `Rollback rate: ${(report.rollback_rate * 100).toFixed(0)}%\n`
            context += `TODO count: ${report.todo_count}\n\n`

            if (report.should_trigger_sota) {
              context += `⚠️  Quality thresholds triggered:\n`
              report.triggered_by.forEach((reason: string) => {
                context += `  - ${reason}\n`
              })
              context += `\n`
            }

            // Load current blueprint
            const blueprintPath = MetaPaths.current(Instance.directory)
            if (fs.existsSync(blueprintPath)) {
              const blueprint = yaml.load(fs.readFileSync(blueprintPath, "utf8")) as any
              context += `Current Blueprint (${blueprint.version}):\n`
              context += `State: ${blueprint.current_state?.split('\n')[0]}\n\n`
            }
          } catch (e) {
            // Ignore errors in template generation
          }

          context += `Output a RESTRUCTURE plan in the following format:
---RESTRUCTURE START---
diagnosis:
  overall_health: （0-1）
  primary_issues:
    - （issue 1）
restructure_plan:
  approach: full_rewrite
  scope:
    - （scope 1）
  preserve:
    - （preserve 1）
  new_architecture: |
    （description）
docs_to_update:
  - （doc 1）
acceptance:
  - （criterion 1）
---RESTRUCTURE END---`

          return context
        },
        hints: [],
      }

      // Add meta-insight command for writing insights
      result[Default.META_INSIGHT] = {
        name: Default.META_INSIGHT,
        description: "write a design insight to the cognition layer",
        source: "command",
        get template() {
          return `Write a design insight based on recent development experience.

An insight is not a requirement or a task - it's the reasoning behind "why we designed it this way".

Output in the following format:
---INSIGHT START---
title: （insight title）
source: （where this insight came from）
category: architecture / product / process / technical
insight: |
  （the core insight - why this decision was made）
implications:
  - （implication 1）
  - （implication 2）
related:
  - （related insight or document）
---INSIGHT END---`
        },
        hints: [],
      }
    }

    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      result[name] = {
        name,
        agent: command.agent,
        model: command.model,
        description: command.description,
        source: "command",
        get template() {
          return command.template
        },
        subtask: command.subtask,
        hints: hints(command.template),
      }
    }
    for (const [name, prompt] of Object.entries(await MCP.prompts())) {
      result[name] = {
        name,
        source: "mcp",
        description: prompt.description,
        get template() {
          // since a getter can't be async we need to manually return a promise here
          return new Promise<string>(async (resolve, reject) => {
            const template = await MCP.getPrompt(
              prompt.client,
              prompt.name,
              prompt.arguments
                ? // substitute each argument with $1, $2, etc.
                  Object.fromEntries(prompt.arguments?.map((argument, i) => [argument.name, `$${i + 1}`]))
                : {},
            ).catch(reject)
            resolve(
              template?.messages
                .map((message) => (message.content.type === "text" ? message.content.text : ""))
                .join("\n") || "",
            )
          })
        },
        hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
      }
    }

    // Add skills as invokable commands
    for (const skill of await Skill.all()) {
      // Skip if a command with this name already exists
      if (result[skill.name]) continue
      result[skill.name] = {
        name: skill.name,
        description: skill.description,
        source: "skill",
        get template() {
          return skill.content
        },
        hints: [],
      }
    }

    return result
  })

  export async function get(name: string) {
    return state().then((x) => x[name])
  }

  export async function list() {
    return state().then((x) => Object.values(x))
  }
}
