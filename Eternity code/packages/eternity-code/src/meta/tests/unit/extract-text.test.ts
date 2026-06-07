import { describe, test, expect } from "bun:test"
import { extractText } from "../../utils/extract-text.js"

describe("extractText", () => {
  // ─── 纯字符串输入 ───

  test("should return string as-is", () => {
    expect(extractText("hello world")).toBe("hello world")
  })

  test("should handle empty string", () => {
    expect(extractText("")).toBe("")
  })

  // ─── { text: string } 对象 ───

  test("should extract text from { text } object", () => {
    expect(extractText({ text: "extracted" })).toBe("extracted")
  })

  test("should handle { text: '' } object", () => {
    expect(extractText({ text: "" })).toBe("")
  })

  // ─── { content: string } 对象 ───

  test("should extract text from { content } string object", () => {
    expect(extractText({ content: "content text" })).toBe("content text")
  })

  // ─── { content: Array } 对象 (Anthropic 格式) ───

  test("should extract text from content array with type='text'", () => {
    const input = {
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
    }
    expect(extractText(input)).toBe("first\nsecond")
  })

  test("should extract text from content array with text field only", () => {
    const input = {
      content: [{ text: "only text" }],
    }
    expect(extractText(input)).toBe("only text")
  })

  test("should filter out non-text items in content array", () => {
    const input = {
      content: [
        { type: "text", text: "valid" },
        { type: "image", source: {} },
        { type: "text", text: "also valid" },
      ],
    }
    expect(extractText(input)).toBe("valid\nalso valid")
  })

  test("should handle empty content array", () => {
    expect(extractText({ content: [] })).toBe("")
  })

  // ─── 边界条件 ───

  test("should handle null input", () => {
    expect(extractText(null)).toBe("null")
  })

  test("should handle undefined input", () => {
    expect(extractText(undefined)).toBe("undefined")
  })

  test("should handle number input", () => {
    expect(extractText(42)).toBe("42")
  })

  test("should handle boolean input", () => {
    expect(extractText(true)).toBe("true")
  })

  test("should handle object with no text or content", () => {
    expect(extractText({ foo: "bar" })).toBe("[object Object]")
  })

  // ─── 优先级测试 ───

  test("should prefer text over content when both exist", () => {
    expect(extractText({ text: "preferred", content: "ignored" })).toBe("preferred")
  })

  test("should prefer content string over content array", () => {
    // content 是字符串时直接返回，不会解析数组
    expect(extractText({ content: "string content" })).toBe("string content")
  })
})
