/**
 * Execution Logs Module
 *
 * 每次 loop 结束后，写入执行日志。
 * 文件名格式: LOG-YYYYMMDD-loop-NNN.md
 */

import * as path from "path"
import * as fs from "fs"
import { MetaPaths, listMetaEntryPaths } from "../paths.js"

export interface LoopLog {
  loop_id: string
  date: string
  model: string
  blueprint_version?: string
  completed: string[]
  problems: string[]
  incomplete: string[]
  tech_debt: string[]
  next_loop_suggestions: string[]
}

export function writeLoopLog(cwd: string, log: LoopLog): void {
  const dir = MetaPaths.logs(cwd)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const dateStr = log.date.replace(/-/g, "")
  const filename = `LOG-${dateStr}-${log.loop_id}.md`
  const content = formatLog(log)

  fs.writeFileSync(path.join(dir, filename), content)
}

export function loadRecentLogs(cwd: string, n: number): string[] {
  return listMetaEntryPaths(cwd, "logs", ".md")
    .sort()
    .reverse()
    .slice(0, n)
    .map((filePath) => {
      try {
        return fs.readFileSync(filePath, "utf8")
      } catch {
        return null
      }
    })
    .filter((l): l is string => l !== null)
}

export function loadAllLogs(cwd: string): string[] {
  return listMetaEntryPaths(cwd, "logs", ".md")
    .sort()
    .reverse()
    .map((filePath) => {
      try {
        return fs.readFileSync(filePath, "utf8")
      } catch {
        return null
      }
    })
    .filter((l): l is string => l !== null)
}

function formatLog(log: LoopLog): string {
  const section = (title: string, items: string[]) =>
    `## ${title}\n${items.length ? items.map(i => `- ${i}`).join("\n") : "- 无"}`

  return [
    `# LOG — ${log.loop_id}`,
    ``,
    `日期: ${log.date}`,
    `执行模型: ${log.model}`,
    log.blueprint_version ? `蓝图版本: ${log.blueprint_version}` : "",
    ``,
    section("完成的工作", log.completed),
    ``,
    section("遇到的问题", log.problems),
    ``,
    section("未完成", log.incomplete),
    ``,
    section("技术债记录", log.tech_debt),
    ``,
    section("下一轮建议", log.next_loop_suggestions),
  ].filter(l => l !== undefined).join("\n")
}
