/**
 * 提取文本内容（从各种 LLM 响应格式中）
 *
 * 统一处理以下格式：
 * - 纯字符串
 * - { text: string } 对象
 * - { content: string } 对象
 * - { content: Array<{ text?: string; type?: string }> } 对象（如 Anthropic 格式）
 */
export function extractText(response: unknown): string {
  if (typeof response === "string") return response
  if (response && typeof response === "object") {
    const r = response as Record<string, unknown>
    if (typeof r.text === "string") return r.text
    if (typeof r.content === "string") return r.content
    if (Array.isArray(r.content)) {
      return r.content
        .filter((c: unknown) => c && typeof c === "object" && ((c as Record<string, unknown>).type === "text" || typeof (c as Record<string, unknown>).text === "string"))
        .map((c: unknown) => (c as Record<string, unknown>).text as string)
        .join("\n")
    }
  }
  return String(response)
}
