# Eternity Code — UI 改造指令

你正在将 opencode 的 TUI 改造为 Eternity Code 的界面。
先完整读完本文件，再开始动手。

---

## 第零步：摸清现有 TUI 结构

执行以下探查，结果记住后再继续：

```bash
# TUI 入口和路由结构
find packages/eternity-code/src/cli/cmd/tui -type f | sort

# 当前布局组件
grep -r "layout\|Layout\|flex\|grid\|panel\|Panel" \
  packages/eternity-code/src/cli/cmd/tui --include="*.tsx" -l

# 当前颜色/主题定义
grep -r "color\|theme\|Color\|Theme\|style" \
  packages/eternity-code/src/cli/cmd/tui --include="*.tsx" -l | head -10

# opentui 的布局 API（理解可用的原语）
grep -r "import.*opentui\|from.*opentui" \
  packages/eternity-code/src -l | head -5
# 然后读其中一个文件理解 Row/Column/Box 等组件的用法
```

确定以下四个变量后再继续：
- `TUI_ROOT`：TUI 的根组件文件
- `SESSION_ROUTE`：当前对话界面的文件
- `THEME_FILE`：颜色/样式定义文件
- `LAYOUT_PRIMITIVES`：opentui 提供的布局组件名称清单

---

## 第零点五步：品牌重命名（先于所有 UI 改动执行）

在改任何布局之前，先完成全局品牌替换，避免后续新建文件里还出现旧名称。

```bash
# 1. 替换显示名称（用户可见的文字）
grep -rl "OpenCode\|opencode" packages/eternity-code/src --include="*.ts" --include="*.tsx" --include="*.md" \
  | xargs sed -i \
    -e 's/OpenCode/Eternity Code/g' \
    -e 's/opencode/eternity-code/g'

# 2. 替换 package name（package.json）
sed -i 's/"name": "opencode"/"name": "eternity-code"/g' packages/eternity-code/package.json
sed -i 's/"name": "@opencode\//"name": "@eternity-code\//g' packages/eternity-code/package.json

# 3. 替换根目录 package.json / bun.workspace.toml 里的引用
sed -i 's/opencode/eternity-code/g' package.json 2>/dev/null || true

# 4. README 标题
sed -i '1s/.*/# Eternity Code/' README.md 2>/dev/null || true
```

替换完成后做一次检查，确认没有误伤 import 路径：

```bash
# import 路径里的 "opencode" 不应该被替换（目录名没改）
# 检查是否有 import 路径被错误替换
grep -r "eternity-code" packages/eternity-code/src --include="*.ts" --include="*.tsx" \
  | grep "from\|import" | head -20
# 如果发现 import 路径被改掉了，用以下命令还原 import 部分：
# grep -rl "from.*eternity-code" packages/eternity-code/src | xargs sed -i "s/from '.*eternity-code/from '..\/opencode/g"
```

然后找到 TUI 里渲染 app title 的地方，确认已改为 "Eternity Code"：

```bash
grep -r "Eternity Code\|eternity-code\|opencode\|OpenCode" \
  packages/eternity-code/src/cli/cmd/tui --include="*.tsx" | grep -v "node_modules"
```

确认无旧名称残留后，继续下面的 UI 改造。

---

## 整体布局目标

opencode 现在的布局是：**单一对话界面**，对话是主角。

Eternity Code 的布局是：**Loop 界面为主，对话界面为辅**。

```
启动时                     /meta 触发后
┌──────────────────────┐   ┌────────────┬────────────────────┐
│                      │   │            │                    │
│   欢迎/项目状态页     │   │  MetaDesign│    Loop 主区域     │
│   （初始化引导）      │   │  侧边栏    │                    │
│                      │   │            │  [分析阶段]        │
│   如果有 .meta/       │   │  REQ ████  │  → 生成中...       │
│   显示项目概览        │   │  NEG (3)   │                    │
│                      │   │  EVAL      │  [决策阶段]        │
│   如果没有 .meta/     │   │            │  卡片面板          │
│   显示初始化引导      │   │  ─────     │                    │
│                      │   │  历史      │  [对话界面]        │
│   按 / 输入命令       │   │  loop-004  │  （折叠，可展开）  │
│   输入 /meta 开始     │   │  loop-003  │                    │
└──────────────────────┘   └────────────┴────────────────────┘
```

---

## 需要创建/修改的文件清单

新建文件（全部放在 `packages/eternity-code/src/cli/cmd/tui/` 下）：

