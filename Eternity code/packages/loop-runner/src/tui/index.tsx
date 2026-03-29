import React from 'react'
import { Box, Text, useApp, useInput } from 'ink'

export interface CardDecisionProps {
  cards: Array<{
    id: string
    objective: string
    confidence: number
  }>
  onDecision: (accepted: string[], rejected: string[]) => void
}

export const CardDecision: React.FC<CardDecisionProps> = ({ cards, onDecision }) => {
  const [selected, setSelected] = React.useState<Record<string, 'accepted' | 'rejected' | null>>({})
  const [currentIndex, setCurrentIndex] = React.useState(0)
  const { exit } = useApp()
  
  useInput((input, key) => {
    if (key.return) {
      // Toggle selection
      const cardId = cards[currentIndex].id
      const current = selected[cardId]
      
      if (current === null || current === undefined) {
        setSelected({ ...selected, [cardId]: 'accepted' })
      } else if (current === 'accepted') {
        setSelected({ ...selected, [cardId]: 'rejected' })
      } else {
        setSelected({ ...selected, [cardId]: null })
      }
    }
    
    if (key.upArrow) {
      setCurrentIndex(Math.max(0, currentIndex - 1))
    }
    
    if (key.downArrow) {
      setCurrentIndex(Math.min(cards.length - 1, currentIndex + 1))
    }
    
    if (input === 'a') {
      // Accept all
      const allAccepted: Record<string, 'accepted'> = {}
      cards.forEach(card => {
        allAccepted[card.id] = 'accepted'
      })
      setSelected(allAccepted)
    }
    
    if (input === 'r') {
      // Reject all
      const allRejected: Record<string, 'rejected'> = {}
      cards.forEach(card => {
        allRejected[card.id] = 'rejected'
      })
      setSelected(allRejected)
    }
    
    if (input === 'c') {
      // Confirm and exit
      const accepted = cards
        .filter(card => selected[card.id] === 'accepted')
        .map(card => card.id)
      
      const rejected = cards
        .filter(card => selected[card.id] === 'rejected')
        .map(card => card.id)
      
      onDecision(accepted, rejected)
      exit()
    }
    
    if (input === 'q') {
      exit()
    }
  })
  
  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Box, { marginBottom: 1 },
      React.createElement(Text, { bold: true }, 'Decision Cards')
    ),
    React.createElement(Box, { marginBottom: 1 },
      React.createElement(Text, { dimColor: true }, '↑/↓: Navigate | Enter: Cycle | a: Accept All | r: Reject All | c: Confirm | q: Quit')
    ),
    cards.map((card, index) => {
      const status = selected[card.id]
      const isCurrent = index === currentIndex
      
      let statusText = '[ ]'
      let statusColor = 'white'
      
      if (status === 'accepted') {
        statusText = '[✓]'
        statusColor = 'green'
      } else if (status === 'rejected') {
        statusText = '[✗]'
        statusColor = 'red'
      }
      
      return React.createElement(Box, { key: card.id, marginLeft: isCurrent ? 2 : 0 },
        React.createElement(Text, { color: isCurrent ? 'cyan' : 'white' },
          isCurrent ? '▶ ' : '  '
        ),
        React.createElement(Text, { color: statusColor }, statusText),
        React.createElement(Text, null, ` ${card.id}`),
        React.createElement(Text, { dimColor: true }, ` - ${card.objective.slice(0, 50)}...`),
        React.createElement(Text, { color: 'yellow' }, ` (${(card.confidence * 100).toFixed(0)}%)`)
      )
    })
  )
}

export interface LoopProgressProps {
  phase: string
  status: 'running' | 'completed' | 'failed'
  details?: string
}

export const LoopProgress: React.FC<LoopProgressProps> = ({ phase, status, details }) => {
  const statusIcon = status === 'running' ? '⏳' : status === 'completed' ? '✅' : '❌'
  const statusColor = status === 'running' ? 'yellow' : status === 'completed' ? 'green' : 'red'
  
  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Box, null,
      React.createElement(Text, { color: statusColor }, statusIcon),
      React.createElement(Text, { bold: true }, ` Phase: ${phase}`),
      React.createElement(Text, { color: statusColor }, ` [${status}]`)
    ),
    details && React.createElement(Box, { marginLeft: 2 },
      React.createElement(Text, { dimColor: true }, details)
    )
  )
}

export interface SummaryTableProps {
  title: string
  data: Array<{
    label: string
    value: string
    color?: string
  }>
}

export const SummaryTable: React.FC<SummaryTableProps> = ({ title, data }) => {
  return React.createElement(Box, { flexDirection: 'column', marginTop: 1 },
    React.createElement(Text, { bold: true, underline: true }, title),
    data.map((item, index) =>
      React.createElement(Box, { key: index, marginLeft: 2 },
        React.createElement(Text, null, `${item.label}: `),
        React.createElement(Text, { color: item.color || 'white' }, item.value)
      )
    )
  )
}

export interface ProgressBarProps {
  current: number
  total: number
  label?: string
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ current, total, label }) => {
  const width = 30
  const progress = Math.min(1, current / total)
  const filled = Math.round(progress * width)
  const empty = width - filled
  
  const bar = '█'.repeat(filled) + '░'.repeat(empty)
  const percentage = Math.round(progress * 100)
  
  return React.createElement(Box, null,
    label && React.createElement(Text, null, `${label} `),
    React.createElement(Text, { color: 'cyan' }, bar),
    React.createElement(Text, null, ` ${percentage}% (${current}/${total})`)
  )
}
