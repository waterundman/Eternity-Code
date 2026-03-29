import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { For, Show, createMemo, createSignal } from "solid-js"
import type { ExecutionPlan, ExecutionTask } from "@/meta/execution/types"

interface TaskStatusPanelProps {
  plan: ExecutionPlan | null
  onTaskConfirm?: (taskId: string, confirmed: boolean) => void | Promise<void>
  onTaskSkip?: (taskId: string) => void | Promise<void>
  onRollback?: (planId: string) => void | Promise<void>
}

export function TaskStatusPanel(props: TaskStatusPanelProps) {
  const { theme } = useTheme()
  const [focusedIndex, setFocusedIndex] = createSignal(0)
  const [expandedTask, setExpandedTask] = createSignal<string | null>(null)

  const tasks = createMemo(() => props.plan?.tasks ?? [])
  const planStatus = createMemo(() => props.plan?.status ?? "pending")

  const statusColor = (status: string) => {
    switch (status) {
      case "done":
        return theme.success
      case "running":
        return theme.primary
      case "failed":
        return theme.error
      case "skipped":
        return theme.textMuted
      default:
        return theme.text
    }
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case "done":
        return "✓"
      case "running":
        return "●"
      case "failed":
        return "✗"
      case "skipped":
        return "~"
      default:
        return "○"
    }
  }

  const completedCount = createMemo(() => tasks().filter((t) => t.status === "done").length)
  const failedCount = createMemo(() => tasks().filter((t) => t.status === "failed").length)
  const runningCount = createMemo(() => tasks().filter((t) => t.status === "running").length)

  useKeyboard((evt) => {
    if (tasks().length === 0) return

    if (evt.name === "tab" || evt.name === "down") {
      setFocusedIndex((prev) => (prev + 1) % tasks().length)
      evt.preventDefault()
      return
    }
    if (evt.name === "up") {
      setFocusedIndex((prev) => (prev - 1 + tasks().length) % tasks().length)
      evt.preventDefault()
      return
    }
    if (evt.name === "return") {
      const task = tasks()[focusedIndex()]
      if (task) {
        setExpandedTask((prev) => (prev === task.id ? null : task.id))
      }
      evt.preventDefault()
      return
    }
    if (evt.name === "y" && !evt.ctrl && !evt.meta) {
      const task = tasks()[focusedIndex()]
      if (task && task.status === "running" && props.onTaskConfirm) {
        void props.onTaskConfirm(task.id, true)
      }
      evt.preventDefault()
      return
    }
    if (evt.name === "n" && !evt.ctrl && !evt.meta) {
      const task = tasks()[focusedIndex()]
      if (task && task.status === "running" && props.onTaskConfirm) {
        void props.onTaskConfirm(task.id, false)
      }
      evt.preventDefault()
      return
    }
    if (evt.name === "s" && !evt.ctrl && !evt.meta) {
      const task = tasks()[focusedIndex()]
      if (task && (task.status === "pending" || task.status === "failed") && props.onTaskSkip) {
        void props.onTaskSkip(task.id)
      }
      evt.preventDefault()
      return
    }
  })

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          EXECUTION STATUS
        </text>
        <text fg={theme.textMuted}>
          [{completedCount()} done, {runningCount()} running, {failedCount()} failed]
        </text>
      </box>

      <Show when={props.plan}>
        <box flexDirection="row" gap={2}>
          <text fg={theme.textMuted}>Plan:</text>
          <text fg={theme.text}>{props.plan!.id}</text>
          <text fg={statusColor(planStatus())}>[{planStatus().toUpperCase()}]</text>
        </box>
      </Show>

      <Show when={props.plan?.interpretation}>
        <text fg={theme.textMuted}>{props.plan!.interpretation}</text>
      </Show>

      <text fg={theme.textMuted}>Tab/navigate | Enter: expand | y/n: confirm/reject | s: skip</text>

      <For each={tasks()}>
        {(task, index) => {
          const isFocused = index() === focusedIndex()
          const isExpanded = expandedTask() === task.id

          return (
            <box
              flexDirection="column"
              borderStyle={isFocused ? "double" : "single"}
              borderColor={isFocused ? theme.primary : theme.border}
              padding={1}
              backgroundColor={isFocused ? theme.backgroundPanel : theme.background}
            >
              <box flexDirection="row" justifyContent="space-between">
                <box flexDirection="row" gap={1}>
                  <text fg={statusColor(task.status)}>{statusIcon(task.status)}</text>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    {task.spec.title}
                  </text>
                </box>
                <text fg={statusColor(task.status)}>[{task.status}]</text>
              </box>

              <Show when={isExpanded}>
                <box flexDirection="column" gap={0} marginTop={1}>
                  <text fg={theme.textMuted}>Description: {task.spec.description}</text>
                  <text fg={theme.textMuted}>Done when: {task.spec.definition_of_done}</text>

                  <Show when={task.spec.files_to_modify.length > 0}>
                    <text fg={theme.textMuted}>Files:</text>
                    <For each={task.spec.files_to_modify}>
                      {(file) => <text fg={theme.text}>  - {file}</text>}
                    </For>
                  </Show>

                  <Show when={task.spec.must_not.length > 0}>
                    <text fg={theme.warning}>Must not:</text>
                    <For each={task.spec.must_not}>
                      {(rule) => <text fg={theme.warning}>  - {rule}</text>}
                    </For>
                  </Show>

                  <Show when={task.error}>
                    <text fg={theme.error}>Error: {task.error}</text>
                  </Show>

                  <Show when={task.git_sha}>
                    <text fg={theme.textMuted}>Commit: {task.git_sha?.slice(0, 7)}</text>
                  </Show>
                </box>
              </Show>

              <Show when={isFocused}>
                <box flexDirection="row" gap={2} marginTop={1}>
                  <text fg={theme.textMuted}>[Enter] {isExpanded ? "Collapse" : "Expand"}</text>
                  <Show when={task.status === "running"}>
                    <text fg={theme.success}>[y] Confirm</text>
                    <text fg={theme.error}>[n] Reject</text>
                  </Show>
                  <Show when={task.status === "pending" || task.status === "failed"}>
                    <text fg={theme.textMuted}>[s] Skip</text>
                  </Show>
                </box>
              </Show>
            </box>
          )
        }}
      </For>

      <Show when={tasks().length === 0}>
        <text fg={theme.textMuted}>No tasks in current plan.</text>
      </Show>

      <Show when={props.plan && planStatus() !== "done" && planStatus() !== "rolled_back"}>
        <box flexDirection="row" gap={2} marginTop={1}>
          <text fg={theme.textMuted}>
            Progress: {completedCount()}/{tasks().length} tasks
          </text>
          <Show when={failedCount() > 0 && props.onRollback}>
            <text fg={theme.error} attributes={TextAttributes.BOLD}>
              [!] Rollback
            </text>
          </Show>
        </box>
      </Show>
    </box>
  )
}
