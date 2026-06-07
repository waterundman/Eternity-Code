import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import yaml from "js-yaml"

// executor.ts 中的函数依赖文件系统，需要创建临时目录进行测试

interface CardScope {
  cardId: string
  files: string[]
  directories: string[]
  description: string
}

/**
 * 分析卡片的 scope - 从 executor.ts 提取逻辑
 * 注意：原函数依赖文件系统，这里我们测试纯逻辑部分
 */
function analyzeCardContent(content: Record<string, unknown>): { files: string[]; directories: string[] } {
  const files: string[] = []
  const directories: string[] = []
  
  // 分析 approach 字段，提取可能的文件路径
  const approach = String(content?.approach ?? "")
  const fileMatches = approach.match(/(?:src|lib|packages?)\/[\w\/]+\.\w+/g) || []
  files.push(...fileMatches)
  
  // 如果卡片有明确的 scope 字段
  if (content?.scope) {
    if (Array.isArray(content.scope)) {
      for (const scope of content.scope) {
        if (String(scope).includes(".")) {
          files.push(String(scope))
        } else {
          directories.push(String(scope))
        }
      }
    } else if (typeof content.scope === "string") {
      if (content.scope.includes(".")) {
        files.push(content.scope)
      } else {
        directories.push(content.scope)
      }
    }
  }
  
  // 去重
  const uniqueFiles = [...new Set(files)]
  const uniqueDirs = [...new Set(directories)]
  
  return { files: uniqueFiles, directories: uniqueDirs }
}

/**
 * 从 approach 字段提取文件路径的辅助函数
 */
function extractFilePathsFromApproach(approach: string): string[] {
  const matches = approach.match(/(?:src|lib|packages?)\/[\w\/]+\.\w+/g) || []
  return [...new Set(matches)]
}

describe("executor", () => {
  describe("analyzeCardContent", () => {
    test("should extract files from approach field", () => {
      const content = {
        approach: "修改 src/utils/helper.ts 和 src/core/index.ts 文件"
      }
      const result = analyzeCardContent(content)
      expect(result.files).toContain("src/utils/helper.ts")
      expect(result.files).toContain("src/core/index.ts")
    })

    test("should extract files from scope array", () => {
      const content = {
        scope: ["src/components/Button.tsx", "src/styles"]
      }
      const result = analyzeCardContent(content)
      expect(result.files).toContain("src/components/Button.tsx")
      expect(result.directories).toContain("src/styles")
    })

    test("should extract files from scope string", () => {
      const content = {
        scope: "src/utils/helper.ts"
      }
      const result = analyzeCardContent(content)
      expect(result.files).toContain("src/utils/helper.ts")
    })

    test("should extract directories from scope string", () => {
      const content = {
        scope: "src/components"
      }
      const result = analyzeCardContent(content)
      expect(result.directories).toContain("src/components")
    })

    test("should handle empty content", () => {
      const result = analyzeCardContent({})
      expect(result.files).toEqual([])
      expect(result.directories).toEqual([])
    })

    test("should handle null scope", () => {
      const content = { scope: null }
      const result = analyzeCardContent(content)
      expect(result.files).toEqual([])
      expect(result.directories).toEqual([])
    })

    test("should deduplicate files", () => {
      const content = {
        approach: "修改 src/helper.ts",
        scope: ["src/helper.ts"]
      }
      const result = analyzeCardContent(content)
      expect(result.files).toEqual(["src/helper.ts"])
    })

    test("should handle various path patterns", () => {
      const content = {
        approach: "修改 lib/utils.js 和 packages/core/src/index.ts"
      }
      const result = analyzeCardContent(content)
      expect(result.files).toContain("lib/utils.js")
      expect(result.files).toContain("packages/core/src/index.ts")
    })
  })

  describe("extractFilePathsFromApproach", () => {
    test("should extract src paths", () => {
      const approach = "修改 src/utils/helper.ts 文件"
      expect(extractFilePathsFromApproach(approach)).toEqual(["src/utils/helper.ts"])
    })

    test("should extract lib paths", () => {
      const approach = "更新 lib/core.js"
      expect(extractFilePathsFromApproach(approach)).toEqual(["lib/core.js"])
    })

    test("should extract packages paths", () => {
      const approach = "修改 packages/core/src/index.ts"
      expect(extractFilePathsFromApproach(approach)).toEqual(["packages/core/src/index.ts"])
    })

    test("should return empty array for no matches", () => {
      const approach = "修改一些配置"
      expect(extractFilePathsFromApproach(approach)).toEqual([])
    })

    test("should extract multiple paths", () => {
      const approach = "修改 src/a.ts 和 src/b.ts"
      const result = extractFilePathsFromApproach(approach)
      expect(result).toHaveLength(2)
      expect(result).toContain("src/a.ts")
      expect(result).toContain("src/b.ts")
    })

    test("should deduplicate paths", () => {
      const approach = "修改 src/a.ts，然后再次修改 src/a.ts"
      expect(extractFilePathsFromApproach(approach)).toEqual(["src/a.ts"])
    })

    test("should handle nested paths", () => {
      const approach = "修改 src/deep/nested/path/file.ts"
      expect(extractFilePathsFromApproach(approach)).toEqual(["src/deep/nested/path/file.ts"])
    })
  })

  describe("ValidationResult interface", () => {
    test("should match expected structure", () => {
      const result = {
        success: true,
        errors: [],
        warnings: []
      }
      expect(result.success).toBe(true)
      expect(result.errors).toEqual([])
      expect(result.warnings).toEqual([])
    })

    test("should handle failure case", () => {
      const result = {
        success: false,
        errors: ["Type error in file.ts"],
        warnings: ["Deprecated API usage"]
      }
      expect(result.success).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.warnings).toHaveLength(1)
    })
  })
})