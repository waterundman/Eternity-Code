import { For, Show, createMemo } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import { useMetaDesign } from "@tui/context/metadesign"

interface SidebarProps {
  width?: number
}

export function Sidebar(props: SidebarProps) {
  const { theme } = useTheme()
  const meta = useMetaDesign()

  const width = props.width ?? 26
  const innerWidth = width - 4

  const coverageBar = (coverage: number): string => {
    const filled = Math.round(coverage * 8)
    return "#".repeat(filled) + "-".repeat(8 - filled)
  }

  const activeNegatives = createMemo(() => meta.design()?.rejected_directions?.filter((item) => item.status === "active") ?? [])
  const recentLoops = createMemo(() => meta.design()?.loop_history?.loops?.slice(-4).reverse() ?? [])

  return (
    <box width={width} flexDirection="column" backgroundColor={theme.background} padding={1}>
      <Show when={!meta.loading()} fallback={<text fg={theme.textMuted}>Loading...</text>}>
        <Show
          when={meta.design()}
          fallback={
            <box flexDirection="column" gap={1}>
              <text fg={theme.textMuted}>No MetaDesign</text>
              <text fg={theme.textMuted}>run /meta-init</text>
            </box>
          }
        >
          {(design) => (
            <box flexDirection="column" gap={1}>
              <box flexDirection="column">
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  {design().project.name.slice(0, innerWidth)}
                </text>
                <text fg={theme.textMuted}>stage: {design().project.stage}</text>
              </box>

              <text fg={theme.textMuted}>{"-".repeat(innerWidth)}</text>

              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                REQUIREMENTS
              </text>
              <For each={design().requirements?.slice(0, 4)}>
                {(req) => (
                  <box flexDirection="column">
                    <box flexDirection="row" gap={1}>
                      <text fg={theme.textMuted}>{req.id}</text>
                      <text fg={theme.text}>{coverageBar(req.coverage ?? 0)}</text>
                      <text fg={theme.textMuted}>{((req.coverage ?? 0) * 100).toFixed(0)}%</text>
                    </box>
                    <text fg={theme.textMuted}>{req.text.slice(0, innerWidth - 2)}</text>
                  </box>
                )}
              </For>

              <text fg={theme.textMuted}>{"-".repeat(innerWidth)}</text>

              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                CONSTRAINTS
              </text>
              <For each={design().constraints?.immutable_modules?.slice(0, 2)}>
                {(module) => <text fg={theme.textMuted}>LOCK {module.path.slice(0, innerWidth - 5)}</text>}
              </For>
              <For each={design().constraints?.performance_budget?.slice(0, 2)}>
                {(budget) => (
                  <text fg={theme.textMuted}>
                    {budget.hard ? "HARD" : "SOFT"} {budget.metric.slice(0, 8)} {budget.threshold}
                  </text>
                )}
              </For>

              <text fg={theme.textMuted}>{"-".repeat(innerWidth)}</text>

              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                NEGATIVES ({activeNegatives().length})
              </text>
              <For each={activeNegatives().slice(0, 3)}>
                {(negative) => (
                  <box flexDirection="column">
                    <text fg={theme.textMuted}>{negative.id}</text>
                    <text fg={theme.textMuted}>{negative.text.slice(0, innerWidth - 2)}</text>
                  </box>
                )}
              </For>
              <Show when={activeNegatives().length > 3}>
                <text fg={theme.textMuted}>... and {activeNegatives().length - 3} more</text>
              </Show>

              <text fg={theme.textMuted}>{"-".repeat(innerWidth)}</text>

              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                EVAL BASELINES
              </text>
              <For each={design().eval_factors?.slice(0, 3)}>
                {(factor) => (
                  <box flexDirection="row" justifyContent="space-between">
                    <text fg={theme.textMuted}>{factor.name.slice(0, 10)}</text>
                    <text fg={theme.text}>{factor.threshold.baseline}</text>
                  </box>
                )}
              </For>

              <text fg={theme.textMuted}>{"-".repeat(innerWidth)}</text>

              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                LOOPS
              </text>
              <For each={recentLoops()}>
                {(loop) => {
                  const statusIcon = loop.status === "completed" ? "[OK]" : loop.status === "rolled_back" ? "[X]" : "[~]"
                  const statusColor =
                    loop.status === "completed" ? theme.success : loop.status === "rolled_back" ? theme.error : theme.textMuted
                  const delta = loop.composite_score_delta ?? 0

                  return (
                    <box flexDirection="row" gap={1}>
                      <text fg={statusColor}>{statusIcon}</text>
                      <text fg={theme.textMuted}>#{loop.loop_id.split("-")[1]}</text>
                      <text fg={delta >= 0 ? theme.success : theme.error}>
                        {delta >= 0 ? "+" : ""}
                        {delta.toFixed(2)}
                      </text>
                    </box>
                  )
                }}
              </For>
              <Show when={recentLoops().length === 0}>
                <text fg={theme.textMuted}>No loops yet</text>
              </Show>
            </box>
          )}
        </Show>
      </Show>
    </box>
  )
}
