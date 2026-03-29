import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import type { MetaDecisionCard } from "@/meta"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"

interface CardPanelSubmitInput {
  decisions: Record<string, "accepted" | "rejected">
  notes: Record<string, string>
}

interface CardPanelProps {
  cards: MetaDecisionCard[]
  onDecision: (input: CardPanelSubmitInput) => void | Promise<void>
}

function omitKey<T extends Record<string, string>>(value: T, key: string) {
  const { [key]: _ignored, ...rest } = value
  return rest
}

export function CardPanel(props: CardPanelProps) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const [focusedIndex, setFocusedIndex] = createSignal(0)
  const [decisions, setDecisions] = createSignal<Record<string, "accepted" | "rejected">>({})
  const [notes, setNotes] = createSignal<Record<string, string>>({})
  const [expandedCard, setExpandedCard] = createSignal<string | null>(null)
  const [statusMessage, setStatusMessage] = createSignal<string>("")
  const [submitting, setSubmitting] = createSignal(false)

  createEffect(() => {
    const nextDecisions: Record<string, "accepted" | "rejected"> = {}
    const nextNotes: Record<string, string> = {}

    for (const card of props.cards) {
      if (card.decision?.status === "accepted" || card.decision?.status === "rejected") {
        nextDecisions[card.id] = card.decision.status
      }
      const note = card.decision?.note?.trim()
      if (note) nextNotes[card.id] = note
    }

    setDecisions(nextDecisions)
    setNotes(nextNotes)
    setFocusedIndex((prev) => Math.min(prev, Math.max(props.cards.length - 1, 0)))
    setExpandedCard((prev) => (prev && props.cards.some((card) => card.id === prev) ? prev : null))
    setStatusMessage("")
  })

  const confidenceBar = (confidence: number): string => {
    const filled = Math.round(confidence * 10)
    return "#".repeat(filled) + "-".repeat(10 - filled)
  }

  const acceptedCount = createMemo(() => Object.values(decisions()).filter((value) => value === "accepted").length)
  const rejectedCount = createMemo(() => Object.values(decisions()).filter((value) => value === "rejected").length)
  const pendingCount = createMemo(() => props.cards.length - acceptedCount() - rejectedCount())
  const rejectedWithoutNoteCount = createMemo(() => {
    return props.cards.filter((card) => decisions()[card.id] === "rejected" && !notes()[card.id]?.trim()).length
  })

  function focusCard(cardId: string) {
    const index = props.cards.findIndex((card) => card.id === cardId)
    if (index >= 0) setFocusedIndex(index)
  }

  function currentCard() {
    return props.cards[focusedIndex()]
  }

  function setDecision(cardId: string, value: "accepted" | "rejected") {
    setDecisions((prev) => ({ ...prev, [cardId]: value }))
  }

  function clearDecision(cardId: string) {
    setDecisions((prev) => omitKey(prev, cardId))
  }

  function setNote(cardId: string, value: string) {
    const trimmed = value.trim()
    setNotes((prev) => {
      if (!trimmed) return omitKey(prev, cardId)
      return { ...prev, [cardId]: trimmed }
    })
  }

  function clearNote(cardId: string) {
    setNotes((prev) => omitKey(prev, cardId))
  }

  async function promptRejectNote(card: MetaDecisionCard) {
    const result = await DialogPrompt.show(dialog, `Reject ${card.id}`, {
      value: notes()[card.id] ?? "",
      placeholder: "Why should this direction be rejected?",
      description: () => (
        <box flexDirection="column" gap={1}>
          <text fg={theme.textMuted}>Add a short reason so the negative space stays useful.</text>
          <text fg={theme.text}>Goal: {card.content.objective}</text>
          <text fg={theme.textMuted}>Risk: {card.content.risk}</text>
        </box>
      ),
    })

    if (result === null) return false
    setNote(card.id, result)
    return result.trim().length > 0
  }

  async function markAccepted(card: MetaDecisionCard) {
    setDecision(card.id, "accepted")
    clearNote(card.id)
    setExpandedCard((prev) => (prev === card.id ? null : prev))
    setStatusMessage(`${card.id} marked as accepted.`)
  }

  async function markRejected(card: MetaDecisionCard) {
    if (decisions()[card.id] === "rejected") {
      clearDecision(card.id)
      clearNote(card.id)
      setStatusMessage(`${card.id} rejection removed.`)
      return
    }

    setDecision(card.id, "rejected")
    setExpandedCard(card.id)
    const hasNote = await promptRejectNote(card)
    setStatusMessage(
      hasNote
        ? `${card.id} rejected with a recorded note.`
        : `${card.id} rejected. Add a note before saving so negative space has a clear reason.`,
    )
  }

  async function editRejectNote(card: MetaDecisionCard) {
    if (decisions()[card.id] !== "rejected") {
      setStatusMessage(`Reject ${card.id} first before editing its note.`)
      return
    }

    const hasNote = await promptRejectNote(card)
    setExpandedCard(card.id)
    setStatusMessage(
      hasNote
        ? `${card.id} reject note updated.`
        : `${card.id} is still missing a reject note.`,
    )
  }

  async function ensureRejectNotes() {
    const missing = props.cards.filter((card) => decisions()[card.id] === "rejected" && !notes()[card.id]?.trim())

    for (const card of missing) {
      focusCard(card.id)
      setExpandedCard(card.id)
      const hasNote = await promptRejectNote(card)
      if (!hasNote) {
        setStatusMessage(`Reject note required for ${card.id} before saving.`)
        return false
      }
    }

    return true
  }

  async function submitDecisions() {
    if (submitting()) return

    const unresolved = props.cards.find((card) => !decisions()[card.id])
    if (unresolved) {
      focusCard(unresolved.id)
      setExpandedCard(unresolved.id)
      setStatusMessage(`Decide ${unresolved.id} before saving this decision session.`)
      return
    }

    const notesReady = await ensureRejectNotes()
    if (!notesReady) return

    setSubmitting(true)
    setStatusMessage("Saving decision session...")

    try {
      await props.onDecision({
        decisions: decisions(),
        notes: notes(),
      })
      setStatusMessage("Decision session saved.")
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error))
      throw error
    } finally {
      setSubmitting(false)
    }
  }

  useKeyboard((evt) => {
    if (props.cards.length === 0) return
    if (dialog.stack.length > 0) return

    if (evt.name === "tab" || evt.name === "right") {
      setFocusedIndex((prev) => (prev + 1) % props.cards.length)
      evt.preventDefault()
      return
    }
    if (evt.name === "left") {
      setFocusedIndex((prev) => (prev - 1 + props.cards.length) % props.cards.length)
      evt.preventDefault()
      return
    }
    if (evt.name === "up") {
      setFocusedIndex((prev) => Math.max(0, prev - 1))
      evt.preventDefault()
      return
    }
    if (evt.name === "down") {
      setFocusedIndex((prev) => Math.min(props.cards.length - 1, prev + 1))
      evt.preventDefault()
      return
    }

    if (evt.name === "a" && !evt.ctrl && !evt.meta && !evt.shift) {
      const card = currentCard()
      if (!card) return
      void markAccepted(card)
      evt.preventDefault()
      return
    }

    if (evt.name === "r" && !evt.ctrl && !evt.meta && !evt.shift) {
      const card = currentCard()
      if (!card) return
      void markRejected(card)
      evt.preventDefault()
      return
    }

    if (evt.name === "n" && !evt.ctrl && !evt.meta && !evt.shift) {
      const card = currentCard()
      if (!card) return
      void editRejectNote(card)
      evt.preventDefault()
      return
    }

    if ((evt.name === "a" && evt.shift) || evt.name === "A") {
      const next: Record<string, "accepted"> = {}
      props.cards.forEach((card) => {
        next[card.id] = "accepted"
      })
      setDecisions(next)
      setNotes({})
      setStatusMessage("All cards marked as accepted.")
      evt.preventDefault()
      return
    }

    if ((evt.name === "r" && evt.shift) || evt.name === "R") {
      const next: Record<string, "rejected"> = {}
      props.cards.forEach((card) => {
        next[card.id] = "rejected"
      })
      setDecisions(next)
      setExpandedCard(currentCard()?.id ?? props.cards[0]?.id ?? null)
      setStatusMessage("All cards marked as rejected. Add notes before saving.")
      evt.preventDefault()
      return
    }

    if (evt.name === "return" && !evt.ctrl) {
      const card = currentCard()
      if (!card) return
      setExpandedCard((prev) => (prev === card.id ? null : card.id))
      evt.preventDefault()
      return
    }

    if (evt.name === "return" && evt.ctrl) {
      void submitDecisions()
      evt.preventDefault()
      return
    }

    if (evt.name === "escape") {
      if (expandedCard()) {
        setExpandedCard(null)
      } else {
        setStatusMessage("")
      }
      evt.preventDefault()
      return
    }

    if (evt.name === "0") {
      setFocusedIndex(0)
      evt.preventDefault()
    }
  })

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          DECISION PHASE
        </text>
        <text fg={theme.textMuted}>
          [{acceptedCount()} accepted, {rejectedCount()} rejected, {pendingCount()} pending]
        </text>
      </box>

      <text fg={theme.textMuted}>
        Tab: navigate | a/r: accept or reject | n: edit reject note | A/R: mark all | Enter: expand | Ctrl+Enter: save
      </text>

      <Show when={rejectedWithoutNoteCount() > 0}>
        <text fg={theme.warning}>
          {rejectedWithoutNoteCount()} rejected {rejectedWithoutNoteCount() === 1 ? "card is" : "cards are"} still missing a note.
        </text>
      </Show>

      <For each={props.cards}>
        {(card, index) => {
          const isFocused = index() === focusedIndex()
          const isExpanded = expandedCard() === card.id
          const decision = decisions()[card.id]
          const note = notes()[card.id]
          const needsRejectNote = decision === "rejected" && !note?.trim()
          const borderColor =
            decision === "accepted"
              ? theme.success
              : decision === "rejected"
                ? theme.error
                : isFocused
                  ? theme.primary
                  : theme.border

          return (
            <box
              flexDirection="column"
              borderStyle={isFocused ? "double" : "single"}
              borderColor={borderColor}
              padding={1}
              backgroundColor={isFocused ? theme.backgroundPanel : theme.background}
            >
              <box flexDirection="row" justifyContent="space-between">
                <box flexDirection="row" gap={1}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    {card.id}
                  </text>
                  <text fg={theme.textMuted}>[{card.req_refs.join(", ") || "no refs"}]</text>
                </box>
                <Show when={decision}>
                  <text fg={decision === "accepted" ? theme.success : theme.error}>
                    {decision === "accepted" ? "[ACCEPTED]" : needsRejectNote ? "[REJECTED - NOTE NEEDED]" : "[REJECTED]"}
                  </text>
                </Show>
              </box>

              <box flexDirection="column" gap={0}>
                <text fg={theme.text}>Goal: {card.content.objective}</text>
                <Show when={isExpanded}>
                  <text fg={theme.text}>Approach: {card.content.approach}</text>
                </Show>
                <text fg={theme.text}>Benefit: {card.content.benefit}</text>
                <Show when={isExpanded}>
                  <text fg={theme.text}>Cost: {card.content.cost}</text>
                  <text fg={theme.text}>Risk: {card.content.risk}</text>
                </Show>

                <Show when={card.content.warnings.length > 0}>
                  <text fg={theme.warning}>Warn: {card.content.warnings.join(", ")}</text>
                </Show>

                <Show when={decision === "rejected"}>
                  <text fg={needsRejectNote ? theme.warning : theme.textMuted}>
                    Reject note: {note?.trim() ? note : "missing"}
                  </text>
                </Show>

                <box flexDirection="row" gap={1}>
                  <text fg={theme.text}>Confidence:</text>
                  <text fg={theme.primary}>{confidenceBar(card.prediction.confidence)}</text>
                  <text fg={theme.textMuted}>{(card.prediction.confidence * 100).toFixed(0)}%</text>
                </box>
              </box>

              <Show when={isFocused}>
                <box flexDirection="row" gap={2} marginTop={1}>
                  <text fg={theme.textMuted}>[a] Accept</text>
                  <text fg={theme.textMuted}>[r] {decision === "rejected" ? "Clear reject" : "Reject + reason"}</text>
                  <Show when={decision === "rejected"}>
                    <text fg={theme.textMuted}>[n] Edit note</text>
                  </Show>
                  <text fg={theme.textMuted}>[Enter] {isExpanded ? "Collapse" : "Expand"}</text>
                </box>
              </Show>
            </box>
          )
        }}
      </For>

      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>
          Card {Math.min(focusedIndex() + 1, Math.max(props.cards.length, 1))} of {props.cards.length}
        </text>
        <Show when={pendingCount() === 0}>
          <text fg={rejectedWithoutNoteCount() === 0 ? theme.success : theme.warning}>
            {rejectedWithoutNoteCount() === 0
              ? submitting()
                ? "Saving..."
                : "All cards decided. Press Ctrl+Enter to save."
              : "Add reject notes before saving."}
          </text>
        </Show>
      </box>

      <Show when={statusMessage()}>
        <text fg={statusMessage().includes("saved") ? theme.success : theme.warning}>{statusMessage()}</text>
      </Show>
    </box>
  )
}