```
tui/
  components/
    meta/
      Sidebar.tsx          ← MetaDesign 状态侧边栏
      CardPanel.tsx        ← 决策卡片面板
      LoopHistory.tsx      ← Loop 历史时间线
      WelcomeScreen.tsx    ← 启动欢迎/引导页
  routes/
    loop/
      index.tsx            ← Loop 主路由（替代 session 成为 /meta 的落点）
```

修改文件：
```
tui/routes/session/index.tsx   ← 降级：折叠到 Loop 界面右下区域
tui/app.tsx（或根组件）        ← 注入路由切换逻辑
```

---

## 第一步：Sidebar 组件

新建 `tui/components/meta/Sidebar.tsx`

功能：读取 `.meta/design.yaml`，实时展示 MetaDesign 状态。

渲染内容（从上到下）：

```
[项目名] [stage: mvp]
─────────────────────
REQUIREMENTS
  REQ-001 ████████░░ 74%
  REQ-002 ████░░░░░░ 41%
  REQ-003 ██░░░░░░░░ 20%
─────────────────────
CONSTRAINTS
  🔒 Node.js + GLM API
  🔒 latency < 800ms
─────────────────────
NEGATIVES (3 active)
  NEG-001 多角色视图
  NEG-002 持久化存储
  NEG-003 10级评分
─────────────────────
EVAL BASELINES
  完成率    71% → 85%
  可解释性  3.2 → 4.0
  latency   620ms ⚠
─────────────────────
LOOPS
  #4 ✓ +0.06
  #3 ✗ rolled back
  #2 ✓ +0.12
  #1 ✓ +0.08
```

实现要求：
- 宽度固定 24 字符
- 数据从 `.meta/design.yaml` 读取，调用已有的 `loadMetaDesign(cwd)`
- 如果 `.meta/` 不存在，显示"No MetaDesign · run /meta init"
- 覆盖度条用 8 格 █/░ 表示
- latency 如果超过 floor 的 80% 显示 ⚠

---

## 第二步：CardPanel 组件

新建 `tui/components/meta/CardPanel.tsx`

功能：展示本轮 loop 生成的决策卡片，接收用户选择。

Props：
```typescript
interface CardPanelProps {
  cards: Array<{
    id: string
    content: {
      objective: string
      approach: string
      benefit: string
      cost: string
      risk: string
      warnings: string[]
    }
    prediction: { confidence: number }
    req_refs: string[]
  }>
  onDecision: (decisions: Record<string, "accepted" | "rejected">) => void
  onRejectNote: (cardId: string) => Promise<string>
}
```

渲染一张卡片的样式：

```
┌─ CARD-041 [REQ-002] ──────────────────────┐
│ 目标  为评分结果添加依据说明               │
│ 手段  修改 prompt，每项评分附加理由        │
│ 收益  可解释性 +0.8                        │
│ 代价  latency +80ms                        │
│ 风险  GLM 短句质量不稳定                   │
│ ⚠    接近 performance_budget              │
│ 置信  ████████░░ 72%                       │
└────────────────────────────────────────────┘
[ 接受 ↑ ]  [ 拒绝 ↓ ]
```

键盘交互：
- `Tab` / 方向键：在卡片间切换焦点
- `a`：接受当前卡片
- `r`：拒绝当前卡片（触发 `onRejectNote` 弹出输入框）
- `A`：全部接受
- `R`：全部拒绝
- `Enter`：确认所有决策，调用 `onDecision`
- `Esc`：取消，不提交任何决策

状态显示：
- 未选：默认边框
- 已接受：左边框变绿，右上角显示 `✓`
- 已拒绝：左边框变红，右上角显示 `✕`，opacity 降低

---

## 第三步：LoopHistory 组件

新建 `tui/components/meta/LoopHistory.tsx`

功能：在侧边栏底部展示历次 loop 的简要记录。

数据来源：读取 `.meta/loops/` 目录下所有 YAML 文件。

渲染格式：
```
LOOP HISTORY
  #004  ✓  +0.06  "修复评分回归"
  #003  ✗  -0.03  "缓存层引入后回滚"
  #002  ✓  +0.12  "prompt 优化"
  #001  ✓  +0.08  "建立基础流程"
```

- `✓` 绿色（completed）
- `✗` 红色（rolled_back）
- `~` 灰色（aborted）
- delta 正数绿色，负数红色
- 点击（或方向键选中 + Enter）展开显示该 loop 的 accepted/rejected cards

---

## 第四步：WelcomeScreen 组件

新建 `tui/components/meta/WelcomeScreen.tsx`

