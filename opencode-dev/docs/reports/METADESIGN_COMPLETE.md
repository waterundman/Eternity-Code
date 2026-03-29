# OpenCode MetaDesign 改造完成报告

## 概述

已按照 `INSTRUCTION.md` 完成 OpenCode 的 MetaDesign 框架改造。

## 完成的步骤

### ✅ 第零步：摸清地形

确定了关键文件位置：

| 变量 | 实际路径 |
|------|---------|
| `SYSTEM_PROMPT_FILE` | `packages/opencode/src/session/llm.ts` |
| `LLM_CALL_FILE` | `packages/opencode/src/session/llm.ts` |
| `COMMAND_REGISTRY_FILE` | `packages/opencode/src/command/index.ts` |
| `CWD_SOURCE` | `Instance.directory` |

### ✅ 第一步：创建 MetaDesign 读取层

创建文件：
- `packages/opencode/src/meta/types.ts` - 类型定义
- `packages/opencode/src/meta/index.ts` - 加载和构建 context
- `packages/opencode/src/meta/cards.ts` - 卡片管理

### ✅ 第二步：注入 system prompt

修改 `packages/opencode/src/session/llm.ts`：
```typescript
// Inject MetaDesign context if available
const metaDesign = await loadMetaDesign(Instance.directory)
if (metaDesign) {
  system.push(buildSystemContext(metaDesign))
}
```

### ✅ 第三步：注册 /meta 命令

修改 `packages/opencode/src/command/index.ts`：
- 添加 `meta` 命令到 `Default` 常量
- 在 `state()` 函数中注册命令（仅当 `.meta/design.yaml` 存在时）

创建文件：
- `packages/opencode/src/meta/command.ts` - 命令实现
- `packages/opencode/src/command/template/meta.txt` - 命令模板

### ✅ 第四步：最终验证

1. **类型检查**: `bun typecheck` 通过
2. **无 .meta/ 项目测试**: 行为与改造前一致
3. **有 .meta/design.yaml 测试**: `/meta` 命令可用
4. **MetaDesign context 注入**: 正确输出 rejected_directions

## 文件清单

### 新创建的文件

```
packages/opencode/src/meta/
├── types.ts          # 类型定义
├── index.ts          # 核心功能和导出
├── cards.ts          # 卡片管理
├── command.ts        # 命令实现
├── plugin.ts         # 插件实现
└── README.md         # 使用指南

packages/opencode/src/command/template/
└── meta.txt          # meta 命令模板

.meta/
├── design.yaml       # 测试用设计文件
├── cards/            # 卡片目录
├── loops/            # 循环目录
└── negatives/        # 负面方向目录
```

### 修改的文件

```
packages/opencode/package.json          # 添加 js-yaml 依赖
packages/opencode/src/session/llm.ts    # 注入 MetaDesign context
packages/opencode/src/command/index.ts  # 注册 /meta 命令
packages/opencode/script/build.ts       # 移除 @opencode-ai/script 依赖
```

## 核心功能

### 1. 自动注入 MetaDesign context

每次 LLM 调用时，如果存在 `.meta/design.yaml`，会自动注入：
- 项目信息（名称、阶段、核心价值）
- 需求覆盖度
- 约束条件
- 被拒绝的方向
- 评估因子基线

### 2. /meta 命令

- 仅在 `.meta/design.yaml` 存在时可用
- 生成格式化的决策卡片
- 支持接受/拒绝决策
- 自动生成负面方向

### 3. 透明性

- 对没有 `.meta/` 目录的项目完全透明
- 不影响原有功能

## 验证结果

### 类型检查
```
$ bun typecheck
$ tsgo --noEmit
# 无错误
```

### MetaDesign Context 输出
```
=== MetaDesign Context ===
Project: opencode-fork  [stage: mvp]
Core value:  提供一个轻量级、高效的AI编程助手TUI工具
Anti value:  不追求功能大而全，专注于核心TUI体验

Rejected directions (DO NOT propose anything in these directions):
  [NEG-001] 添加Web界面
         reason: 专注于TUI体验，Web界面会分散开发资源
  [NEG-002] 支持VS Code插件
         reason: 保持独立TUI工具定位，不做IDE集成
=== End MetaDesign Context ===
```

## 使用方法

### 1. 初始化 MetaDesign 项目

```bash
mkdir -p .meta/{cards,loops,negatives}
# 创建 .meta/design.yaml 文件
```

### 2. 启动 OpenCode

```bash
bun dev .
```

### 3. 使用 /meta 命令

在 TUI 中输入：
```
/meta
```

### 4. 对话验证

问模型：
```
这个项目有哪些被拒绝的优化方向？
```

模型会基于注入的 MetaDesign context 回答。

## 后续改进建议

1. **集成 Session API**: 将 `runMetaLoop` 与实际的 Session API 集成
2. **TUI 决策界面**: 使用 Ink 创建更好的决策界面
3. **评估阶段**: 实现完整的 EVALUATE 阶段
4. **循环历史**: 完善循环历史记录和分析
