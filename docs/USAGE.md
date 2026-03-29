# Eternity Code 使用说明

## 启动程序

### 方法 1：使用启动脚本

**Windows:**
```bash
start.bat
```

**Linux/Mac:**
```bash
chmod +x start.sh
./start.sh
```

### 方法 2：手动启动

```bash
export PATH="$PATH:/c/Users/wxy/.bun/bin"
export OPENROUTER_API_KEY="sk-or-v1-..."
cd "W:\项目仓库\Eternity code\opencode-dev"
bun dev .
```

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+P` | 打开命令面板 |
| `Tab` | 切换 agents |
| `/` | 输入命令 |
| `Ctrl+T` | 切换 variants |
| `Ctrl+C` | 退出程序 |

## MetaDesign 命令

在 TUI 中按 `/` 输入以下命令：

| 命令 | 功能 |
|------|------|
| `/meta` | 开始新的 Loop |
| `/meta-decide` | 审查待处理的卡片 |
| `/meta-execute` | 执行已接受的卡片 |
| `/meta-eval` | 评估结果 |
| `/meta-optimize` | 优化搜索策略 |

## 模型配置

当前配置使用 OpenRouter 的 Gemini 3 Pro Preview 模型。

如需切换模型：
1. 按 `Ctrl+T` 切换 variants
2. 或在命令面板中选择 "Switch model"

## 已知问题

- 首次启动可能需要等待数据库迁移
- MetaDesign 功能需要项目目录下有 `.meta/design.yaml` 文件

## 后续开发

### UI 优化待办

1. **集成 Loop 路由**：当输入 `/meta` 时自动切换到 Loop 界面
2. **实时数据更新**：Sidebar 数据实时刷新
3. **动画效果**：状态切换的过渡动画
4. **错误处理**：更友好的错误提示

### MetaDesign 功能完善

1. **卡片解析**：自动解析模型输出的卡片
2. **决策流程**：TUI 决策界面
3. **执行阶段**：自动执行代码修改
4. **评估阶段**：自动评估结果

## 文件结构

```
opencode-dev/
├── packages/eternity-code/src/
│   ├── cli/cmd/tui/
│   │   ├── app.tsx           # TUI 入口
│   │   ├── components/meta/  # MetaDesign 组件
│   │   ├── routes/loop/      # Loop 路由
│   │   └── context/          # 上下文管理
│   └── meta/                 # MetaDesign 核心逻辑
│       ├── types.ts
│       ├── index.ts
│       ├── cards.ts
│       ├── command.ts
│       ├── executor.ts
│       ├── evaluator.ts
│       └── optimizer.ts
└── .meta/                    # MetaDesign 数据
    ├── design.yaml
    ├── cards/
    ├── loops/
    └── negatives/
```
