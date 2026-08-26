# Pi-TUIX

<div align="center">

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md) | [Español](README.es.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Node.js >=22.19](https://img.shields.io/badge/Node.js-%3E%3D22.19-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![Pi Coding Agent >=0.84](https://img.shields.io/badge/Pi%20Coding%20Agent-%3E%3D0.84-4B5563)](https://github.com/badlogic/pi-mono)

</div>

> [!NOTE]
> 本翻譯由社群維護。如有錯誤，歡迎提交 PR！內容基於目前的 [`README.md`](README.md)。

> **狀態：** 早期開發階段。`pi-tuix` 尚未發佈至 npm。

**Pi-TUIX** 是 Pi Coding Agent 的開源終端 UI 擴充套件。它讓長時間的編碼工作階段更清晰、更緊湊，同時模型請求、內建工具、工作階段、權限及 provider 整合仍由 Pi 管理。

## 為什麼需要 Pi-TUIX

工作階段變長後，真正耗費心力的往往是判斷目前正在做什麼、修改了什麼，以及是否需要人工介入。Pi-TUIX 改善資訊層級，但不會把工作遷移到另一套 Agent runtime。

- 在 shell 中查看目前模型、workspace 與 context 訊號。
- 保持 running 與 streaming 狀態可見，減少 transcript 雜訊。
- 在同一工作階段中恢復 Pi 預設介面。
- 作為可移除的 package 使用，Pi 始終是 system of record。

## 快速開始

### 安裝開發版

需求：Node.js `>=22.19.0`、Pi Coding Agent `>=0.84.0`。

```bash
npm install
npm run check
pi install /absolute/path/to/pi-tuix --approve
pi list
```

Pi 會將本機路徑記錄在使用者設定中，並於所有專案載入該工作目錄。修改程式碼後請重新啟動 Pi。僅限目前專案時使用 `pi install -l /absolute/path/to/pi-tuix --approve`；一次性預覽則使用 `pi -e ./extensions/index.ts`，不會儲存安裝記錄。

### 從 npm 安裝（首次發佈後）

```bash
pi install npm:pi-tuix
```

專案層級安裝請使用 `pi install -l npm:pi-tuix`。

安裝來源切換請參閱[開發版使用手冊](docs/development.md)，開發版、預發佈版與正式版規則請參閱[發佈流程](docs/releasing.md)。

## 目前原型

基礎版本透過 Pi 的公開 `ExtensionAPI` 提供 header、footer、終端標題、working indicator、editor chrome，以及緊湊的 Read/Bash/Edit/Write 顯示。工具執行仍原樣委派給 Pi。

Editor border 會顯示 `READY/WORKING`、輸入行數與字元數。它繼承 Pi 公開的 `CustomEditor`，保留提交、歷史記錄、autocomplete、貼上處理與應用快捷鍵。

每個 tool row 都會清楚顯示 action、target、state 與 `ATTENTION/CLEAR`。Read/Bash 摘要輸出規模，Edit 顯示 diff stats，Write 顯示寫入行數；展開後可查看具 ANSI-aware 寬度限制的詳細內容。

| 指令 | 用途 |
| --- | --- |
| `/pituix` | 啟用或恢復 Pi-TUIX shell |
| `/pituix-default` | 恢復 Pi 預設 TUI 元件 |
| `/pituix-about` | 顯示 package 與相容的 Pi 版本 |
| `/pituix-steer <訊息>` | 立即修正目前執行中的任務 |
| `/pituix-followup <訊息>` | 排隊追加，等目前任務結束後執行 |
| `/pituix-queue` | 查看 Pi 是否還有待處理訊息 |

可在 Pi 的 `/settings` 中選擇內建的 `pi-tuix-dark` theme。

## 運作方式

```text
Pi Coding Agent（runtime、provider、工具、工作階段、權限）
                     |
               public ExtensionAPI
                     |
                 Pi-TUIX shell
             （header、footer、狀態、theme）
```

元件只負責渲染狀態。lifecycle handler 將 Pi event 轉換為小型 UI state update，不會在渲染過程中呼叫 provider 或執行 shell command。規劃中的 tool renderer 也會把執行原樣委派給 Pi，只取代顯示方式。

## 路線圖

1. **Shell（目前）:** header、footer、終端標題、theme、working state 與可逆的 editor chrome。
2. **工具介面（目前）:** 緊湊的 Read/Bash/Edit/Write row、queued/running/success/error/cancelled 狀態、可展開輸出與 diff 摘要。
3. **串流介面:** thinking label、進度、token/context 狀態與穩定刷新。
4. **控制介面（進行中）:** 已提供 steer/follow-up queue 指令；approval、plan review 與鍵盤操作仍在規劃中。
5. **工作階段介面:** 在 Pi 提供可靠公開 event 的範圍內呈現 context、resume reference 與 subagent 狀態。

詳細資訊請參閱 [產品背景](docs/product-context.md)、[產品定位](docs/positioning.md) 與 [架構](docs/architecture.md)。

## 相容性約定

- Pi Coding Agent `>=0.84.0`。
- `@earendil-works/pi-tui` `>=0.84.0` 為 peer dependency。
- model call、tool execution、session、permission、credential 與 persistence 由 Pi 管理。
- 僅使用文件化的公開 extension contract，不 patch 或 vendor 私有模組。
- 停用或移除時不必遷移 Pi session 或 project file。
- 不包含 Claude Code source、private protocol、branding 或 proprietary asset。

## 文件

- [產品背景](docs/product-context.md)
- [產品定位](docs/positioning.md)
- [架構](docs/architecture.md)
- [開發版使用](docs/development.md)
- [發佈流程](docs/releasing.md)
- [文件規則](docs/README.md)
- [貢獻指南](CONTRIBUTING.md)
- [安全政策](SECURITY.md)

## 參與貢獻

歡迎範圍明確的 issue 與 PR。修改前請執行：

```bash
npm run check
npm run test
npm run pack:check
```

UI 修改應在窄螢幕與一般寬度下檢查 idle、running、success、error、cancellation 狀態。tool renderer 修改必須證明 Pi 原有的執行、取消、錯誤與權限行為保持不變。

## 授權條款

Pi-TUIX 採用 [MIT License](LICENSE)。
