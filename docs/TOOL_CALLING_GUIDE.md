# Eternity Code 工具调用模块设计指导

更新日期：2026-03-28

---

## 一、核心概念

### 1.1 工具定义架构

工具系统位于 `packages/eternity-code/src/tool/` 目录，核心文件：

| 文件 | 作用 |
|------|------|
| `tool.ts` | 工具核心抽象（`Tool.define` 工厂函数） |
| `registry.ts` | 工具注册表，管理所有内置/自定义工具 |
| `schema.ts` | 工具 ID 类型定义 |

### 1.2 工具接口模型

```
┌─────────────────────────────────────────────────────────────────┐
│                      Tool 系统架构                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ToolRegistry                                                    │
│  ┌──────────────┬──────────────┬──────────────┐                │
│  │ 内置工具      │ 自定义工具    │ 插件工具      │                │
│  │ (bash/read/  │ (tool/*)     │ (plugin/)    │                │
│  │  edit/...)   │              │              │                │
│  └──────┬───────┴──────────────┴──────────────┘                │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Tool.Info (工具元信息)                                    │    │
│  │  - id: 工具唯一标识                                       │    │
│  │  - init(): 初始化函数，返回 description + parameters     │    │
│  │  - execute(): 实际执行逻辑                                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Context (执行上下文)                                            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ sessionID | messageID | agent | abort | callID          │    │
│  │ messages | metadata() | ask()                           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、工具定义模式

### 2.1 基础结构

使用 `Tool.define(id, init)` 创建工具：

```typescript
import { Tool } from "./tool"
import z from "zod"

