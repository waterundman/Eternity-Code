# OpenCode MetaDesign 改造验证报告

## 验证完成时间
2025-03-21

## 验证结果

### ✅ 第零步：摸清地形
- 确定了关键文件位置：
  - `SYSTEM_PROMPT_FILE`: `packages/opencode/src/session/llm.ts`
  - `LLM_CALL_FILE`: `packages/opencode/src/session/llm.ts`
  - `COMMAND_REGISTRY_FILE`: `packages/opencode/src/command/index.ts`
  - `CWD_SOURCE`: `Instance.directory`

### ✅ 第一步：创建 MetaDesign 读取层
创建了以下文件：
- `packages/opencode/src/meta/types.ts` - 类型定义
- `packages/opencode/src/meta/index.ts` - 加载和构建 context
- `packages/opencode/src/meta/cards.ts` - 卡片管理
- `packages/opencode/src/meta/command.ts` - 命令实现

### ✅ 第二步：注入 system prompt
修改了 `packages/opencode/src/session/llm.ts`：
- 添加了 `loadMetaDesign` 和 `buildSystemContext` 导入
- 在 `stream()` 函数中注入 MetaDesign context

### ✅ 第三步：注册 /meta 命令
修改了 `packages/opencode/src/command/index.ts`：
- 添加了 `meta` 命令注册
- 创建了 `meta.txt` 模板文件

### ✅ 第四步：最终验证
1. **类型检查**: `bun typecheck` 通过，无错误
2. **无 .meta/ 目录项目测试**: 行为与改造前完全一致
3. **有 .meta/design.yaml 项目测试**: 
   - `/meta` 命令正确注册
   - MetaDesign context 正确注入到 system prompt

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
- 每次 LLM 调用时，如果存在 `.meta/design.yaml`，会自动注入项目上下文
- 包括：项目信息、需求覆盖度、约束条件、被拒绝的方向、评估因子

### 2. /meta 命令
- 仅在 `.meta/design.yaml` 存在时可用
- 自动生成决策卡片
- 支持接受/拒绝决策
- 自动更新负面方向

### 3. 透明性
- 对没有 `.meta/` 目录的项目完全透明
- 不影响原有功能

## 使用方法

### 初始化 MetaDesign 项目
```bash
mkdir -p .meta
# 创建 design.yaml 文件（参考 .meta/design.yaml 示例）
```

### 运行 /meta 命令
在 opencode TUI 中输入：
```
/meta
```

### 查看生成的卡片
```bash
ls .meta/cards/
cat .meta/cards/CARD-001.yaml
```

## 后续改进建议

1. **集成 Session API**: 将 `runMetaLoop` 函数与实际的 Session API 集成
2. **TUI 决策界面**: 使用 Ink 创建更好的决策界面
3. **评估阶段**: 实现完整的 EVALUATE 阶段
4. **循环历史**: 完善循环历史记录和分析

## 依赖更新

在 `packages/opencode/package.json` 中添加了：
- `js-yaml: ^4.1.0` (dependencies)
- `@types/js-yaml: ^4.0.9` (devDependencies)

## 注意事项

1. 所有新文件都放在 `packages/opencode/src/meta/` 目录下
2. 不破坏 opencode 现有功能
3. 使用项目已有依赖
4. TypeScript 严格类型，避免使用 `any`
