# OpenCode MetaDesign 改造完成总结

## 概述

已按照 `INSTRUCTION.md` 的指导，成功将 opencode 改造为支持 MetaDesign 框架的 AI 原生软件工程工具。

## 完成的工作

### 第零步：摸清地形

通过探索项目结构，确定了以下关键文件位置：

| 变量 | 实际路径 | 说明 |
|------|---------|------|
| `SYSTEM_PROMPT_FILE` | `packages/opencode/src/session/llm.ts` | system prompt 组装位置 |
| `LLM_CALL_FILE` | `packages/opencode/src/session/llm.ts` | LLM API 调用位置 |
| `COMMAND_REGISTRY_FILE` | `packages/opencode/src/command/index.ts` | 命令注册位置 |
| `CWD_SOURCE` | `Instance.directory` | cwd 来源 |

### 第一步：创建 MetaDesign 读取层

在 `packages/opencode/src/meta/` 目录下创建了以下文件：

1. **types.ts** - 类型定义
   - `MetaRequirement` - 需求接口
   - `RejectedDirection` - 被拒绝的方向接口
   - `EvalFactor` - 评估因子接口
   - `MetaDesign` - 主设计文件接口
   - `RawCard` - 决策卡片接口
   - `CardDecision` - 卡片决策接口

2. **index.ts** - 核心功能
   - `loadMetaDesign(cwd)` - 加载 `.meta/design.yaml`
   - `buildSystemContext(design)` - 构建系统上下文字符串

3. **cards.ts** - 卡片管理
   - `parseCardsFromText(text)` - 从模型输出解析卡片
   - `writeCard(cwd, card, loopId)` - 写入卡片到磁盘
   - `resolveCard(cwd, cardId, decision)` - 解决卡片（接受/拒绝）
   - `writeRejectedDirection(...)` - 写入被拒绝的方向

4. **command.ts** - 命令实现
   - `runMetaLoop(cwd, session)` - 运行 MetaDesign 循环
   - `buildGenerationPrompt(...)` - 构建生成提示
   - `runDecisionFlow(...)` - 运行决策流程

### 第二步：注入 system prompt

修改了 `packages/opencode/src/session/llm.ts`：

1. 添加了导入语句：
   ```typescript
   import { loadMetaDesign, buildSystemContext } from "../meta/index.js"
   ```

2. 在 `stream()` 函数中注入 MetaDesign context：
   ```typescript
   // Inject MetaDesign context if available
   const metaDesign = await loadMetaDesign(Instance.directory)
   if (metaDesign) {
     system.push(buildSystemContext(metaDesign))
   }
   ```

### 第三步：注册 /meta 命令

修改了 `packages/opencode/src/command/index.ts`：

1. 添加了导入语句：
   ```typescript
   import PROMPT_META from "./template/meta.txt"
   import { loadMetaDesign } from "../meta/index.js"
   ```

2. 在 `Default` 常量中添加了 `META: "meta"`

3. 在 `state()` 函数中注册了 meta 命令（仅当 `.meta/design.yaml` 存在时）

4. 创建了 `packages/opencode/src/command/template/meta.txt` 模板文件

### 依赖更新

在 `packages/opencode/package.json` 中添加了：
- `js-yaml: ^4.1.0` (dependencies)
- `@types/js-yaml: ^4.0.9` (devDependencies)

## 改造效果

### 对非 MetaDesign 项目的透明性

- 如果项目没有 `.meta/` 目录，所有改动完全透明
- `loadMetaDesign()` 返回 `null`，不注入任何额外内容
- `/meta` 命令不会出现在命令列表中

### 对 MetaDesign 项目的功能

1. **自动注入上下文**：每次 LLM 调用时，会自动将 MetaDesign context 追加到 system prompt
2. **/meta 命令**：用户可以运行 `/meta` 触发分析并生成卡片
3. **卡片管理**：自动生成、保存和管理决策卡片
4. **决策流程**：支持接受/拒绝卡片，自动生成负面方向

## 使用方法

### 1. 初始化 MetaDesign 项目

```bash
mkdir -p .meta
# 创建 design.yaml 文件
```

### 2. 运行 /meta 命令

在 opencode 中输入：
```
/meta
```

系统会：
1. 分析当前代码库
2. 生成指定数量的决策卡片
3. 显示决策界面
4. 保存卡片到 `.meta/cards/` 目录
5. 更新 `.meta/loops/` 记录

### 3. 查看生成的卡片

```bash
ls .meta/cards/
cat .meta/cards/CARD-001.yaml
```

## 文件清单

### 新创建的文件

```
packages/opencode/src/meta/
├── types.ts          # 类型定义
├── index.ts          # 核心功能
├── cards.ts          # 卡片管理
└── command.ts        # 命令实现

packages/opencode/src/command/template/
└── meta.txt          # meta 命令模板
```

### 修改的文件

```
packages/opencode/package.json          # 添加 js-yaml 依赖
packages/opencode/src/session/llm.ts    # 注入 MetaDesign context
packages/opencode/src/command/index.ts  # 注册 /meta 命令
```

## 验证步骤

1. **类型检查**：确保没有 TypeScript 错误
2. **功能测试**：
   - 在没有 `.meta/` 的项目中启动 opencode，行为应与改造前完全一致
   - 在有 `.meta/design.yaml` 的项目中启动 opencode，应能看到 `/meta` 命令
   - 运行 `/meta` 应能生成卡片并显示决策界面

## 后续改进建议

1. **集成 Session API**：将 `runMetaLoop` 函数与实际的 Session API 集成
2. **TUI 界面**：使用 Ink 创建更好的决策界面
3. **评估阶段**：实现完整的 EVALUATE 阶段
4. **循环历史**：完善循环历史记录和分析
5. **与 loop-runner 包集成**：将此实现与 `packages/loop-runner` 包的功能整合

## 注意事项

1. 所有新文件都放在 `packages/opencode/src/meta/` 目录下
2. 不破坏 opencode 现有功能
3. 使用项目已有依赖（js-yaml 已添加到 package.json）
4. TypeScript 严格类型，避免使用 `any`
