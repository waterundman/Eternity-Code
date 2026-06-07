import { randomBytes } from "crypto"

function generateShortId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = randomBytes(3).toString("hex")
  return `${prefix}-${timestamp}${random}`.toUpperCase()
}

export function generateCardId(): string {
  return generateShortId("CARD")
}

export function generatePlanId(): string {
  return generateShortId("PLAN")
}

export function generateNegId(): string {
  return generateShortId("NEG")
}

export function generateLoopId(): string {
  const timestamp = Date.now().toString(36)
  const random = randomBytes(2).toString("hex")
  return `loop-${timestamp}${random}`
}
