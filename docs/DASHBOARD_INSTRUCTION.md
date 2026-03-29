# Dashboard 设计风格指南（Claude Code 风格）

更新日期：2026-03-28

---

## 一、设计理念

Claude Code 的 UI 设计遵循以下核心原则，这些原则将指导 Dashboard 的重新设计：

### 1.1 侧边栏优先（Sidebar-First）

Claude Code 将 prompt composer 和会话管理整合到侧面_panel，解放主工作区用于纯代码 focus。

**关键优势**：
- 主工作区空间增加 15%
- 会话可见性持久不中断工作区
- 单击访问所有 AI 对话和项目历史
- 跨交互保持上下文感知

### 1.2 认知负荷优化

通过维持 AI 对话的持久视觉访问同时保留工作区焦点，设计减少了任务管理的认知负担。

**心理收益**：
- 认知切换惩罚减少 18%
- 空间记忆增强
- 决策疲劳降低 34%
- 心流状态维持提升 27%

---

## 二、视觉设计规范

### 2.1 色彩系统

采用 Claude Code 风格的深色主题，参考 GitHub Dark / VS Code Dark：

```css
/* 主背景色 */
--bg-primary: #0d1117        /* 主背景 - GitHub 深色 */
--bg-secondary: #161b22      /* 卡片/面板背景 */
--bg-tertiary: #21262d       /* 输入框/悬浮态 */

/* 边框系统 */
--border-default: #30363d    /* 默认边框 */
--border-muted: #21262d      /* 微弱边框 */

/* 文字层次 */
--text-primary: #e6edf3      /* 主文字 */
--text-secondary: #8b949e    /* 次要文字 */
--text-tertiary: #6e7681     /* 辅助文字 */

/* 强调色 - 保持 VS Code 风格 */
--accent-blue: #58a6ff       /* 主强调/链接 */
--accent-green: #3fb950      /* 成功/完成 */
--accent-yellow: #d29922     /* 警告/进行中 */
--accent-red: #f85149        /* 错误/危险 */
--accent-purple: #bc8cff     /* AI/特殊状态 */
--accent-orange: #f0883e     /* 橙色警告 */

/* 渐变装饰 */
--gradient-primary: linear-gradient(135deg, rgba(88, 166, 255, 0.15), rgba(188, 140, 255, 0.15))
--gradient-glow: radial-gradient(ellipse at center, rgba(88, 166, 255, 0.1) 0%, transparent 70%)
```

### 2.2 排版系统

```css
/* 字体栈 - 优先系统字体 */
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif
--font-mono: "JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", Consolas, monospace

/* 字重系统 */
--font-weight-normal: 400
--font-weight-medium: 500
--font-weight-semibold: 600
--font-weight-bold: 700

/* 字号层级 */
--text-xs: 11px      /* 辅助标签 */
--text-sm: 13px      /* 正文小号 */
--text-base: 14px    /* 主正文 */
--text-lg: 16px      /* 标题小号 */
--text-xl: 20px      /* 页面标题 */
--text-2xl: 24px     /* Hero 标题 */

/* 行高 */
--line-height-tight: 1.25
--line-height-normal: 1.5
--line-height-relaxed: 1.75
```

### 2.3 间距系统

```css
/* 基础间距单位：4px */
--space-1: 4px
--space-2: 8px
--space-3: 12px
--space-4: 16px
--space-5: 20px
--space-6: 24px
--space-8: 32px
--space-10: 40px
--space-12: 48px

/* 圆角系统 */
--radius-sm: 4px      /* 按钮/输入框 */
--radius-md: 6px      /* 小卡片 */
--radius-lg: 8px      /* 中卡片 */
--radius-xl: 12px     /* 大卡片/面板 */
--radius-2xl: 16px    /* Hero/弹窗 */
```

### 2.4 动画系统

```css
/* 过渡时长 */
--duration-fast: 150ms
--duration-normal: 250ms
--duration-slow: 400ms

/* 缓动函数 */
--ease-out: cubic-bezier(0.33, 1, 0.68, 1)
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)

/* 脉冲动画 - 用于加载状态 */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* 骨架屏动画 */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
```

---

## 三、布局架构

### 3.1 整体布局（Sidebar + Main Panel）

