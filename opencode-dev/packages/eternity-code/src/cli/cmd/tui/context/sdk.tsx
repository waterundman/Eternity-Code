import { createOpencodeClient, type Event } from "@eternity-code/sdk/v2"
import { createSimpleContext } from "./helper"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { batch, onCleanup, onMount, createSignal } from "solid-js"

export type EventSource = {
  on: (handler: (event: Event) => void) => () => void
  setWorkspace?: (workspaceID?: string) => void
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
  }) => {
    const abort = new AbortController()
    let workspaceID: string | undefined
    let sse: AbortController | undefined
    const [connectionError, setConnectionError] = createSignal<string | null>(null)
    const [connected, setConnected] = createSignal(false)

    function createSDK() {
      return createOpencodeClient({
        baseUrl: props.url,
        signal: abort.signal,
        directory: props.directory,
        fetch: props.fetch,
        headers: props.headers,
        experimental_workspaceID: workspaceID,
      })
    }

    let sdk = createSDK()

    const emitter = createGlobalEmitter<{
      [key in Event["type"]]: Extract<Event, { type: key }>
    }>()

    let queue: Event[] = []
    let timer: Timer | undefined
    let last = 0

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      batch(() => {
        for (const event of events) {
          emitter.emit(event.type, event)
        }
      })
    }

    const handleEvent = (event: Event) => {
      queue.push(event)
      const elapsed = Date.now() - last

      if (timer) return
      if (elapsed < 16) {
        timer = setTimeout(flush, 16)
        return
      }
      flush()
    }

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      ;(async () => {
        try {
          while (true) {
            if (abort.signal.aborted || ctrl.signal.aborted) break
            const events = await sdk.event.subscribe({}, { signal: ctrl.signal })
            setConnectionError(null)
            setConnected(true)

            for await (const event of events.stream) {
              if (ctrl.signal.aborted) break
              handleEvent(event)
            }

            if (timer) clearTimeout(timer)
            if (queue.length > 0) flush()
          }
        } catch (err) {
          if (abort.signal.aborted || ctrl.signal.aborted) return
          const msg = err instanceof Error ? err.message : String(err)
          setConnectionError(msg)
          setConnected(false)
          // Retry after delay
          await new Promise(r => setTimeout(r, 3000))
          if (!abort.signal.aborted && !ctrl.signal.aborted) {
            startSSE()
          }
        }
      })().catch(() => {})
    }

    onMount(() => {
      if (props.events) {
        const unsub = props.events.on(handleEvent)
        onCleanup(unsub)
        setConnected(true)
      } else {
        startSSE()
      }
    })

    onCleanup(() => {
      abort.abort()
      sse?.abort()
      if (timer) clearTimeout(timer)
    })

    return {
      get client() {
        return sdk
      },
      directory: props.directory,
      event: emitter,
      fetch: props.fetch ?? fetch,
      connected,
      connectionError,
      setWorkspace(next?: string) {
        if (workspaceID === next) return
        workspaceID = next
        setConnected(false)
        setConnectionError(null)
        sdk = createSDK()
        props.events?.setWorkspace?.(next)
        if (!props.events) startSSE()
      },
      url: props.url,
    }
  },
})
