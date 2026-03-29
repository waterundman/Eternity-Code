import { createSignal, onMount } from "solid-js"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { loadMetaDesign } from "@/meta/design"
import type { MetaDesign } from "@/meta/types"

export const { use: useMetaDesign, provider: MetaDesignProvider } = createSimpleContext({
  name: "MetaDesign",
  init: () => {
    const sdk = useSDK()
    const [design, setDesign] = createSignal<MetaDesign | null>(null)
    const [loading, setLoading] = createSignal(true)
    const [error, setError] = createSignal<string | null>(null)

    const cwd = () => sdk.directory ?? process.cwd()

    async function load() {
      setLoading(true)
      setError(null)

      try {
        setDesign(await loadMetaDesign(cwd()))
      } catch (e) {
        setDesign(null)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    }

    async function reload() {
      await load()
    }

    onMount(() => {
      void load()
    })

    return {
      design,
      loading,
      error,
      reload,
      cwd,
      hasDesign: () => design() !== null,
    }
  },
})