// 定义工具
export const MyTool = Tool.define("my_tool", async () => {
  return {
    description: "工具描述文本",
    parameters: z.object({
      // Zod schema 定义参数
      param1: z.string().describe("参数说明"),
      param2: z.number().optional().describe("可选参数"),
    }),
    async execute(params, ctx) {
      // 执行逻辑
      return {
        title: "执行结果标题",
        output: "返回给模型的文本输出",
        metadata: {
          // 附加元数据（用于 Dashboard/调试）
          customKey: "customValue",
        },
      }
    },
  }
})
```

### 2.2 工具的 Context

`Context` 提供执行时所需的所有信息：

```typescript
interface Context {
  sessionID: SessionID      // 会话 ID
  messageID: MessageID      // 消息 ID
  agent: string             // 当前 Agent 名称
  abort: AbortSignal        // 中止信号
  callID?: string           // 调用 ID
  extra?: Record<string, any>  // 额外数据
  messages: MessageV2.WithParts[]  // 消息历史
  metadata(input: { title?: string; metadata?: M }): void  // 更新元数据
  ask(input: PermissionNext.Request): Promise<void>  // 请求权限
}
```

### 2.3 权限请求模式

大多数工具需要请求权限，使用 `ctx.ask()`：

```typescript
await ctx.ask({
  permission: "read",           // 权限类型
  patterns: [filepath],         // 请求的文件路径
  always: ["*"],               // "总是允许"的模式
  metadata: { ... },           // 附加元数据
})
```

支持的三种权限动作：
- `allow`：直接允许
- `deny`：直接拒绝
- `ask`：询问用户

---

## 三、工具注册与分发

### 3.1 注册表 (`registry.ts`)

```typescript
// 工具列表（内置 + 自定义）
export async function tools(model, agent?) {
  return [
    InvalidTool,
    QuestionTool,
    BashTool,
    ReadTool,
    GlobTool,
    GrepTool,
    EditTool,
    WriteTool,
    TaskTool,
    WebFetchTool,
    TodoWriteTool,
    WebSearchTool,
    CodeSearchTool,
    SkillTool,
    ...custom,  // 自定义工具
  ]
}
```

### 3.2 自定义工具来源

1. **项目本地工具目录**：`{tool,tools}/*.{js,ts}`
2. **插件工具**：`Plugin.list()` 返回的插件定义
3. **实验性工具**：通过 Flag 控制（如 `BatchTool`, `LspTool`）

### 3.3 模型过滤

某些工具只对特定模型可用：

```typescript
.filter((t) => {
  // websearch/codesearch 仅对特定模型可用
  if (t.id === "codesearch" || t.id === "websearch") {
    return model.providerID === ProviderID.make("eternity-code") || Flag.OPENCODE_EXPERIMENTAL_EXA
  }
  // apply_patch 格式适配
  const usePatch = model.modelID.includes("gpt-") && !model.modelID.includes("oss")
  if (t.id === "apply_patch") return usePatch
  return true
})
```

---

## 四、核心工具实现示例

### 4.1 读文件工具 (`read.ts`)

```typescript
export const ReadTool = Tool.define("read", {
  description: DESCRIPTION,  // 从 bash.txt 加载
  parameters: z.object({
    filePath: z.string().describe("文件绝对路径"),
    offset: z.coerce.number().optional().describe("起始行号(1-indexed)"),
    limit: z.coerce.number().optional().describe("最大行数，默认2000"),
  }),
  async execute(params, ctx) {
    // 1. 验证并解析路径
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.resolve(Instance.directory, filepath)
    }

    // 2. 请求权限
    await ctx.ask({
      permission: "read",
      patterns: [filepath],
      always: ["*"],
      metadata: {},
    })

    // 3. 执行读取逻辑
    const stat = Filesystem.stat(filepath)
    if (stat?.isDirectory()) {
      // 目录处理...
    }

    // 4. 流式读取文件
    const stream = createReadStream(filepath, { encoding: "utf8" })
    // ... 行处理逻辑 ...

    // 5. 返回结果
    return {
      title: path.relative(Instance.worktree, filepath),
      output: formattedContent,
      metadata: {
        preview: firstLines,
        truncated: boolean,
        loaded: instructions.map(i => i.filepath),
      },
    }
  },
})
```

### 4.2 写文件工具 (`write.ts`)

```typescript
export const WriteTool = Tool.define("write", {
  description: DESCRIPTION,
  parameters: z.object({
    content: z.string().describe("文件内容"),
    filePath: z.string().describe("文件绝对路径"),
  }),
  async execute(params, ctx) {
    const filepath = path.resolve(Instance.directory, params.filePath)
    
    // 创建 diff 用于权限请求
    const oldContent = exists ? await read(filepath) : ""
    const diff = createTwoFilesPatch(filepath, filepath, oldContent, params.content)
    
    // 请求编辑权限
    await ctx.ask({
      permission: "edit",
      patterns: [filepath],
      always: ["*"],
      metadata: { filepath, diff },
    })

    // 执行写入
    await Filesystem.write(filepath, params.content)
    
    // 返回结果（包含 LSP Diagnostics）
    return {
      title: filepath,
      metadata: { diagnostics, filepath, exists },
      output: "Wrote file successfully.",
    }
  },
})
```

### 4.3 Bash 工具 (`bash.ts`)

```typescript
export const BashTool = Tool.define("bash", async () => {
  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory),
    parameters: z.object({
      command: z.string().describe("要执行的命令"),
      timeout: z.number().optional().describe("超时毫秒数"),
      workdir: z.string().optional().describe("工作目录"),
      description: z.string().describe("命令描述（5-10词）"),
    }),
    async execute(params, ctx) {
      const cwd = params.workdir || Instance.directory
      
      // 解析命令获取需要权限的路径
      const tree = parser.parse(params.command)
      const directories = new Set<string>()
      const patterns = new Set<string>()
      
      // 分析命令中的路径引用...
      
      if (directories.size > 0) {
        await ctx.ask({
          permission: "external_directory",
          patterns: [...directories],
          always: [...directories],
          metadata: {},
        })
      }

      // 执行命令
      const proc = spawn(params.command, { shell, cwd, ... })
      
      // 流式收集输出
      proc.stdout?.on("data", (chunk) => { ... })
      proc.stderr?.on("data", (chunk) => { ... })
      
      // 处理超时和中止
      // ...

      return {
        title: params.description,
        output,
        metadata: { exit: proc.exitCode, description: params.description },
      }
    },
  }
})
```

---

## 五、工具输出截断

### 5.1 Truncate 机制

工具输出自动经过截断处理（`truncate.ts`）：

```typescript
// Tool.define 自动包装执行函数
toolInfo.execute = async (args, ctx) => {
  const result = await execute(args, ctx)
  
  // 跳过自行处理截断的工具
  if (result.metadata.truncated !== undefined) {
    return result
  }
  
  const truncated = await Truncate.output(result.output, {}, initCtx?.agent)
  return {
    ...result,
    output: truncated.content,
    metadata: {
      ...result.metadata,
      truncated: truncated.truncated,
      ...(truncated.truncated && { outputPath: truncated.outputPath }),
    },
  }
}
```

### 5.2 截断规则

- **最大行数**：`Truncate.MAX_LINES` (默认 2000 行)
- **最大字节**：`Truncate.MAX_BYTES` (默认 51200 字节)
- 返回截断提示和输出文件路径

---

## 六、权限系统集成

### 6.1 PermissionNext

工具通过 `ctx.ask()` 与权限系统交互：

```typescript
// 请求结构
interface PermissionRequest {
  permission: string      // "read" | "edit" | "bash" | ...
  patterns: string[]      // 文件模式
  always: string[]        // 总是允许的模式
  metadata: Record<string, any>
}

// 用户回复
enum Reply {
  "once"   = "本次允许"
  "always" = "总是允许"
  "reject" = "拒绝"
}
```

### 6.2 权限规则匹配

使用通配符模式匹配：

```typescript
PermissionNext.evaluate("read", "**/*.ts", [
  { permission: "read", pattern: "*.ts", action: "allow" },
  { permission: "read", pattern: "**/*", action: "ask" },
])
// => { action: "allow" }
```

---

## 七、创建自定义工具步骤

### 7.1 实现模板

```typescript
import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./mytool.txt"  // 描述文本文件
import { Instance } from "../project/instance"
import { assertExternalDirectory } from "./external-directory"

