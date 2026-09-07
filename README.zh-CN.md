# Pi-TUIX

<div align="center">

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md) | [Español](README.es.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Node.js >=22.19](https://img.shields.io/badge/Node.js-%3E%3D22.19-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![Pi Coding Agent >=0.84](https://img.shields.io/badge/Pi%20Coding%20Agent-%3E%3D0.84-4B5563)](https://github.com/badlogic/pi-mono)

</div>

> [!NOTE]
> 本翻译由社区维护。如有错误，欢迎提交 PR！内容基于当前 [`README.md`](README.md)。

> **状态：** `0.1.0` 源码版本。`pi-tuix` 尚未发布到 npm。

**Pi-TUIX** 是 Pi Coding Agent 的开源终端 UI 扩展。它为长时间编码会话提供更清晰、更紧凑的界面，同时模型请求、内置工具、会话、权限与 provider 集成仍由 Pi 管理。

## 为什么需要 Pi-TUIX

编码会话变长后，真正费精力的往往是判断当前在做什么、修改了什么、是否需要人工介入。Pi-TUIX 优化这些信息的层级，但不会把工作迁移到另一套 Agent runtime。

- 在 shell 中查看当前模型、工作区与上下文信号。
- 持续看到运行和流式状态，减少 transcript 噪音。
- 在同一会话中恢复 Pi 默认界面。
- 作为可移除的 package 使用，Pi 始终是系统事实来源。

## 快速开始

### 安装开发版

要求：Node.js `>=22.19.0`、Pi Coding Agent `>=0.84.0`。目前尚未发布 npm 包，开发版需要使用本地源码目录。先克隆仓库，或直接使用已有的 checkout：

```bash
git clone https://github.com/HuangYuChuh/pi-tuix.git
cd pi-tuix
npm install
npm run check
pi install /absolute/path/to/pi-tuix --approve
pi list
```

Pi 会把本地路径记录到用户设置中，并在所有项目中加载这份工作目录。修改代码后请重启 Pi。仅当前项目使用时执行 `pi install -l /absolute/path/to/pi-tuix --approve`；只做一次性预览时执行 `pi -e ./extensions/index.ts`，它不会保存安装记录。

### 从 npm 安装

Pi-TUIX 目前尚未发布到 npm，因此暂时不能使用 `pi install npm:pi-tuix`。正式发布后，安装命令和发布流程会记录在[发版流程](docs/releasing.md)中。

本地安装方式见[开发版使用手册](docs/development.md)，开发版、预发布版与正式版规则见[发版流程](docs/releasing.md)。

## 当前开发版本

当前 shell 依据 Claude Code 2.1.263 的实际终端界面调整：紧凑启动信息、上下横线输入区、快捷键帮助和单行底栏。`/pituix-status` 可切换详细统计。完整复刻尚未完成，已观察的界面、已实现部分和剩余差异见[对照报告](docs/claude-code-parity.md)。

编辑器继承 Pi 公开的 `CustomEditor`，保留提交、历史、自动补全和粘贴行为。空输入时按 `?` 查看帮助；`/pituix-default` 恢复原生组件与之前的主题。工具执行仍原样委托给 Pi。

`/pituix-default` 会保存关闭偏好，`/pituix` 会保存启用偏好；设置中的开关使用同一状态，重启或重载后仍然生效。设置页关闭后统一应用启用状态，关闭期间的运行不会新增 Pi-TUIX 完成记录或性能通知。图标模式也应用于工具行、工作提示、完成记录及会话预览。

输入框上方显示当前思考强度及 Pi 的实际快捷键。`/pituix-settings` 提供可搜索的设置页：输入关键词筛选，Enter 选中结果，再按 Enter 或空格修改；Tab 切换分类，Esc 依次清空搜索、离开搜索框、关闭页面。

每个紧凑工具行都会显示动作、目标、状态，并用 `ATTENTION` 标出需要关注的错误。Read 默认只显示行数摘要，Bash 显示输出，Edit 使用 `Update` 标题和带行号的 diff，Write 预览带行号的正文。长预览保留前后各两行；collapsed 仅保留摘要，expanded 展示完整输出或 diff，也可以展开 Read 正文。错误保留详情，所有视图均使用 ANSI-aware 宽度约束。

连续成功的 Read/Bash 调用会合并为数量摘要：文件路径去重，Bash 按调用次数计数。展开工具后可查看每一次调用。错误、取消、图片和截断结果单独显示；助手正文和其他工具会分隔摘要。恢复会话时通过 Pi 的公开会话分支重建分组。

参考深色主题中的 Edit diff 使用带行号的 `+/-` 标记、整行底色和更深的改动词底色。新增行与上下文行沿用 Pi 的语法解析器，其他主题保留 Pi 的 diff 样式，并支持 256 色和无色终端。

工作行显示实际耗时，以及 Pi 已上报的输出 token 数。任务完全结束后，完成行显示耗时和结束时间；取消时显示中断提示。Pi 为每次完全结束的运行保存一条仅用于界面的记录，后续请求和恢复、重载会话时都会保留，不会进入模型上下文。`/pituix-default` 隐藏这些行，`/pituix` 恢复显示；移除扩展后仍可正常使用原有 Pi 会话。没有计时记录的旧运行不会补写估算数据。

`/pituix-resume` 可搜索已保存的 Pi 会话。输入关键词筛选，按 Enter 选中结果，再按 Enter 恢复。空格打开只读会话预览，显示独立工具结果、diff、回答的模型和时间、完成提示；方向键、PgUp/PgDn、Home/End 和滚轮用于滚动，Ctrl+O 展开详情，Esc 返回列表，Ctrl+A 切换项目范围。预览遵循 Pi 的当前分支和压缩规则，不执行历史工具，也不改写会话文件。实际会话切换由 Pi 完成，原生 `/resume` 和 `/tree` 仍可使用。

普通和全屏终端模式都会按参考样式实时显示用户和助手消息，同时保留 Pi 的编辑器、流式输出、工具、通知、组件和队列。全屏模式的滚动、提示词跳转、搜索和鼠标选择由 Pi 的原生视口处理，共用同一份消息排版，关闭搜索后保留命中位置。普通模式使用终端滚动历史，也可以在 Pi 设置中直接切换两种模式。`/pituix-default` 可以在同一会话中恢复默认界面。

会话列表会显示文件大小及运行结束时记录的 Git 分支，预览底部显示消息数和同一历史分支。Ctrl+B 按当前 Git 分支筛选，旧会话没有分支记录时不会被算作匹配。元数据在可见选择附近异步加载；开启分支筛选时会检查当前项目范围内的会话，最多同时读取两个文件，关闭后停止排队读取。

Ctrl+R（或 Pi 配置的会话重命名快捷键）编辑所选会话名称，Enter 通过 Pi 的公开会话 API 保存，Esc 取消草稿。保存后刷新列表，不会自动恢复会话。当前会话使用 Pi 的实时名称接口，其他会话写入 Pi 原生名称记录；确认重命名旧格式文件时，Pi 可能执行自身的格式迁移。搜索、筛选和预览保持只读。

`/pituix-transcript` 还可以打开当前对话及工具结果的只读快照。Page Up/Down 或 Home/End 滚动，工具展开快捷键显示详情与思考内容，Esc 返回原来的编辑器。查看不会重新执行工具或修改会话数据，其他扩展工具使用 Pi 的通用视图。

这两种预览会在消息和工具结果旁显示 `[Image #1]` 等图片附件编号。全屏模式点击附件行即可打开图片；普通模式使用终端的链接打开手势。支持的 PNG/JPEG/GIF/WebP 数据会异步生成私有临时文件，运行环境正常关闭时清理；缺失或不支持的数据保留不可用提示。编号遵循当前展示分支，重复图片也各自编号。主对话中的图片粘贴与媒体展示仍沿用 Pi 原生行为。

以下命令均可逆：

| 命令 | 用途 |
| --- | --- |
| `/pituix` | 启用或恢复 Pi-TUIX shell |
| `/pituix-default` | 恢复 Pi 默认 TUI 组件 |
| `/pituix-compact` | 将参考样式的工具展示收起为摘要行 |
| `/pituix-three-layer` | 显示参考样式的工具预览，保留展开能力 |
| `/pituix-mode <collapsed\|preview\|expanded>` | 设置工具详情模式，默认是 preview |
| `/pituix-status` | 切换简洁底栏和详细统计 |
| `/pituix-model` | 在编号列表中选择 Pi 模型，并调整思考强度 |
| `/pituix-resume` | 搜索、筛选、重命名、预览和恢复已保存的 Pi 会话 |
| `/pituix-session` | 浏览当前 Pi 会话树并跳转到已有条目 |
| `/pituix-transcript` | 滚动查看当前对话快照及工具详情 |
| `/pituix-settings` | 配置界面、底栏、图标和统计 |
| `/pituix-about` | 查看 package 与兼容的 Pi 版本 |
| `/pituix-steer <消息>` | 立即纠偏当前执行中的任务 |
| `/pituix-followup <消息>` | 排队追加，等当前任务结束后执行 |
| `/pituix-queue` | 查看 Pi 是否还有待处理消息 |
| `/pituix-plan [show\|hide\|clear]` | 控制自动识别出的只读计划面板 |

启用 shell 时会应用内置的 `pi-tuix-dark` 主题，也可在 Pi 的 `/settings` 中切换主题。

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

组件只负责渲染状态。生命周期 handler 将 Pi 事件转换为小型 UI 状态更新，不会在渲染过程中调用 provider 或执行 shell 命令。工具 renderer 只替换调用与结果的展示，并将执行过程原样委托给 Pi。

流式状态会按 Turn 区分 thinking、回复文字与工具执行。Context 使用量到 80% 显示 `HIGH`，到 95% 显示 `CRITICAL`。当助手输出包含 `Plan:`、`计划：`及编号或复选框步骤时，Pi-TUIX 会在编辑器上方显示自适应宽度的只读计划面板。面板识别勾选项和 `[DONE:n]` 标记，但不会修改提示词、工具或执行过程。

## 路线图

1. **Shell（当前）：** header、footer、终端标题、主题、working state 与可逆的 editor chrome。
2. **工具界面（当前）：** 支持 collapsed、preview、expanded 三种模式的 Read/Bash/Edit/Write 行，明确区分 queued/running/success/error/cancelled，并提供 diff 摘要。
3. **流式界面（当前）：** thinking/responding/tool 状态、Turn 进度、thinking level、context 压力与稳定刷新。
4. **控制界面（进行中）：** 已提供 steer/follow-up 队列命令和只读计划审阅；审批适配与键盘约定仍在规划中。
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
