# Eternity Code UI 改造完成报告

## 完成状态

### ✅ 第零步：摸清现有 TUI 结构

确定了关键文件位置：
- `TUI_ROOT`: `tui/app.tsx`
- `SESSION_ROUTE`: `tui/routes/session/index.tsx`
- `THEME_FILE`: `tui/context/theme.tsx`
- `LAYOUT_PRIMITIVES`: `@opentui/solid` 的 `box`, `text`, `scrollbox`

### ✅ 第零点五步：品牌重命名

- 替换 "OpenCode" → "Eternity Code"（显示名称）

### ✅ 第一步：Sidebar 组件

创建 `tui/components/meta/Sidebar.tsx`：
- 显示项目名称和阶段
- 显示需求覆盖度（8格条形图）
- 显示约束（immutable_modules, performance_budget）
- 显示负面方向（NEG）
- 显示 Loop 历史

### ✅ 第二步：CardPanel 组件

创建 `tui/components/meta/CardPanel.tsx`：
- 显示决策卡片内容
- 支持键盘交互：
  - Tab/方向键切换卡片
  - a: 接受当前卡片
  - r: 拒绝当前卡片
  - A: 全部接受
  - R: 全部拒绝
  - Enter: 确认决策
  - Esc: 取消
- 状态显示：未选/已接受/已拒绝

### ✅ 第三步：LoopHistory 组件

创建 `tui/components/meta/LoopHistory.tsx`：
- 显示 Loop 历史时间线
- 状态图标：✓ (completed), ✗ (rolled_back), ~ (aborted)
- 显示 delta 变化

### ✅ 第四步：WelcomeScreen 组件

创建 `tui/components/meta/WelcomeScreen.tsx`：
- 形态 A：已有 `.meta/design.yaml`（返回用户）
- 形态 B：没有 `.meta/`（新用户）

### ✅ 第五步：Loop 主路由

创建 `tui/routes/loop/index.tsx`：
- 整合 Sidebar + 主区域
- 布局：左侧 Sidebar（26字符宽度）+ 右侧主区域
- 支持折叠的对话区

### ✅ 路由切换逻辑

更新 `tui/context/route.tsx`：
- 添加 `LoopRoute` 类型

更新 `tui/app.tsx`：
- 添加 Loop 路由到 Switch 组件

---

## 文件清单

### 新建文件

```
tui/components/meta/
├── Sidebar.tsx          # MetaDesign 状态侧边栏
├── CardPanel.tsx        # 决策卡片面板
├── LoopHistory.tsx      # Loop 历史时间线
└── WelcomeScreen.tsx    # 启动欢迎/引导页

tui/routes/loop/
└── index.tsx            # Loop 主路由
```

### 修改文件

```
tui/context/route.tsx    # 添加 LoopRoute 类型
tui/app.tsx              # 添加 Loop 路由
```

---

## 布局结构

```
启动时                     /meta 触发后
┌──────────────────────┐   ┌────────────┬────────────────────┐
│                      │   │            │                    │
│   WelcomeScreen      │   │  Sidebar   │    Loop 主区域     │
│   （形态 A 或 B）     │   │            │                    │
│                      │   │  REQ ████  │  [分析阶段]        │
│   如果有 .meta/       │   │  NEG (3)   │  → 生成中...       │
│   显示项目概览        │   │  EVAL      │                    │
│                      │   │            │  [决策阶段]        │
│   如果没有 .meta/     │   │  ─────     │  CardPanel         │
│   显示初始化引导      │   │  历史      │                    │
│                      │   │  loop-004  │  [对话界面]        │
│   按 / 输入命令       │   │  loop-003  │  （折叠，可展开）  │
│   输入 /meta 开始     │   │            │                    │
└──────────────────────┘   └────────────┴────────────────────┘
```

---

## 键盘快捷键

### CardPanel（决策阶段）
- `Tab` / `→`：下一个卡片
- `←`：上一个卡片
- `a`：接受当前卡片
- `r`：拒绝当前卡片
- `A`：全部接受
- `R`：全部拒绝
- `Enter`：确认决策
- `Esc`：取消

### Loop 主路由
- `/`：聚焦命令输入
- `c`：展开/折叠对话区
- `h`：展开/折叠 LoopHistory
- `q`：中止当前 loop

---

## 验证清单

```bash
bun dev .

# 验证 1：启动界面
# 在没有 .meta/ 的目录启动 → 显示 WelcomeScreen 形态 B

# 验证 2：项目状态界面
# 在有 .meta/design.yaml 的目录启动 → 显示 WelcomeScreen 形态 A

# 验证 3：Loop 界面
# 输入 /meta → 切换到 Loop 路由
# 左侧 Sidebar 显示 REQ/NEG/EVAL 数据

# 验证 4：决策阶段
# agent 生成卡片后 → CardPanel 自动出现
# Tab 键在卡片间切换，a/r 键选择
# Enter 确认后 CardPanel 消失

# 验证 5：对话降级
# 在 loop 路由按 c → 底部展开对话区
# 再按 c → 折叠
```

---

## 后续改进

1. **集成实际文件读取**：当前组件使用模拟数据，需要集成 `loadMetaDesign()`
2. **完善 CardPanel**：添加拒绝原因输入框
3. **添加动画**：Loop 状态切换的过渡动画
4. **优化性能**：Sidebar 数据缓存
5. **添加主题支持**：确保所有组件支持 dark/light 模式
