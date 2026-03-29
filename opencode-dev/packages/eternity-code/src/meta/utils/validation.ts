/**
 * 运行时类型验证模块
 * 提供轻量级的类型验证，无需引入外部库
 */

/**
 * 验证错误
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly expected: string,
    public readonly actual: unknown
  ) {
    super(message)
    this.name = "ValidationError"
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      path: this.path,
      expected: this.expected,
      actual: this.actual,
    }
  }
}

/**
 * 验证结果
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: ValidationError }

/**
 * 类型验证器接口
 */
export interface Validator<T> {
  validate(data: unknown, path?: string): ValidationResult<T>
}

/**
 * 基础类型验证器
 */
export const validators = {
  string: {
    validate(data: unknown, path = "root"): ValidationResult<string> {
      if (typeof data === "string") {
        return { success: true, data }
      }
      return {
        success: false,
        error: new ValidationError(
          `Expected string at ${path}, got ${typeof data}`,
          path,
          "string",
          data
        ),
      }
    },
  } satisfies Validator<string>,

  number: {
    validate(data: unknown, path = "root"): ValidationResult<number> {
      if (typeof data === "number" && !isNaN(data)) {
        return { success: true, data }
      }
      return {
        success: false,
        error: new ValidationError(
          `Expected number at ${path}, got ${typeof data}`,
          path,
          "number",
          data
        ),
      }
    },
  } satisfies Validator<number>,

  boolean: {
    validate(data: unknown, path = "root"): ValidationResult<boolean> {
      if (typeof data === "boolean") {
        return { success: true, data }
      }
      return {
        success: false,
        error: new ValidationError(
          `Expected boolean at ${path}, got ${typeof data}`,
          path,
          "boolean",
          data
        ),
      }
    },
  } satisfies Validator<boolean>,

  null: {
    validate(data: unknown, path = "root"): ValidationResult<null> {
      if (data === null) {
        return { success: true, data }
      }
      return {
        success: false,
        error: new ValidationError(
          `Expected null at ${path}, got ${typeof data}`,
          path,
          "null",
          data
        ),
      }
    },
  } satisfies Validator<null>,

  undefined: {
    validate(data: unknown, path = "root"): ValidationResult<undefined> {
      if (data === undefined) {
        return { success: true, data }
      }
      return {
        success: false,
        error: new ValidationError(
          `Expected undefined at ${path}, got ${typeof data}`,
          path,
          "undefined",
          data
        ),
      }
    },
  } satisfies Validator<undefined>,
}

/**
 * 可选类型验证器
 */
export function optional<T>(validator: Validator<T>): Validator<T | undefined> {
  return {
    validate(data: unknown, path = "root"): ValidationResult<T | undefined> {
      if (data === undefined) {
        return { success: true, data: undefined }
      }
      return validator.validate(data, path) as ValidationResult<T | undefined>
    },
  }
}

/**
 * 可空类型验证器
 */
export function nullable<T>(validator: Validator<T>): Validator<T | null> {
  return {
    validate(data: unknown, path = "root"): ValidationResult<T | null> {
      if (data === null) {
        return { success: true, data: null }
      }
      return validator.validate(data, path) as ValidationResult<T | null>
    },
  }
}

/**
 * 数组类型验证器
 */
export function array<T>(validator: Validator<T>): Validator<T[]> {
  return {
    validate(data: unknown, path = "root"): ValidationResult<T[]> {
      if (!Array.isArray(data)) {
        return {
          success: false,
          error: new ValidationError(
            `Expected array at ${path}, got ${typeof data}`,
            path,
            "array",
            data
          ),
        }
      }

      const result: T[] = []
      for (let i = 0; i < data.length; i++) {
        const itemResult = validator.validate(data[i], `${path}[${i}]`)
        if (!itemResult.success) {
          return itemResult as ValidationResult<T[]>
        }
        result.push(itemResult.data)
      }

      return { success: true, data: result }
    },
  }
}

/**
 * 对象类型验证器
 */