启动时显示，根据项目状态分两种形态：

**形态 A：已有 `.meta/design.yaml`（返回用户）**

```
  Eternity Code

  [项目名]  stage: mvp  loop #4

  Requirements     ████████░░ avg 45% coverage
  Constraints      3 active
  Negatives        3 active · 0 pending review
  Last loop        2025-03-18  +0.06

  输入 /meta 开始新一轮 loop
  输入 /chat 进入对话模式
```

**形态 B：没有 `.meta/`（新用户）**

```
  Eternity Code

  当前目录没有 MetaDesign 配置。

  输入 /meta init 初始化项目
  （引导你写下核心价值、元需求和初始约束）

  输入 /chat 直接进入对话模式（不使用 MetaDesign）
```

---

## 第五步：Loop 主路由

新建 `tui/routes/loop/index.tsx`

这是 `/meta` 命令触发后的主界面。整合 Sidebar + 主区域。

布局：
```typescript
// 伪代码，用实际的 opentui 布局 API 替换
<Row height="100%">
  <Sidebar width={26} />                    // 左侧固定宽度
  <Column flex={1}>
    <LoopOutputArea flex={1} />             // 上方：agent 输出流
    <Show when={phase() === "decide"}>
      <CardPanel cards={cards()} />         // 中间：决策卡片（仅决策阶段显示）
    </Show>
    <Show when={showChat()}>
      <ChatArea height={12} />              // 下方：折叠的对话区（可展开）
    </Show>
    <StatusBar />                           // 底部状态栏
  </Column>
</Row>
```

状态机（phase）：
```
idle → analyzing → generating → decide → executing → evaluating → complete
                                    ↑
                            用户在这里选卡片
```

键盘快捷键（全局，在 loop 路由内）：
- `/`：聚焦命令输入
- `Tab`：在 CardPanel 卡片间切换（决策阶段）
- `c`：展开/折叠底部对话区
- `h`：展开/折叠 LoopHistory（侧边栏底部）
- `q`：中止当前 loop（确认后）

---

## 第六步：降级对话界面

修改 `tui/routes/session/index.tsx`：

- 移除全屏布局，改为可嵌入的组件形态
- 接受 `height` prop，支持被 loop 路由限制高度
- 顶部加一行提示：`[对话模式] 输入 /meta 切换到 Loop 模式`
- 保留所有原有对话功能，只是不再是默认全屏

---

## 第七步：路由切换逻辑

修改 TUI 根组件（`tui/app.tsx` 或实际的根文件）：

```typescript
// 启动时：显示 WelcomeScreen
// 用户输入 /meta：切换到 loop/index.tsx 路由
// 用户输入 /meta init：运行初始化引导流程（暂时可以是对话模式里的一个 agent 任务）
// 用户输入 /chat：显示原有对话界面（全屏模式）
// 在 loop 路由里按 c：内嵌对话区展开/折叠

const [route, setRoute] = createSignal<"welcome" | "loop" | "chat">("welcome")
```

---

## 完成后的验证清单

```bash
bun dev .

# 验证 1：启动界面
# 在没有 .meta/ 的目录启动 → 显示 WelcomeScreen 形态 B

# 验证 2：项目状态界面
# 在有 .meta/design.yaml 的目录启动 → 显示 WelcomeScreen 形态 A
# 项目信息与 design.yaml 内容一致

# 验证 3：Loop 界面
# 输入 /meta → 切换到 Loop 路由
# 左侧 Sidebar 显示 REQ/NEG/EVAL 数据
# 上方输出区显示 agent 分析流

# 验证 4：决策阶段
# agent 生成卡片后 → CardPanel 自动出现
# Tab 键在卡片间切换，a/r 键选择
# Enter 确认后 CardPanel 消失，进入执行阶段

# 验证 5：对话降级
# 在 loop 路由按 c → 底部展开对话区，高度约 12 行
# 再按 c → 折叠
# 输入 /chat → 切换到对话全屏模式

# 验证 6：原有功能不回归
# 在没有 .meta/ 的项目里，输入 /chat
# 原有对话功能完全正常
```

---

## 注意事项

- opentui 的布局 API 可能与 React/SolidJS 有差异，遇到不确定的地方先读已有组件的实现方式，模仿它
- CardPanel 的键盘焦点管理要注意和全局快捷键的冲突，先看 session 组件是怎么处理焦点的
- Sidebar 的数据不需要实时轮询，在每次 loop phase 切换时重新读取一次即可
- 所有新组件对没有 `.meta/` 的项目必须静默降级，不能报错
