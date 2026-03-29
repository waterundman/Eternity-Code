import { For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"

export interface LoopHistoryEntry {
  id: string
  status: string
  delta: number
  summary: string
}

interface LoopHistoryProps {
  loops?: LoopHistoryEntry[]
  maxItems?: number
}

export function LoopHistory(props: LoopHistoryProps) {
  const { theme } = useTheme()
  const maxItems = props.maxItems ?? 5
  const loops = () => (props.loops ?? []).slice(0, maxItems)

  const statusIcon = (status: string): string => {
    switch (status) {
      case "completed":
        return "[OK]"
      case "rolled_back":
        return "[X]"
      case "aborted":
        return "[!]"
      default:
        return "[~]"
    }
  }

  const statusColor = (status: string) => {
    switch (status) {
      case "completed":
        return theme.success
      case "rolled_back":
        return theme.error
      case "aborted":
        return theme.warning
      default:
        return theme.textMuted
    }
  }

  return (
    <box flexDirection="column" gap={1}>
      <text fg={theme.text} attributes={TextAttributes.BOLD}>
        LOOP HISTORY
      </text>

      <Show when={loops().length > 0} fallback={<text fg={theme.textMuted}>No loops yet</text>}>
        <For each={loops()}>
          {(loop) => (
            <box flexDirection="column">
              <box flexDirection="row" gap={1}>
                <text fg={statusColor(loop.status)}>{statusIcon(loop.status)}</text>
                <text fg={theme.textMuted}>{loop.id}</text>
                <text fg={loop.delta >= 0 ? theme.success : theme.error}>
                  {loop.delta >= 0 ? "+" : ""}
                  {loop.delta.toFixed(2)}
                </text>
              </box>
              <text fg={theme.textMuted}>{loop.summary || "No summary yet"}</text>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}