export function object<T extends Record<string, unknown>>(schema: {
  [K in keyof T]: Validator<T[K]>
}): Validator<T> {
  return {
    validate(data: unknown, path = "root"): ValidationResult<T> {
      if (typeof data !== "object" || data === null || Array.isArray(data)) {
        return {
          success: false,
          error: new ValidationError(
            `Expected object at ${path}, got ${Array.isArray(data) ? "array" : typeof data}`,
            path,
            "object",
            data
          ),
        }
      }

      const result: Record<string, unknown> = {}
      const obj = data as Record<string, unknown>

      for (const [key, validator] of Object.entries(schema)) {
        const fieldResult = (validator as Validator<unknown>).validate(obj[key], `${path}.${key}`)
        if (!fieldResult.success) {
          return fieldResult as ValidationResult<T>
        }
        result[key] = fieldResult.data
      }

      return { success: true, data: result as T }
    },
  }
}

/**
 * 枚举类型验证器
 */
export function enumValue<T extends string | number>(...values: T[]): Validator<T> {
  return {
    validate(data: unknown, path = "root"): ValidationResult<T> {
      if (values.includes(data as T)) {
        return { success: true, data: data as T }
      }
      return {
        success: false,
        error: new ValidationError(
          `Expected one of [${values.join(", ")}] at ${path}, got ${JSON.stringify(data)}`,
          path,
          `enum(${values.join("|")})`,
          data
        ),
      }
    },
  }
}

/**
 * 联合类型验证器
 */
export function union<T>(...validators: Validator<T>[]): Validator<T> {
  return {
    validate(data: unknown, path = "root"): ValidationResult<T> {
      for (const validator of validators) {
        const result = validator.validate(data, path)
        if (result.success) {
          return result
        }
      }
      return {
        success: false,
        error: new ValidationError(
          `No matching type at ${path} for value ${JSON.stringify(data)}`,
          path,
          "union",
          data
        ),
      }
    },
  }
}

/**
 * 安全验证函数
 */
export function safeValidate<T>(validator: Validator<T>, data: unknown): T | null {
  const result = validator.validate(data)
  return result.success ? result.data : null
}

/**
 * 严格验证函数（抛出异常）
 */
export function strictValidate<T>(validator: Validator<T>, data: unknown): T {
  const result = validator.validate(data)
  if (!result.success) {
    throw result.error
  }
  return result.data
}

/**
 * MetaDesign 验证器
 */
export const MetaDesignValidator = object({
  _schema_version: optional(validators.string),
  project: object({
    id: validators.string,
    name: validators.string,
    stage: enumValue("prototype", "mvp", "growth", "mature"),
    core_value: validators.string,
    anti_value: validators.string,
  }),
  requirements: array(
    object({
      id: validators.string,
      text: validators.string,
      priority: enumValue("p0", "p1", "p2"),
      coverage: validators.number,
    })
  ),
})

/**
 * AgentTask 验证器
 */
export const AgentTaskValidator = object({
  id: validators.string,
  role_id: validators.string,
  triggered_by: validators.string,
  input: {
    validate(data: unknown, path = "root"): ValidationResult<Record<string, unknown>> {
      if (typeof data === "object" && data !== null && !Array.isArray(data)) {
        return { success: true, data: data as Record<string, unknown> }
      }
      return {
        success: false,
        error: new ValidationError(
          `Expected object at ${path}, got ${typeof data}`,
          path,
          "object",
          data
        ),
      }
    },
  } satisfies Validator<Record<string, unknown>>,
  status: enumValue("pending", "running", "done", "failed"),
})

/**
 * 验证 YAML 内容
 */
export function validateYamlContent<T>(
  content: string,
  validator: Validator<T>
): ValidationResult<T> {
  try {
    const yaml = require("js-yaml")
    const data = yaml.load(content)
    return validator.validate(data)
  } catch (error) {
    return {
      success: false,
      error: new ValidationError(
        `Failed to parse YAML: ${error}`,
        "root",
        "valid YAML",
        content
      ),
    }
  }
}
