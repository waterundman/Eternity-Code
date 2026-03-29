# Eternity Code UI 优化完成报告

## 优化内容

### 1. MetaDesign Context 集成

创建 `tui/context/metadesign.tsx`：
- 使用 `createSimpleContext` 创建全局状态
- 自动加载 `.meta/design.yaml`
- 提供 `design()`, `loading()`, `error()`, `reload()` 等 API

### 2. Sidebar 组件优化

更新 `tui/components/meta/Sidebar.tsx`：
- 使用 MetaDesign context 获取真实数据
- 显示项目名称、阶段
- 显示需求覆盖度（8格条形图 + 百分比）
- 显示约束（🔒 标记）
- 显示负面方向
- 显示评估基线
- 显示 Loop 历史

### 3. CardPanel 交互优化

更新 `tui/components/meta/CardPanel.tsx`：
- 改进的键盘交互：
  - Tab/→/←/↑/↓ 导航
  - a/r 循环切换选择状态
  - A/R 全部接受/拒绝
  - Enter 展开/折叠详情
  - Ctrl+Enter 确认决策
  - Esc 清除选择
- 实时显示已接受/拒绝数量
- 焦点状态高亮
- 决策状态标记（✓ ACCEPTED / ✕ REJECTED）

### 4. Loop 主路由优化

更新 `tui/routes/loop/index.tsx`：
- 集成 MetaDesign context
- 动态调整布局（根据 phase 状态）
- 改进的状态栏显示
- 快捷键支持：
  - c: 切换对话区
  - h: 切换历史侧边栏
  - q: 中止 loop

### 5. App 集成

更新 `tui/app.tsx`：
- 添加 MetaDesignProvider
- 支持 Loop 路由

---

## 文件清单

### 新建文件

```
tui/context/
└── metadesign.tsx       # MetaDesign 全局状态
```

### 修改文件

```
tui/components/meta/
├── Sidebar.tsx          # 使用 MetaDesign context
├── CardPanel.tsx        # 改进交互体验
└── LoopHistory.tsx      # 保持不变

tui/routes/loop/
└── index.tsx            # 集成 context，优化布局

tui/
└── app.tsx              # 添加 MetaDesignProvider
```

---

## 布局结构

```
┌────────────┬────────────────────────────────────────┐
│            │                                        │
│  Sidebar   │         Loop 主区域                    │
│            │                                        │
│  项目名    │  [输出区域]                            │
│  stage     │  ● Phase: IDLE                        │
│            │                                        │
│  ─────     │  Available commands:                   │
│  REQ       │    /meta         Start a new loop      │
│  ████ 75%  │    /meta-decide  Review pending cards   │
│  ███░ 41%  │    /meta-execute Execute accepted cards │
│            │                                        │
│  ─────     │  ──────────────────────────────────    │
│  CONSTRAINTS                                       │
│  🔒 auth   │  [决策区域 - 仅 decide 阶段显示]      │
│  🔒 latency│  ┌─ CARD-041 ─────────────────────┐   │
│            │  │ 目标  ...                      │   │
│  ─────     │  │ 置信  ████████░░ 72%           │   │
│  NEG (3)   │  └───────────────────────────────┘   │
│  NEG-001   │                                        │
│  NEG-002   │  ──────────────────────────────────    │
│            │  [对话区域 - 按 c 展开]                │
│  ─────     │                                        │
│  LOOPS     │  ──────────────────────────────────    │
│  #4 ✓ +0.06│  Eternity Code | Project | Phase: ... │
│  #3 ✗ -0.03└────────────────────────────────────────┘
└────────────┘
```

---

## 快捷键

### 全局（Loop 路由）
- `c`: 切换对话区
- `h`: 切换历史侧边栏
- `q`: 中止 loop
- `/`: 聚焦命令输入

### CardPanel（决策阶段）
- `Tab` / `→`: 下一个卡片
- `←`: 上一个卡片
- `↑` / `↓`: 上/下移动
- `a`: 接受当前卡片（循环切换）
- `r`: 拒绝当前卡片（循环切换）
- `A`: 全部接受
- `R`: 全部拒绝
- `Enter`: 展开/折叠详情
- `Ctrl+Enter`: 确认所有决策
- `Esc`: 清除选择/折叠详情
- `0`: 跳到第一个卡片

---

## 验证结果

```bash
$ bun typecheck
$ tsgo --noEmit
# 无错误
```

---

## 后续改进

1. **集成命令触发**：当用户输入 `/meta` 时自动切换到 Loop 路由
2. **实时数据更新**：在 loop 执行过程中实时更新 Sidebar 和输出
3. **添加动画**：状态切换的过渡动画
4. **错误处理**：更友好的错误提示
5. **主题适配**：确保所有颜色在 dark/light 主题下都清晰可见
