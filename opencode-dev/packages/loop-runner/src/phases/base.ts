import type { PhaseContext, PhaseResult } from '../types.js'

export abstract class Phase {
  protected context: PhaseContext

  constructor(context: PhaseContext) {
    this.context = context
  }

  abstract execute(): Promise<PhaseResult>

  protected success(data?: Record<string, any>): PhaseResult {
    return { success: true, data }
  }

  protected error(error: Error): PhaseResult {
    return { success: false, error }
  }

  protected log(message: string): void {
    console.log(`  ${message}`)
  }

  protected warn(message: string): void {
    console.warn(`  ⚠️  ${message}`)
  }

  protected errorLog(message: string): void {
    console.error(`  ❌ ${message}`)
  }
}
