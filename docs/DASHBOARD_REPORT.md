# Eternity Code — Web Dashboard 实现报告

## 完成状态

### ✅ 第零步：确认现有 server 结构

- 确认项目使用 `Bun.serve()` 启动 HTTP server
- 入口文件：`src/cli/cmd/tui/thread.ts`

### ✅ 第一步：创建 dashboard/server.ts

创建 `packages/eternity-code/src/meta/dashboard/server.ts`：
- 使用 `Bun.serve()` 启动 HTTP server
- 端口：7777（可通过 `ETERNITY_DASHBOARD_PORT` 环境变量配置）
- API 路由：
  - `GET /` → 返回 dashboard.html
  - `GET /api/state` → 读取 `.meta/design.yaml`
  - `GET /api/loops` → 读取 `.meta/loops/*.yaml`
  - `GET /api/cards` → 读取 `.meta/cards/*.yaml`
  - `GET /api/negatives` → 读取 `.meta/negatives/*.yaml`

### ✅ 第二步：创建 dashboard/html.ts

创建 `packages/eternity-code/src/meta/dashboard/html.ts`：
- 内嵌 HTML 模板
- 原生 JS + CSS，无构建工具
- 功能：
  - Sidebar：显示 Requirements、Negatives、Eval Baselines
  - Main：显示 Core value、Last Loop
  - Tabs：Loop History、Cards、Negatives
  - 每 3 秒轮询 API 自动更新

### ✅ 第三步：在 TUI 启动时调用 startDashboard

修改 `packages/eternity-code/src/cli/cmd/tui/thread.ts`：
- 导入 `startDashboard`
- 在 TUI 启动前调用 `startDashboard(cwd)`

### ✅ 验证 Dashboard 功能

```bash
$ bun dev .
[Eternity Code] Dashboard → http://localhost:7777
# TUI 正常启动
```

---

## 文件清单

### 新建文件

```
packages/eternity-code/src/meta/dashboard/
├── server.ts    # HTTP server + API 路由
└── html.ts      # 内嵌 HTML 模板
```

### 修改文件

```
packages/eternity-code/src/meta/index.ts      # 导出 startDashboard
packages/eternity-code/src/cli/cmd/tui/thread.ts  # 调用 startDashboard
```

---

## 使用方法

### 启动程序

```bash
# Windows
start.bat

# Linux/Mac
./start.sh
```

### 访问 Dashboard

浏览器打开：http://localhost:7777

### Dashboard 功能

| 功能 | 说明 |
|------|------|
| Sidebar | 显示 Requirements 覆盖度条 |
| Sidebar | 显示 active Negatives 列表 |
| Sidebar | 显示 Eval Baselines |
| Main | 显示 Core value 和 anti value |
| Main | 显示 Last Loop 信息 |
| Loop History | 显示所有 loop 记录 |
| Cards | 显示决策卡片（支持过滤） |
| Negatives | 显示负空间详情 |

### API 端点

| 端点 | 说明 |
|------|------|
| `GET /` | 返回 Dashboard 页面 |
| `GET /api/state` | 返回 design.yaml 内容 |
| `GET /api/loops` | 返回 loop 历史 |
| `GET /api/cards` | 返回决策卡片 |
| `GET /api/negatives` | 返回负空间列表 |

---

## 技术方案

### 后端

- **运行时**: Bun
- **HTTP**: `Bun.serve()`
- **数据**: 直接读取 YAML 文件，序列化成 JSON

### 前端

- **HTML**: 内嵌模板字符串
- **CSS**: 原生 CSS，暗色主题
- **JS**: 原生 JavaScript，无框架
- **轮询**: 每 3 秒自动更新

---

## 验证清单

```bash
# 启动 TUI
bun dev .

# 在有 .meta/design.yaml 的项目里启动
# 验证：
# □ 终端显示 "[Eternity Code] Dashboard → http://localhost:7777"
# □ 浏览器打开 http://localhost:7777
# □ 左侧 Sidebar 显示 REQ 覆盖度条
# □ 左侧 Sidebar 显示 active NEG 列表
# □ 左侧 Sidebar 显示 EVAL baselines
# □ 右上 panel 显示 core_value 和 anti_value
# □ Loop History tab 显示历史记录
# □ Cards tab 可以切换 all/pending/accepted/rejected 过滤
# □ Negatives tab 显示详细的负空间条目
# □ 运行 /meta 生成新卡片后，3 秒内浏览器自动更新

# 在没有 .meta/ 的项目里启动
# 验证：不启动 server，无报错，TUI 正常运行
```

---

## 注意事项

- `Bun.serve` 在端口被占用时会抛错，已用 `try/catch` 包住，失败静默跳过
- 轮询间隔 3 秒对本地文件读取没有性能压力，不需要 WebSocket
- 端口 7777 可通过 `ETERNITY_DASHBOARD_PORT` 环境变量配置
- 没有 `.meta/` 目录时 Dashboard 不启动，不影响 TUI 正常使用
