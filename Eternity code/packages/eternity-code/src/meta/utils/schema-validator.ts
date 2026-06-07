/**
 * YAML Schema 验证层
 * 使用 zod 对 YAML 文件内容进行运行时验证
 */

import * as fs from "fs"
import yaml from "js-yaml"
import type { z } from "zod"
import { Ok, Err, type Result } from "./result.js"

export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(message)
    this.name = "SchemaValidationError"
  }

  /**
   * 格式化为人类可读的错误信息
   */
  format(): string {
    const lines = [`Schema validation failed: ${this.filePath}`]
    for (const issue of this.issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)"
      lines.push(`  - ${path}: ${issue.message}`)
    }
    return lines.join("\n")
  }
}

/**
 * 读取 YAML 文件并使用 zod schema 验证
 *
 * @param filePath - YAML 文件路径
 * @param schema  - zod schema
 * @returns Ok(data) 或 Err(SchemaValidationError)
 */
export function readYamlWithValidation<T>(
  filePath: string,
  schema: z.ZodType<T>,
): Result<T, SchemaValidationError> {
  let raw: string
  try {
    raw = fs.readFileSync(filePath, "utf8")
  } catch (err) {
    return Err(
      new SchemaValidationError(
        `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
        filePath,
        [],
      ),
    )
  }

  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch (err) {
    return Err(
      new SchemaValidationError(
        `Failed to parse YAML: ${err instanceof Error ? err.message : String(err)}`,
        filePath,
        [],
      ),
    )
  }

  const result = schema.safeParse(parsed)
  if (result.success) {
    return Ok(result.data)
  }

  return Err(new SchemaValidationError(`Schema validation failed: ${filePath}`, filePath, result.error.issues))
}

/**
 * 异步版本 — 读取 YAML 文件并使用 zod schema 验证
 */
export async function readYamlWithValidationAsync<T>(
  filePath: string,
  schema: z.ZodType<T>,
): Promise<Result<T, SchemaValidationError>> {
  let raw: string
  try {
    raw = await fs.promises.readFile(filePath, "utf8")
  } catch (err) {
    return Err(
      new SchemaValidationError(
        `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
        filePath,
        [],
      ),
    )
  }

  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch (err) {
    return Err(
      new SchemaValidationError(
        `Failed to parse YAML: ${err instanceof Error ? err.message : String(err)}`,
        filePath,
        [],
      ),
    )
  }

  const result = schema.safeParse(parsed)
  if (result.success) {
    return Ok(result.data)
  }

  return Err(new SchemaValidationError(`Schema validation failed: ${filePath}`, filePath, result.error.issues))
}

/**
 * 严格读取 — 验证失败时抛出 SchemaValidationError
 *
 * @throws {SchemaValidationError} 当验证失败时
 */
export function readYamlStrict<T>(filePath: string, schema: z.ZodType<T>): T {
  const result = readYamlWithValidation(filePath, schema)
  if (result.ok === true) {
    return result.value
  }
  throw result.error
}
