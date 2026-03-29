import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { z } from 'zod'

export async function loadYamlFile<T>(filePath: string, schema: z.ZodSchema<T>): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8')
  const data = yaml.load(content)
  return schema.parse(data)
}

export async function saveYamlFile<T>(filePath: string, data: T): Promise<void> {
  const content = yaml.dump(data, { indent: 2 })
  await fs.writeFile(filePath, content, 'utf-8')
}

export function generateId(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(3, '0')}`
}

export function parseNumericValue(value: string): number {
  // Remove non-numeric characters except . and -
  const cleaned = value.replace(/[^0-9.\-]/g, '')
  return parseFloat(cleaned)
}

export function formatTimestamp(date: Date = new Date()): string {
  return date.toISOString()
}

export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function listFiles(dirPath: string, pattern?: RegExp): Promise<string[]> {
  try {
    const files = await fs.readdir(dirPath)
    
    if (pattern) {
      return files.filter(f => pattern.test(f))
    }
    
    return files
  } catch {
    return []
  }
}

export function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 3)
    .filter(word => !['this', 'that', 'with', 'from', 'have', 'been', 'will', 'would', 'could', 'should'].includes(word))
}

export function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(extractKeywords(text1))
  const words2 = new Set(extractKeywords(text2))
  
  const intersection = new Set([...words1].filter(word => words2.has(word)))
  const union = new Set([...words1, ...words2])
  
  return intersection.size / union.size
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }
  
  return text.slice(0, maxLength - 3) + '...'
}
