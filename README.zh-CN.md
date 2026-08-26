# Pi-TUIX

<div align="center">

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md) | [Español](README.es.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Node.js >=22.19](https://img.shields.io/badge/Node.js-%3E%3D22.19-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![Pi Coding Agent >=0.84](https://img.shields.io/badge/Pi%20Coding%20Agent-%3E%3D0.84-4B5563)](https://github.com/badlogic/pi-mono)

</div>

> [!NOTE]
> 本翻译由社区维护。如有错误，欢迎提交 PR！内容基于当前 [`README.md`](README.md)。

> **状态：** 早期开发阶段。`pi-tuix` 尚未发布到 npm。

**Pi-TUIX** 是 Pi Coding Agent 的开源终端 UI 扩展。它为长时间编码会话提供更清晰、更紧凑的界面，同时模型请求、内置工具、会话、权限与 provider 集成仍由 Pi 管理。

## 为什么需要 Pi-TUIX

编码会话变长后，真正费精力的往往是判断当前在做什么、修改了什么、是否需要人工介入。Pi-TUIX 优化这些信息的层级，但不会把工作迁移到另一套 Agent runtime。

- 在 shell 中查看当前模型、工作区与上下文信号。
- 持续看到运行和流式状态，减少 transcript 噪音。
- 在同一会话中恢复 Pi 默认界面。
- 作为可移除的 package 使用，Pi 始终是系统事实来源。

## 快速开始

### 安装开发版

要求：Node.js `>=22.19.0`、Pi Coding Agent `>=0.84.0`。

```bash
npm install
npm run check
pi install /absolute/path/to/pi-tuix --approve
pi list
```

Pi 会把本地路径记录到用户设置中，并在所有项目中加载这份工作目录。修改代码后请重启 Pi。仅当前项目使用时执行 `pi install -l /absolute/path/to/pi-tuix --approve`；只做一次性预览时执行 `pi -e ./extensions/index.ts`，它不会保存安装记录。

### 从 npm 安装（首次发布后）

```bash
pi install npm:pi-tuix
```

项目级安装请使用 `pi install -l npm:pi-tuix`。

安装来源切换见[开发版使用手册](docs/development.md)，开发版、预发布版与正式版规则见[发版流程](docs/releasing.md)。

## 当前原型

基础版本通过 Pi 的公开 `ExtensionAPI` 提供 Pi-TUIX header、footer、终端标题、working indicator、editor chrome，以及紧凑的 Read/Bash/Edit/Write 展示。工具执行过程仍原样委托给 Pi。

Editor border 会显示 `READY/WORKING`、输入行数和字符数。它继承 Pi 公开的 `CustomEditor`，保留提交、历史记录、autocomplete、粘贴处理和应用快捷键。

每个紧凑工具行都会明确显示动作、目标、状态和 `ATTENTION/CLEAR` 信号。Read 与 Bash 汇总输出规模，Edit 展示 diff 统计，Write 展示写入行数；展开后可查看经过 ANSI-aware 宽度约束的输出或 diff。

以下命令均可逆：

| 命令 | 用途 |
| --- | --- |
| `/pituix` | 启用或恢复 Pi-TUIX shell |
| `/pituix-default` | 恢复 Pi 默认 TUI 组件 |
| `/pituix-about` | 查看 package 与兼容的 Pi 版本 |
| `/pituix-steer <消息>` | 立即纠偏当前执行中的任务 |
| `/pituix-followup <消息>` | 排队追加，等当前任务结束后执行 |
| `/pituix-queue` | 查看 Pi 是否还有待处理消息 |

可在 Pi 的 `/settings` 中选择内置的 `pi-tuix-dark` 主题。

## 工作原理

Pi-TUIX 是建立在 Pi 公开扩展 hook 上的展示层：

```text
Pi Coding Agent（runtime、provider、工具、会话、权限）
                     |
               public ExtensionAPI
                     |
                 Pi-TUIX shell
             （header、footer、状态、主题）
```

组件只负责渲染状态。生命周期 handler 将 Pi 事件转换为小型 UI 状态更新，不会在渲染过程中调用 provider 或执行 shell 命令。后续工具 renderer 只替换调用与结果的展示，并将执行过程原样委托给 Pi。

## 路线图

1. **Shell（当前）：** header、footer、终端标题、主题、working state 与可逆的 editor chrome。
2. **工具界面（当前）：** 紧凑的 Read/Bash/Edit/Write 行，明确区分 queued/running/success/error/cancelled，支持展开输出与 diff 摘要。
3. **流式界面：** thinking 标签、进度、token/context 状态与稳定刷新。
4. **控制界面（进行中）：** 已提供 steer/follow-up 队列命令；审批适配、计划审阅与键盘约定仍在规划中。
5. **会话界面：** 在 Pi 提供可靠公开事件的前提下，展示 context、resume 引用与 subagent 状态。

范围和验收条件见 [docs/product-context.md](docs/product-context.md)，产品边界见 [docs/positioning.md](docs/positioning.md)，runtime 设计见 [docs/architecture.md](docs/architecture.md)。

## 兼容性约定

- **Host：** Pi Coding Agent `>=0.84.0`。
- **UI runtime：** 将 `@earendil-works/pi-tui` `>=0.84.0` 声明为 peer dependency。
- **职责：** 模型调用、工具执行、会话、权限、凭据与持久化由 Pi 管理。
- **公开 API：** 只依赖 Pi 文档化的扩展契约，不 patch 或 vendoring 私有模块。
- **可逆：** 禁用或移除 Pi-TUIX 不需要迁移 Pi 会话或项目文件。
- **来源：** 不包含 Claude Code 源码、私有协议、品牌或专有素材。

## 文档

- [产品背景](docs/product-context.md) - 用户问题、MVP 流程与非目标
- [产品定位](docs/positioning.md) - 职责边界与设计原则
- [架构](docs/architecture.md) - 事件到视图规则与兼容策略
- [开发版使用](docs/development.md) - 永久本地安装与渠道切换
- [发版流程](docs/releasing.md) - 版本、npm 渠道、Tag 与发布校验
- [文档规则](docs/README.md) - 哪些内容属于公开文档
- [贡献指南](CONTRIBUTING.md) - 本地开发与 PR 要求
- [安全策略](SECURITY.md) - 漏洞报告方式

## 参与贡献

欢迎提交范围明确的 issue 和 PR。修改 renderer 或生命周期 hook 前请运行：

```bash
npm run check
npm run test
npm run pack:check
```

UI 修改应在窄屏与常规宽度下检查，并覆盖 idle、running、success、error、cancellation 状态。工具 renderer 的修改必须证明 Pi 原有的执行、取消、错误和权限行为保持不变。完整要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

Pi-TUIX 使用 [MIT License](LICENSE)。
