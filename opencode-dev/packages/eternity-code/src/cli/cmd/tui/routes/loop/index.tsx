import { createSignal, For, on, Show, onCleanup, createEffect } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { Sidebar } from "@tui/components/meta/Sidebar"
import { CardPanel } from "@tui/components/meta/CardPanel"
import { TaskStatusPanel } from "@tui/components/meta/TaskStatusPanel"
import { LoopHistory, type LoopHistoryEntry } from "@tui/components/meta/LoopHistory"
import { useMetaDesign } from "@tui/context/metadesign"
import { TextAttributes } from "@opentui/core"
import { Prompt } from "@tui/component/prompt"
import {
  applyLoopDecisions,
  loadMetaLoopRuntime,
  loadExecutionPlansForLoop,
  type MetaDecisionCard,
  type MetaLoopRecord,
  type MetaLoopRuntime,
} from "@/meta"
import type { ExecutionPlan } from "@/meta/execution/types"

type LoopPhase = "idle" | "analyzing" | "generating" | "decide" | "executing" | "evaluating" | "complete"

const META_COMMANDS = new Set(["meta", "meta-init", "meta-decide", "meta-execute", "meta-eval", "meta-optimize"])

export function Loop() {
  const route = useRouteData("loop")
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const meta = useMetaDesign()

  const [phase, setPhase] = createSignal<LoopPhase>("idle")
  const [cards, setCards] = createSignal<MetaDecisionCard[]>([])
  const [activeLoop, setActiveLoop] = createSignal<MetaLoopRecord | undefined>()
  const [history, setHistory] = createSignal<LoopHistoryEntry[]>([])
  const [showChat, setShowChat] = createSignal(true)
  const [output, setOutput] = createSignal<string[]>([])
  const [showHistory, setShowHistory] = createSignal(false)
  const [refreshing, setRefreshing] = createSignal(false)
  const [currentPlan, setCurrentPlan] = createSignal<ExecutionPlan | null>(null)
  const [showTaskPanel, setShowTaskPanel] = createSignal(false)

  const sidebarWidth = 28
  const historyWidth = () => (showHistory() ? 30 : 0)
  const promptHeight = () => (showChat() ? 10 : 0)
  const decisionHeight = () => (phase() === "decide" && cards().length > 0 ? 20 : 0)
  const taskPanelHeight = () => (showTaskPanel() && currentPlan() ? 20 : 0)
  const mainWidth = () => Math.max(40, dimensions().width - sidebarWidth - historyWidth())
  const contentHeight = () => Math.max(8, dimensions().height - promptHeight() - decisionHeight() - taskPanelHeight() - 2)
  const cwd = () => sdk.directory ?? process.cwd()

  function summarizeLoop(loop: MetaLoopRecord) {
    const proposed = loop.candidates?.presented_cards?.length ?? 0
    const accepted = loop.decision_session?.accepted_cards?.length ?? 0
    const rejected = loop.decision_session?.rejected_cards?.length ?? 0

    if (loop.decision_session) {
      return `Accepted ${accepted}, rejected ${rejected}, proposed ${proposed}`
    }
    if (proposed > 0) {
      return `${proposed} cards waiting for decision`
    }
    return "No summary yet"
  }

  function toHistory(runtime: MetaLoopRuntime): LoopHistoryEntry[] {
    const historyLoops = runtime.design?.loop_history?.loops ?? []
    if (historyLoops.length > 0) {
      return [...historyLoops]
        .reverse()
        .map((loop) => ({
          id: loop.loop_id,
          status: loop.status,
          delta: loop.composite_score_delta ?? 0,
          summary: loop.summary ?? "No summary yet",
        }))
    }

    return runtime.loops.map((loop) => ({
      id: loop.id,
      status: loop.status ?? "pending",
      delta: 0,
      summary: summarizeLoop(loop),
    }))
  }

  function applyRuntime(runtime: MetaLoopRuntime, prefix: string[] = []) {
    const currentLoop = runtime.pendingLoop ?? runtime.latestLoop
    setActiveLoop(currentLoop)
    setCards(runtime.pendingCards)
    setHistory(toHistory(runtime))

    if (!currentLoop) {
      setPhase("idle")
      setOutput(prefix)
      return
    }

    const lines = [...prefix]
    const proposed = currentLoop.candidates?.presented_cards?.length ?? runtime.latestCards.length
    const accepted = currentLoop.decision_session?.accepted_cards?.length ?? 0
    const rejected = currentLoop.decision_session?.rejected_cards?.length ?? 0

    if (runtime.pendingLoop && runtime.pendingCards.length > 0) {
      setPhase("decide")
      lines.push(
        `=== ${runtime.pendingLoop.id} ===`,
        `${runtime.pendingCards.length} cards are waiting for decision.`,
        "Use a/r to mark cards, then press Ctrl+Enter to persist the decision session.",
      )
      setOutput(lines)
      return
    }

    if (currentLoop.status === "running") {
      setPhase("analyzing")
      lines.push(`=== ${currentLoop.id} ===`, "Loop generation is in progress.")
      setOutput(lines)
      return
    }

    if (accepted > 0) {
      if (currentLoop.close?.summary) {
        setPhase("complete")
        lines.push(
          `=== ${currentLoop.id} ===`,
          currentLoop.close.summary,
          ...(currentLoop.evaluation
            ? [`Evaluation delta: ${currentLoop.evaluation.composite_delta?.toFixed(2) ?? "0.00"}`]
            : []),
        )
        setOutput(lines)
        return
      }

      if (currentLoop.evaluation) {
        setPhase("evaluating")
        lines.push(
          `=== ${currentLoop.id} ===`,
          `Evaluation delta: ${currentLoop.evaluation.composite_delta?.toFixed(2) ?? "0.00"}`,
          currentLoop.evaluation.forced_rollback
            ? currentLoop.evaluation.rollback_reason ?? "Rollback required"
            : "Evaluation complete. Run /meta-optimize to refresh search policy.",
        )
        setOutput(lines)
        return
      }

      if ((currentLoop.execution?.plan_ids?.length ?? 0) > 0) {
        const plannedCount = currentLoop.execution?.plan_ids?.length ?? 0
        const plannedCards = currentLoop.execution?.planned_cards?.length ?? accepted
        const preflightStatus = currentLoop.execution?.preflight_status ?? "ready"
        const readyPlans = currentLoop.execution?.ready_plans ?? 0
        const warningPlans = currentLoop.execution?.warning_plans ?? 0
        const blockedPlans = currentLoop.execution?.blocked_plans ?? 0
        setPhase("executing")
        lines.push(
          `=== ${currentLoop.id} ===`,
          `Execution plans ready: ${plannedCount} plans for ${plannedCards} accepted cards.`,
          `Preflight: ${preflightStatus.toUpperCase()} | ready ${readyPlans} | warning ${warningPlans} | blocked ${blockedPlans}`,
          ...(currentLoop.execution?.blockers?.length
            ? currentLoop.execution.blockers.slice(0, 3).map((item) => `[WARN] ${item}`)
            : currentLoop.execution?.warnings?.length
              ? currentLoop.execution.warnings.slice(0, 3).map((item) => `[WARN] ${item}`)
              : []),
          currentLoop.execution?.summary ??
            (preflightStatus === "blocked"
              ? "Resolve the blocked plan targets in .meta/execution/plans/*.yaml, then rerun /meta-execute."
              : "Review .meta/execution/plans/*.yaml, implement the accepted cards, then run /meta-eval."),
        )
        setOutput(lines)
        return
      }

      setPhase("executing")
      lines.push(
        `=== ${currentLoop.id} ===`,
        `Decision complete: ${accepted} accepted, ${rejected} rejected, ${proposed} proposed.`,
        "Run /meta-execute to prepare safe plans for the accepted cards, then use /meta-eval after implementation lands.",
      )
      setOutput(lines)
      return
    }

    if (currentLoop.decision_session) {
      setPhase("complete")
      lines.push(
        `=== ${currentLoop.id} ===`,
        `Decision complete: ${accepted} accepted, ${rejected} rejected, ${proposed} proposed.`,
        "All rejected cards have been written back into negative space.",
      )
      setOutput(lines)
      return
    }

    setPhase("idle")
    setOutput(lines)
  }

  async function refreshLoopState(prefix: string[] = []) {
    setRefreshing(true)
    try {
      await meta.reload()
      if (route.sessionID) {
        await sync.session.sync(route.sessionID).catch(() => {})
      }
      const runtime = await loadMetaLoopRuntime(cwd())
      applyRuntime(runtime, prefix)

      // Load execution plans if in executing phase
      const targetLoop = runtime.pendingLoop ?? runtime.latestLoop
      if (targetLoop?.execution?.plan_ids?.length) {
        const plans = loadExecutionPlansForLoop(cwd(), targetLoop.id)
        if (plans.length > 0) {
          setCurrentPlan(plans[0])
          setShowTaskPanel(true)
        }
      } else {
        setCurrentPlan(null)
        setShowTaskPanel(false)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setOutput((prev) => [...prev, "", `[ERROR] ${message}`])
    } finally {
      setRefreshing(false)
    }
  }

  createEffect(
    on(
      () => route.sessionID,
      () => {
        void refreshLoopState()
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => meta.design(),
      () => {
        setHistory((prev) => (prev.length > 0 ? prev : []))
      },
      { defer: true },
    ),
  )

  const offCommandExecuted = sdk.event.on("command.executed", (evt) => {
    if (!META_COMMANDS.has(evt.properties.name)) return
    if (route.sessionID && evt.properties.sessionID !== route.sessionID) return

    setTimeout(() => {
      void refreshLoopState([`[OK] /${evt.properties.name} finished. Reloading loop state...`, ""])
    }, 50)
  })
  onCleanup(offCommandExecuted)

  useKeyboard((evt) => {
    if (evt.name === "c" && !evt.ctrl && !evt.meta) {
      setShowChat((prev) => !prev)
      evt.preventDefault()
      return
    }

    if (evt.name === "h" && !evt.ctrl && !evt.meta) {
      setShowHistory((prev) => !prev)
      evt.preventDefault()
      return
    }

    if (evt.name === "t" && !evt.ctrl && !evt.meta) {
      setShowTaskPanel((prev) => !prev)
      evt.preventDefault()
      return
    }

    if (evt.name === "q" && !evt.ctrl && !evt.meta) {
      if (phase() !== "idle") {
        setOutput((prev) => [...prev, "", "Loop aborted by user."])
        setPhase("idle")
      }
      evt.preventDefault()
    }
  })

  async function handleTaskConfirm(taskId: string, confirmed: boolean) {
    if (confirmed) {
      setOutput((prev) => [...prev, `[OK] Task ${taskId} confirmed.`])
      toast.show({
        variant: "success",
        message: `Task ${taskId} confirmed`,
        duration: 3000,
      })
    } else {
      setOutput((prev) => [...prev, `[WARN] Task ${taskId} rejected.`])
      toast.show({
        variant: "warning",
        message: `Task ${taskId} rejected`,
        duration: 3000,
      })
    }
    await refreshLoopState()
  }

  async function handleTaskSkip(taskId: string) {
    setOutput((prev) => [...prev, `[OK] Task ${taskId} skipped.`])
    toast.show({
      variant: "info",
      message: `Task ${taskId} skipped`,
      duration: 3000,
    })
    await refreshLoopState()
  }

  async function handleRollback(planId: string) {
    setOutput((prev) => [...prev, `[WARN] Rolling back plan ${planId}...`])
    toast.show({
      variant: "warning",
      message: `Rolling back ${planId}`,
      duration: 5000,
    })
    await refreshLoopState()
  }

  async function handleDecision(input: {
    decisions: Record<string, "accepted" | "rejected">
    notes: Record<string, string>
  }) {
    const loop = activeLoop()
    if (!loop?.id) return

    try {
      const result = await applyLoopDecisions(cwd(), loop.id, input.decisions, input.notes)
      toast.show({
        variant: "success",
        message: `${loop.id}: accepted ${result.acceptedCards.length}, rejected ${result.rejectedCards.length}`,
        duration: 4000,
      })
      await refreshLoopState([
        "[OK] Decision session saved.",
        `Loop: ${result.loopId}`,
        `Accepted: ${result.acceptedCards.length}`,
        `Rejected: ${result.rejectedCards.length}`,
        ...(Object.keys(input.notes).length > 0 ? [`Reject notes captured: ${Object.keys(input.notes).length}`] : []),
        ...(result.newNegatives.length > 0 ? [`Negatives written: ${result.newNegatives.join(", ")}`] : []),
        "",
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.show({
        variant: "error",
        message,
        duration: 5000,
      })
      setOutput((prev) => [...prev, "", `[ERROR] ${message}`])
    }
  }

  return (
    <box width={dimensions().width} height={dimensions().height} flexDirection="row">
      <Sidebar width={sidebarWidth} />

      <box flexDirection="column" width={mainWidth()}>
        <scrollbox width="100%" height={contentHeight()}>
          <box flexDirection="column" padding={1}>
            <Show when={phase() !== "idle" || refreshing()}>
              <box flexDirection="row" gap={1} marginBottom={1}>
                <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                  Phase: {refreshing() ? "REFRESHING" : phase().toUpperCase()}
                </text>
                <Show when={refreshing() || phase() === "analyzing" || phase() === "generating"}>
                  <text fg={theme.textMuted}>...</text>
                </Show>
              </box>
            </Show>

            <Show when={meta.loading()}>
              <text fg={theme.textMuted}>Loading .meta/design/design.yaml...</text>
            </Show>

            <Show when={meta.error()}>
              <text fg={theme.error}>{meta.error()}</text>
            </Show>

            <For each={output()}>
              {(line) => {
                let color = theme.text
                if (line.startsWith("[OK]")) color = theme.success
                if (line.startsWith("[ERROR]")) color = theme.error
                if (line.startsWith("[WARN]")) color = theme.warning
                if (line.startsWith("===")) color = theme.primary

                return <text fg={color}>{line}</text>
              }}
            </For>

            <Show when={phase() === "idle" && output().length === 0}>
              <box flexDirection="column" gap={1} marginTop={2}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  Eternity Code MetaDesign Loop
                </text>
                <text fg={theme.textMuted}>
                  {meta.design()?.project?.name
                    ? `${meta.design()!.project.name} [stage: ${meta.design()!.project.stage}]`
                    : "No .meta/design/design.yaml detected yet."}
                </text>
                <text fg={theme.text}>Available commands:</text>
                <text fg={theme.textMuted}>  /meta         Start a new loop</text>
                <text fg={theme.textMuted}>  /meta-init    Initialize .meta/ for this project</text>
                <text fg={theme.textMuted}>  /meta-decide  Review pending cards</text>
                <text fg={theme.textMuted}>  /meta-execute Prepare execution plans for accepted cards</text>
                <text fg={theme.textMuted}>  /meta-eval    Evaluate results</text>
                <text fg={theme.textMuted}>  /meta-optimize Optimize search strategy</text>
                <text fg={theme.textMuted}> </text>
                <text fg={theme.textMuted}>Use the prompt below to continue the loop.</text>
                <text fg={theme.textMuted}>Press c to hide/show the prompt area.</text>
                <text fg={theme.textMuted}>Press h to toggle loop history.</text>
                <text fg={theme.textMuted}>Press t to toggle task execution panel.</text>
              </box>
            </Show>
          </box>
        </scrollbox>

        <Show when={phase() === "decide" && cards().length > 0}>
          <scrollbox width="100%" height={decisionHeight()}>
            <CardPanel cards={cards()} onDecision={handleDecision} />
          </scrollbox>
        </Show>

        <Show when={showTaskPanel() && currentPlan()}>
          <scrollbox width="100%" height={taskPanelHeight()}>
            <TaskStatusPanel
              plan={currentPlan()}
              onTaskConfirm={handleTaskConfirm}
              onTaskSkip={handleTaskSkip}
              onRollback={handleRollback}
            />
          </scrollbox>
        </Show>

        <Show when={showChat()}>
          <box flexShrink={0} borderStyle="single" borderColor={theme.border} padding={1}>
            <Prompt sessionID={route.sessionID} />
          </box>
        </Show>

        <box height={1} backgroundColor={theme.background}>
          <text fg={theme.textMuted}>
            Eternity Code | {meta.design()?.project?.name ?? "No project"} | Phase: {phase()} | Session:{" "}
            {route.sessionID ?? "none"}
          </text>
        </box>
      </box>

      <Show when={showHistory()}>
        <box width={30} backgroundColor={theme.background} padding={1} borderStyle="single" borderColor={theme.border}>
          <LoopHistory loops={history()} maxItems={10} />
        </box>
      </Show>
    </box>
  )
}
