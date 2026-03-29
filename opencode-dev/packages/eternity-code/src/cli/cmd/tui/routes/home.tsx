import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createEffect, createMemo, Match, on, onMount, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Tips } from "../component/tips"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import { useKV } from "../context/kv"
import { useCommandDialog } from "../component/dialog-command"
import { useLocal } from "../context/local"
import { WelcomeScreen } from "../components/meta/WelcomeScreen"

// TODO: what is the best way to do this?
let once = false

export function Home() {
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const command = useCommandDialog()
  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
  const mcpError = createMemo(() => {
    return Object.values(sync.data.mcp).some((x) => x.status === "failed")
  })

  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })
  const mcpIndicator = createMemo(() => {
    if (mcpError()) return "[!]"
    if (connectedMcpCount() > 0) return "[+]"
    return "[~]"
  })
  const mcpIndicatorColor = createMemo(() => {
    if (mcpError()) return theme.error
    if (connectedMcpCount() > 0) return theme.success
    return theme.textMuted
  })

  const isFirstTimeUser = createMemo(() => sync.data.session.length === 0)
  const tipsHidden = createMemo(() => kv.get("tips_hidden", false))
  const showTips = createMemo(() => {
    if (isFirstTimeUser()) return false
    return !tipsHidden()
  })

  command.register(() => [
    {
      title: tipsHidden() ? "Show tips" : "Hide tips",
      value: "tips.toggle",
      keybind: "tips_toggle",
      category: "System",
      onSelect: (dialog) => {
        kv.set("tips_hidden", !tipsHidden())
        dialog.clear()
      },
    },
  ])

  const Hint = (
    <Show when={connectedMcpCount() > 0}>
      <box flexShrink={0} flexDirection="row" gap={1}>
        <text fg={theme.text}>
          <Switch>
            <Match when={mcpError()}>
              <span style={{ fg: theme.error }}>{mcpIndicator()}</span> MCP errors{" "}
              <span style={{ fg: theme.textMuted }}>ctrl+x s</span>
            </Match>
            <Match when={true}>
              <span style={{ fg: theme.success }}>{mcpIndicator()}</span>{" "}
              {Locale.pluralize(connectedMcpCount(), "{} mcp server", "{} mcp servers")}
            </Match>
          </Switch>
        </text>
      </box>
    </Show>
  )

  let prompt: PromptRef
  const args = useArgs()
  const local = useLocal()
  onMount(() => {
    if (once) return
    if (route.initialPrompt) {
      prompt.set(route.initialPrompt)
      once = true
    } else if (args.prompt) {
      prompt.set({ input: args.prompt, parts: [] })
      once = true
    }
  })

  createEffect(
    on(
      () => sync.ready && local.model.ready,
      (ready) => {
        if (!ready) return
        if (!args.prompt) return
        if (prompt.current?.input !== args.prompt) return
        prompt.submit()
      },
    ),
  )
  const directory = useDirectory()

  return (
    <>
      <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
        <box flexGrow={1} minHeight={0} />
        <box width="100%" maxWidth={92} flexShrink={0} alignItems="center">
          <WelcomeScreen />
        </box>
        <box height={1} minHeight={0} flexShrink={0} />
        <box width="100%" maxWidth={84} zIndex={1000} paddingTop={1} flexShrink={0}>
          <Prompt
            ref={(r) => {
              prompt = r
              promptRef.set(r)
            }}
            hint={Hint}
            workspaceID={route.workspaceID}
          />
        </box>
        <box height={4} minHeight={0} width="100%" maxWidth={84} alignItems="center" paddingTop={2} flexShrink={1}>
          <Show when={showTips()}>
            <Tips />
          </Show>
        </box>
        <box flexGrow={1} minHeight={0} />
        <Toast />
      </box>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0} gap={2}>
        <text fg={theme.textMuted}>{directory()}</text>
        <box gap={1} flexDirection="row" flexShrink={0}>
          <Show when={mcp()}>
            <text fg={theme.text}>
              <span style={{ fg: mcpIndicatorColor() }}>{mcpIndicator()}</span> {connectedMcpCount()} MCP
            </text>
            <text fg={theme.textMuted}>/status</text>
          </Show>
        </box>
        <box flexGrow={1} />
        <box flexShrink={0}>
          <text fg={theme.textMuted}>{Installation.VERSION}</text>
        </box>
      </box>
    </>
  )
}