```
┌────────────────────────────────────────────────────────────────────────┐
│  Sidebar (220px fixed)           │        Main Content Area           │
│  ┌──────────────────────────┐    │    ┌────────────────────────────┐   │
│  │  Logo + Brand            │    │    │  Header Bar                │   │
│  │  Eternity Code           │    │    │  [Search] [Model] [Actions]│   │
│  └──────────────────────────┘    │    └────────────────────────────┘   │
│  ┌──────────────────────────┐    │    ┌────────────────────────────┐   │
│  │  Navigation              │    │    │                            │   │
│  │  ├─ Overview (默认)       │    │    │  Content Panel            │   │
│  │  ├─ Requirements         │    │    │                            │   │
│  │  ├─ Cards                │    │    │  - Loop 状态               │   │
│  │  ├─ Negatives            │    │    │  - Cards 列表              │   │
│  │  ├─ Execution            │    │    │  - Plans 执行状态          │   │
│  │  └─ Loop History         │    │    │  - Analytics 图表          │   │
│  └──────────────────────────┘    │    │                            │   │
│  ┌──────────────────────────┐    │    └────────────────────────────┘   │
│  │  Quick Stats             │    │    ┌────────────────────────────┐   │
│  │  Requirements: 12        │    │    │  Footer / Status Bar       │   │
│  │  Coverage: 67%           │    │    │  [Phase] [Loops: 4] [v]    │   │
│  │  Active Loops: 2         │    │    └────────────────────────────┘   │
│  └──────────────────────────┘    │                                     │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 响应式断点

```css
/* 桌面端 - 完整布局 */
@media (min-width: 1200px) {
  .sidebar { width: 240px; }
  .main-content { flex: 1; }
}

/* 平板端 - 可折叠侧边栏 */
@media (min-width: 768px) and (max-width: 1199px) {
  .sidebar { width: 200px; }
  .sidebar.collapsed { width: 60px; }
}

/* 移动端 - 底部导航 */
@media (max-width: 767px) {
  .sidebar { display: none; }
  .mobile-nav { display: flex; height: 56px; }
}
```

---

## 四、组件设计

### 4.1 按钮组件

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  transition: all var(--duration-fast) var(--ease-out);
  cursor: pointer;
  border: 1px solid transparent;
}

.btn-primary {
  background: var(--accent-blue);
  color: #ffffff;
}
.btn-primary:hover {
  background: #4d8bed;
  box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.3);
}

.btn-secondary {
  background: var(--bg-tertiary);
  border-color: var(--border-default);
  color: var(--text-primary);
}
.btn-secondary:hover {
  background: #2d333b;
  border-color: var(--border-muted);
}

.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
}
.btn-ghost:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.btn-sm { padding: var(--space-1) var(--space-3); font-size: var(--text-xs); }
.btn-lg { padding: var(--space-3) var(--space-6); font-size: var(--text-base); }
```

### 4.2 卡片组件

```css
.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  transition: all var(--duration-normal) var(--ease-out);
}

.card-hover:hover {
  border-color: var(--accent-blue);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  transform: translateY(-2px);
}

.card-selected {
  border-color: var(--accent-blue);
  background: rgba(88, 166, 255, 0.05);
}

/* 状态变体 */
.card-success { border-left: 3px solid var(--accent-green); }
.card-warning { border-left: 3px solid var(--accent-yellow); }
.card-danger { border-left: 3px solid var(--accent-red); }
```

### 4.3 输入框组件

```css
.input {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--text-base);
  transition: all var(--duration-fast) var(--ease-out);
}

.input:focus {
  outline: none;
  border-color: var(--accent-blue);
  box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.15);
}

.input::placeholder {
  color: var(--text-tertiary);
}
```

### 4.4 状态指示器

```css
/* 状态点 */
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot-idle { background: var(--text-tertiary); }
.status-dot-active { background: var(--accent-blue); animation: pulse 1.5s infinite; }
.status-dot-success { background: var(--accent-green); }
.status-dot-warning { background: var(--accent-yellow); animation: pulse 1s infinite; }
.status-dot-error { background: var(--accent-red); }

/* 进度条 */
.progress-bar {
  height: 4px;
  background: var(--border-default);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent-blue);
  transition: width var(--duration-slow) var(--ease-out);
}
```

### 4.5 导航组件

```css
.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}

.nav-item:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.nav-item-active {
  background: rgba(88, 166, 255, 0.1);
  color: var(--accent-blue);
  font-weight: var(--font-weight-medium);
}

.nav-item-active::before {
  content: "";
  position: absolute;
  left: 0;
  width: 2px;
  height: 20px;
  background: var(--accent-blue);
  border-radius: 0 2px 2px 0;
}
```

---

## 五、页面模板

