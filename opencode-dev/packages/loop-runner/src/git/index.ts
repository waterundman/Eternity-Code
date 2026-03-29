import { execSync } from 'child_process'

export interface GitClient {
  getCurrentBranch(): string
  getDefaultBranch(): string
  getCommitHash(): string
  createBranch(name: string): void
  switchBranch(name: string): void
  deleteBranch(name: string): void
  stageAll(): void
  commit(message: string): void
  push(branch?: string): void
  pull(branch?: string): void
  getStatus(): GitStatus
  getDiff(cached?: boolean): string
  getLog(limit?: number): GitCommit[]
}

export interface GitStatus {
  modified: string[]
  added: string[]
  deleted: string[]
  renamed: Array<{ from: string; to: string }>
  untracked: string[]
}

export interface GitCommit {
  hash: string
  author: string
  date: string
  message: string
}

export function createGitClient(repoPath: string): GitClient {
  return new SimpleGitClient(repoPath)
}

class SimpleGitClient implements GitClient {
  constructor(private repoPath: string) {}
  
  private exec(command: string): string {
    try {
      return execSync(command, {
        cwd: this.repoPath,
        encoding: 'utf-8'
      }).trim()
    } catch (error) {
      throw new Error(`Git command failed: ${command}\n${error}`)
    }
  }
  
  getCurrentBranch(): string {
    return this.exec('git rev-parse --abbrev-ref HEAD')
  }
  
  getDefaultBranch(): string {
    // Try to detect default branch
    try {
      const remoteInfo = this.exec('git remote show origin')
      const match = remoteInfo.match(/HEAD branch: (.+)/)
      if (match) {
        return match[1]
      }
    } catch {
      // Fallback to main or master
    }
    
    try {
      this.exec('git rev-parse --verify main')
      return 'main'
    } catch {
      try {
        this.exec('git rev-parse --verify master')
        return 'master'
      } catch {
        return 'main'
      }
    }
  }
  
  getCommitHash(): string {
    return this.exec('git rev-parse HEAD')
  }
  
  createBranch(name: string): void {
    this.exec(`git checkout -b ${name}`)
  }
  
  switchBranch(name: string): void {
    this.exec(`git checkout ${name}`)
  }
  
  deleteBranch(name: string): void {
    this.exec(`git branch -D ${name}`)
  }
  
  stageAll(): void {
    this.exec('git add -A')
  }
  
  commit(message: string): void {
    // Escape quotes in message
    const escapedMessage = message.replace(/"/g, '\\"')
    this.exec(`git commit -m "${escapedMessage}"`)
  }
  
  push(branch?: string): void {
    if (branch) {
      this.exec(`git push origin ${branch}`)
    } else {
      this.exec('git push')
    }
  }
  
  pull(branch?: string): void {
    if (branch) {
      this.exec(`git pull origin ${branch}`)
    } else {
      this.exec('git pull')
    }
  }
  
  getStatus(): GitStatus {
    const statusOutput = this.exec('git status --porcelain')
    const lines = statusOutput.split('\n').filter(line => line.trim())
    
    const status: GitStatus = {
      modified: [],
      added: [],
      deleted: [],
      renamed: [],
      untracked: []
    }
    
    for (const line of lines) {
      const statusCode = line.slice(0, 2)
      const filePath = line.slice(3)
      
      if (statusCode.includes('M')) {
        status.modified.push(filePath)
      } else if (statusCode.includes('A')) {
        status.added.push(filePath)
      } else if (statusCode.includes('D')) {
        status.deleted.push(filePath)
      } else if (statusCode.includes('R')) {
        const [from, to] = filePath.split(' -> ')
        status.renamed.push({ from, to })
      } else if (statusCode.includes('?')) {
        status.untracked.push(filePath)
      }
    }
    
    return status
  }
  
  getDiff(cached: boolean = false): string {
    const command = cached ? 'git diff --cached' : 'git diff'
    return this.exec(command)
  }
  
  getLog(limit: number = 10): GitCommit[] {
    const format = '%H|%an|%ad|%s'
    const command = `git log --format="${format}" --date=iso -n ${limit}`
    const output = this.exec(command)
    
    if (!output) {
      return []
    }
    
    return output.split('\n').map(line => {
      const [hash, author, date, message] = line.split('|')
      return { hash, author, date, message }
    })
  }
}

export async function getGitSha(repoPath: string): Promise<string> {
  try {
    const client = createGitClient(repoPath)
    return client.getCommitHash()
  } catch {
    return 'unknown'
  }
}