export const MyTool = Tool.define("my_tool", {
  description: DESCRIPTION,
  parameters: z.object({
    param1: z.string().describe("参数1说明"),
    param2: z.number().optional().describe("可选参数"),
  }),
  async execute(params, ctx) {
    // 1. 路径处理
    const filepath = path.isAbsolute(params.param1) 
      ? params.param1 
      : path.join(Instance.directory, params.param1)
    
    // 2. 权限检查
    await assertExternalDirectory(ctx, filepath)
    await ctx.ask({
      permission: "my_permission_type",  // 或复用现有权限
      patterns: [filepath],
      always: ["*"],
      metadata: { ... },
    })

    // 3. 执行核心逻辑
    // ...
    
    // 4. 通知文件系统变更
    await Bus.publish(File.Event.Edited, { file: filepath })
    await Bus.publish(FileWatcher.Event.Updated, { file: filepath, event: "change" })
    
    // 5. 返回结果
    return {
      title: "操作标题",
      output: "操作结果文本",
      metadata: { customData: "..." },
    }
  },
})
```

### 7.2 描述文件格式

创建 `{toolname}.txt` 文件，内容示例：

```
The my_tool tool does something specific.

Parameters:
- param1 (required): First parameter description
- param2 (optional): Second parameter description

Returns:
- title: Operation title
- output: Operation result text
- metadata: Additional metadata
```

### 7.3 注册工具

在 `registry.ts` 的 `all()` 函数中添加：

```typescript
return [
  // ... 其他工具
  MyTool,
  // 或条件注册
  ...(Flag.OPENCODE_EXPERIMENTAL_MYTOOL ? [MyTool] : []),
]
```

---

## 八、重要约束

### 8.1 类型安全

- 使用 Zod 定义参数 schema
- 使用 TypeScript 严格类型
- 避免 `any` 类型

### 8.2 权限请求

- 所有文件/目录操作必须请求权限
- 使用 `assertExternalDirectory()` 验证路径安全
- 提供清晰的 metadata 供用户决策

### 8.3 错误处理

```typescript
// 验证参数
if (!params.filePath) {
  throw new Error("filePath is required")
}

// 验证路径存在
const stats = Filesystem.stat(filepath)
if (!stats) throw new Error(`File ${filepath} not found`)
if (stats.isDirectory()) throw new Error(`Path is a directory: ${filepath}`)
```

### 8.4 输出格式

- `output`：返回给 LLM 的文本
- `title`：用于 UI 显示的标题
- `metadata`：附加信息（diagnostics, diff, file info）

---

## 九、相关文件位置

```
packages/eternity-code/src/
├── tool/
│   ├── tool.ts              # 核心抽象
│   ├── registry.ts          # 注册表
│   ├── schema.ts            # 类型定义
│   ├── read.ts              # 读文件工具
│   ├── write.ts             # 写文件工具
│   ├── edit.ts              # 编辑工具
│   ├── bash.ts              # Bash 工具
│   ├── grep.ts              # 搜索工具
│   ├── glob.ts              # 文件搜索
│   ├── task.ts              # 子任务工具
│   ├── truncate.ts          # 输出截断
│   ├── external-directory.ts # 目录权限验证
│   └── *.txt                # 工具描述文件
├── permission/
│   └── index.ts             # 权限系统
├── session/
│   └── llm.ts               # LLM 调用（含工具列表）
└── plugin/
    └── index.ts             # 插件系统
```

---

## 十、验证命令

```bash
cd opencode-dev/packages/eternity-code
bun typecheck
bun dev .
```

---

*文档版本：2026-03-28*
*维护者：opencode tool calling guidance*