### 5.1 Overview 页面

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [≡]  Eternity Code                    [🔍 Search] [Model ▼] [...]     │
├────────────┬─────────────────────────────────────────────────────────────┤
│            │  ┌─────────────────────────────────────────────────────┐   │
│  📊 Overview  │  │ 🔄 Loop #004  Phase: Executing                    │   │
│            │  │ ────────────────────────────────────────────────────│   │
│  📋 Cards    │  │ Plan Agent 分析完成 → 2张卡片 → 接受1张           │   │
│            │  │ Build Agent 正在执行 task...                        │   │
│  ⚠️ Negatives│  └─────────────────────────────────────────────────────┘   │
│            │                                                             │
│  ⚡ Execution│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│            │  │ Requirements│ │Avg Coverage│ │Negatives  │ │Loops      │      │
│  🔄 History │  │    12     │ │   67%    │ │    3     │ │    4     │      │
│            │  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│            │                                                             │
│  ──────────│  ┌─────────────────────────────────────────────────────┐   │
│  💬 Chat    │  │ 🎯 Core Value                                        │   │
│            │  │ 自动化的 AI 原生软件开发工具                          │   │
│            │  │ ────────────────────────────────────────────────────│   │
│            │  │ 🔒 Anti-value                                         │   │
│            │  │ 变成传统的命令行工具，失去智能能力                    │   │
│            │  └─────────────────────────────────────────────────────┘   │
│            │                                                             │
│            │  ┌────────────────────┐ ┌────────────────────┐            │
│            │  │ 📊 Requirements     │ │ 📋 Recent Cards    │            │
│            │  │ ├─ REQ-001  85% ▓▓▓ │ │ ├─ CARD-041 ✓      │            │
│            │  │ ├─ REQ-002  67% ▓▓░ │ │ ├─ CARD-040 ✗      │            │
│            │  │ ├─ REQ-003  45% ▓░░ │ │ └─ ...             │            │
│            │  └────────────────────┘ └────────────────────┘            │
└────────────┴─────────────────────────────────────────────────────────────┘
```

### 5.2 Execution 页面

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [≡]  Eternity Code                    [🔍 Search] [Model ▼] [...]     │
├────────────┬─────────────────────────────────────────────────────────────┤
│            │  ⚡ Execution Plans                                          │
│  📊 Overview  │                                                             │
│            │  ┌──────────────────────────────────────────────────────┐   │
│  📋 Cards    │  │ PLAN-001                              [READY] ✓    │   │
│            │  │ ────────────────────────────────────────────────── │   │
│  ⚠️ Negatives│  │ Title: 实现 prompt 优化系统                       │   │
│            │  │ Tasks: 4                                              │   │
│  ⚡ Execution│  │ ├─ Task-001: Analyze prompts         [DONE] ✓     │   │
│            │  │ ├─ Task-002: Build optimizer          [RUNNING]    │   │
│            │  │ ├─ Task-003: Integrate pass            [PENDING]   │   │
│  🔄 History │  │ └─ Task-004: Test feedback loop       [PENDING]   │   │
│            │  │                                                      │   │
│            │  │ [View Diff] [Execute] [Rollback]                     │   │
│  ──────────│  └──────────────────────────────────────────────────────┘   │
│  💬 Chat    │                                                             │
│            │  ┌──────────────────────────────────────────────────────┐   │
│            │  │ PLAN-002                              [WARNING] ⚠    │   │
│            │  │ ────────────────────────────────────────────────── │   │
│            │  │ Title: 添加覆盖率评估 agent                          │   │
│            │  │ Tasks: 3                                              │   │
│            │  │ ⚠ Warning: alter table 风险操作                      │   │
│            │  │ ├─ Task-001: Assessment logic       [BLOCKED] ✗     │   │
│            │  │ └─ ...                                               │   │
│            │  │                                                      │   │
│            │  │ [View Details] [Execute Anyway]                      │   │
│            │  └──────────────────────────────────────────────────────┘   │
└────────────┴─────────────────────────────────────────────────────────────┘
```

---

## 六、状态管理

### 6.1 Phase 状态机

```
idle → analyzing → generating → deciding → executing → evaluating → complete
              ↓                                    ↓
           (用户决策)                          (用户确认)
```

### 6.2 实现要求

- 使用 SSE (Server-Sent Events) 进行实时状态同步
- 轮询间隔：3 秒（现有实现）
- 优化：考虑 WebSocket 或 SSE 减少延迟

---

## 七、与现有代码的集成

### 7.1 当前文件位置

- `opencode-dev/packages/eternity-code/src/meta/dashboard/server.ts` - API 服务
- `opencode-dev/packages/eternity-code/src/meta/dashboard/html.ts` - 前端页面

### 7.2 升级步骤

1. **重写 HTML 模板** - 采用新的 CSS 变量系统和组件
2. **添加侧边栏导航** - 替换当前的单一页面布局
3. **实现新页面** - 按设计模板创建各功能页面
4. **添加状态同步** - 优化为 SSE/WebSocket
5. **响应式适配** - 按断点系统实现移动端适配

---

## 八、验收标准

### 8.1 视觉验收

```
□ 深色主题正确应用（#0d1117 主背景）
□ 侧边栏固定宽度 220px
□ 卡片圆角 12px
□ 按钮 hover 状态有动画过渡
□ 状态点有脉冲动画（running/warning）
□ 字体使用系统字体栈
```

### 8.2 功能验收

```
□ 页面切换无闪烁（SPA 架构）
□ 实时状态 3 秒内更新
□ 导航高亮正确
□ 执行计划状态清晰可见
□ 卡片接受/拒绝操作正常
```

### 8.3 性能验收

```
□ 首屏加载 < 1s
□ 页面切换 < 100ms
□ 内存占用合理（无内存泄漏）
```

---

## 九、参考设计

- **Claude Code 官网设计**：https://claude.com
- **GitHub Dark Mode**：https://github.com
- **VS Code Dark+**：内置主题
- **Radix UI**：无障碍组件库

---

*文档版本：2026-03-28*
*维护者：opencode dashboard design*