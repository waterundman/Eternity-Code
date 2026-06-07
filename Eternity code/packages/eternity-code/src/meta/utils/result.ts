/**
 * Result<T, E> 类型 — 类似 Rust 的 Result 枚举
 * 用于函数式错误处理，替代 try/catch 或 null 返回
 */

export type Result<T, E = Error> = OkType<T> | ErrType<E>

interface OkType<T> {
  readonly ok: true
  readonly value: T
  isOk(): true
  isErr(): false
  unwrap(): T
  unwrapOr(_fallback: T): T
}

interface ErrType<E> {
  readonly ok: false
  readonly error: E
  isOk(): false
  isErr(): true
  unwrap(): never
  unwrapOr<T>(fallback: T): T
}

class OkImpl<T> implements OkType<T> {
  readonly ok = true as const

  constructor(readonly value: T) {}

  isOk(): true {
    return true
  }

  isErr(): false {
    return false
  }

  unwrap(): T {
    return this.value
  }

  unwrapOr(_fallback: T): T {
    return this.value
  }
}

class ErrImpl<E> implements ErrType<E> {
  readonly ok = false as const

  constructor(readonly error: E) {}

  isOk(): false {
    return false
  }

  isErr(): true {
    return true
  }

  unwrap(): never {
    throw this.error instanceof Error ? this.error : new Error(String(this.error))
  }

  unwrapOr<T>(fallback: T): T {
    return fallback
  }
}

/** Create a successful Result */
export function Ok<T>(value: T): Result<T, never> {
  return new OkImpl(value) as unknown as Result<T, never>
}

/** Create a failed Result */
export function Err<E>(error: E): Result<never, E> {
  return new ErrImpl(error) as unknown as Result<never, E>
}

/** Type guard for Ok */
export function isOk<T, E>(result: Result<T, E>): result is OkType<T> {
  return result.ok === true
}

/** Type guard for Err */
export function isErr<T, E>(result: Result<T, E>): result is ErrType<E> {
  return result.ok === false
}
