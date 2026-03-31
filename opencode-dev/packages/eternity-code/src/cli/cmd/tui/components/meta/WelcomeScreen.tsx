import { TextAttributes } from "@opentui/core"
import { Logo } from "@tui/component/logo"
import { useMetaDesign } from "@tui/context/metadesign"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import { Show, createMemo } from "solid-js"

function coverageBar(coverage: number): string {
  const filled = Math.max(0, Math.min(8, Math.round(coverage * 8)))
  return "#".repeat(filled) + "-".repeat(8 - filled)
}

function formatDate(value?: string) {
  if (!value) return "not yet"
  return value.slice(0, 10)
}

function formatDelta(value?: number) {
  if (value === undefined) return "n/a"
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`
}

export function WelcomeScreen() {
  const { theme } = useTheme()
  const meta = useMetaDesign()
  const sdk = useSDK()

  const design = createMemo(() => meta.design())
  const requirements = createMemo(() => design()?.requirements ?? [])
  const averageCoverage = createMemo(() => {
    if (requirements().length === 0) return 0
    const total = requirements().reduce((sum, item) => sum + (item.coverage ?? 0), 0)
    return total / requirements().length
  })
  const activeConstraintCount = createMemo(() => {
    const current = design()
    if (!current) return 0
    return (
      (current.constraints?.immutable_modules?.length ?? 0) +
      (current.constraints?.stable_interfaces?.length ?? 0) +
      (current.constraints?.performance_budget?.length ?? 0) +
      (current.constraints?.compliance?.length ?? 0) +
      (current.project.tech_stack?.forbidden?.length ?? 0)
    )
  })
  const activeNegatives = createMemo(
    () => design()?.rejected_directions?.filter((item) => item.status === "active").length ?? 0,
  )
  const pendingReviewNegatives = createMemo(
    () => design()?.rejected_directions?.filter((item) => item.status === "pending_review").length ?? 0,
  )
  const lastLoop = createMemo(() => {
    const loops = design()?.loop_history?.loops ?? []
    return loops.length > 0 ? loops[loops.length - 1] : undefined
  })
  const lastLoopDeltaColor = createMemo(() => {
    const value = lastLoop()?.composite_score_delta
    if (value === undefined) return theme.textMuted
    return value >= 0 ? theme.success : theme.error
  })

  return (
    <box flexDirection="column" alignItems="center" justifyContent="center" gap={1}>
      <Logo />

      <Show when={!meta.loading()} fallback={<text fg={theme.textMuted}>Loading project context...</text>}>
        <Show when={!sdk.connectionError()} fallback={
          <box flexDirection="column" alignItems="center" gap={1}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Eternity Code
            </text>
            <text fg={theme.error}>Server connection failed</text>
            <text fg={theme.textMuted}>{sdk.connectionError()}</text>
            <text fg={theme.textMuted}>Retrying automatically...</text>
          </box>
        }>
          <Show when={!meta.error()} fallback={<text fg={theme.error}>{meta.error()}</text>}>
            <Show
              when={design()}
              fallback={
                <box flexDirection="column" alignItems="center" gap={1}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    Eternity Code
                  </text>
                  <text fg={theme.textMuted}>No MetaDesign found in this workspace.</text>
                  <text fg={theme.text}>
                    Run <text attributes={TextAttributes.BOLD}>/meta-init</text> to create `.meta/design/design.yaml`.
                  </text>
                  <text fg={theme.textMuted}>Then use /meta to start the first loop.</text>
                  <text fg={theme.textMuted}>You can also type a normal prompt below and work without MetaDesign.</text>
                </box>
              }
            >
              {(current) => (
                <box flexDirection="column" alignItems="center" gap={1}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    Eternity Code
                  </text>
                  <box flexDirection="row" gap={2}>
                    <text fg={theme.text} attributes={TextAttributes.BOLD}>
                      {current().project.name}
                    </text>
                    <text fg={theme.textMuted}>stage: {current().project.stage}</text>
                    <text fg={theme.textMuted}>
                      loop #{current().loop_history?.total_loops ?? current().loop_history?.loops?.length ?? 0}
                    </text>
                  </box>

                  <box flexDirection="row" gap={2}>
                    <text fg={theme.textMuted}>Requirements</text>
                    <text fg={theme.text}>{coverageBar(averageCoverage())}</text>
                    <text fg={theme.textMuted}>
                      avg {(averageCoverage() * 100).toFixed(0)}% coverage across {requirements().length}
                    </text>
                  </box>

                  <box flexDirection="row" gap={2}>
                    <text fg={theme.textMuted}>Constraints</text>
                    <text fg={theme.text}>{activeConstraintCount()} tracked</text>
                  </box>

                  <box flexDirection="row" gap={2}>
                    <text fg={theme.textMuted}>Negatives</text>
                    <text fg={theme.text}>
                      {activeNegatives()} active / {pendingReviewNegatives()} pending review
                    </text>
                  </box>

                  <box flexDirection="row" gap={2}>
                    <text fg={theme.textMuted}>Last loop</text>
                    <text fg={theme.text}>{formatDate(current().loop_history?.last_loop_at)}</text>
                    <text fg={lastLoopDeltaColor()}>{formatDelta(lastLoop()?.composite_score_delta)}</text>
                    <Show when={lastLoop()?.status}>
                      <text fg={theme.textMuted}>{lastLoop()?.status}</text>
                    </Show>
                  </box>

                  <text fg={theme.text}>
                    Run <text attributes={TextAttributes.BOLD}>/meta</text> to start the next loop.
                  </text>
                  <text fg={theme.textMuted}>Use /meta-decide, /meta-execute, /meta-eval, and /meta-optimize as the loop advances.</text>
                  <text fg={theme.textMuted}>Or type a normal prompt below if you want to stay in standard chat mode.</text>
                </box>
              )}
            </Show>
          </Show>
        </Show>
      </Show>
    </box>
  )
}
