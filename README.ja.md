# Pi-TUIX

<div align="center">

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md) | [Español](README.es.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Node.js >=22.19](https://img.shields.io/badge/Node.js-%3E%3D22.19-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![Pi Coding Agent >=0.84](https://img.shields.io/badge/Pi%20Coding%20Agent-%3E%3D0.84-4B5563)](https://github.com/badlogic/pi-mono)

</div>

> [!NOTE]
> この翻訳はコミュニティによって管理されています。誤りがあれば PR を歓迎します。現在の [`README.md`](README.md) に基づいています。

> **ステータス:** 初期開発段階です。`pi-tuix` はまだ npm に公開されていません。

**Pi-TUIX** は Pi Coding Agent 向けのオープンソース Terminal UI 拡張です。長時間のコーディングセッションを見やすく整理しながら、モデルリクエスト、組み込みツール、セッション、権限、provider 連携は引き続き Pi が管理します。

## Pi-TUIX が必要な理由

セッションが長くなると、現在何が進行中で、何が変更され、介入が必要かを把握する負担が増えます。Pi-TUIX は別の Agent runtime に移行せず、この情報階層を改善します。

- shell でアクティブなモデル、workspace、context 情報を確認。
- transcript のノイズを抑えながら実行中・streaming 状態を表示。
- 同じセッション内で Pi 標準 UI に戻せる。
- 削除可能な package として導入し、Pi を system of record として維持。

## クイックスタート

### 開発版をインストールする

要件: Node.js `>=22.19.0`、Pi Coding Agent `>=0.84.0`。npm パッケージはまだ公開されていないため、開発版はローカルのソースチェックアウトからインストールします。まだチェックアウトしていない場合は、先にリポジトリをクローンしてください。

```bash
git clone https://github.com/HuangYuChuh/pi-tuix.git
cd pi-tuix
npm install
npm run check
pi install /absolute/path/to/pi-tuix --approve
pi list
```

Pi はローカルパスをユーザー設定に保存し、すべてのプロジェクトでその working tree を読み込みます。コード変更後は Pi を再起動してください。プロジェクト単位では `pi install -l /absolute/path/to/pi-tuix --approve`、保存しない一時的なプレビューでは `pi -e ./extensions/index.ts` を使用します。

### npm からのインストール

Pi-TUIX はまだ npm に公開されていないため、現時点では `pi install npm:pi-tuix` は使用できません。公開後の手順は[リリース手順](docs/releasing.md)に記載します。

インストール元の切り替えは[開発版ガイド](docs/development.md)、開発版・prerelease・stable の規則は[リリース手順](docs/releasing.md)を参照してください。

## 0.1.0 stable release

`0.1.0` は Pi の公開 `ExtensionAPI` を通じて header、footer、terminal title、working indicator、editor chrome、および三層の Read/Bash/Edit/Write 表示を提供します。tool execution は変更せず Pi に委譲します。既定は preview で、先頭2行と末尾2行を表示します。collapsed は要約のみ、expanded は全出力または diff を表示します。

Editor border は `READY/WORKING`、入力行数、文字数を表示します。Pi の公開 `CustomEditor` を継承するため、submit、history、autocomplete、paste、app shortcut はそのまま維持されます。

各 tool row は action、target、state、`ATTENTION/CLEAR` を明示します。Read/Bash は出力量、Edit は diff stats、Write は書き込み行数を要約し、展開すると ANSI-aware な幅制約のある詳細を確認できます。

| コマンド | 目的 |
| --- | --- |
| `/pituix` | Pi-TUIX shell を有効化または復元 |
| `/pituix-default` | Pi 標準 TUI component を復元 |
| `/pituix-compact` | 従来の compact tool renderer を使用 |
| `/pituix-three-layer` | 三層 tool renderer を使用 |
| `/pituix-mode <collapsed\|preview\|expanded>` | tool detail mode を設定（既定は preview） |
| `/pituix-about` | package と互換性のある Pi バージョンを表示 |
| `/pituix-steer <message>` | 実行中のタスクへ即時に修正指示を送る |
| `/pituix-followup <message>` | 現在の実行後に処理するメッセージをキューへ追加 |
| `/pituix-queue` | Pi に保留中のメッセージがあるか表示 |
| `/pituix-plan [show\|hide\|clear]` | 自動検出された読み取り専用 plan panel を操作 |

同梱の `pi-tuix-dark` theme は Pi の `/settings` から選択できます。

## 仕組み

```text
Pi Coding Agent（runtime、provider、tool、session、permission）
                     |
               public ExtensionAPI
                     |
                 Pi-TUIX shell
          （header、footer、indicator、theme）
```

component は state の描画だけを担当します。lifecycle handler が Pi event を小さな UI state update に変換し、描画の副作用として provider 呼び出しや shell command 実行は行いません。tool renderer は実行を Pi に委譲したまま、表示だけを置き換えます。

stream line は Turn ごとに thinking、応答、tool 実行を区別します。context は 80% で `HIGH`、95% で `CRITICAL` と表示します。`Plan:` 見出しと番号または checkbox の手順を含む応答は読み取り専用 plan panel になり、prompt、tool、実行は変更しません。

## ロードマップ

1. **Shell（現在）:** header、footer、terminal title、theme、working state、reversible editor chrome。
2. **Tool surface（現在）:** collapsed、preview、expanded に対応した Read/Bash/Edit/Write row、queued/running/success/error/cancelled 状態、展開可能な出力、diff summary。
3. **Stream surface (現在):** thinking/responding/tool 状態、Turn 進捗、thinking level、context pressure。
4. **Control surface (進行中):** steer/follow-up と読み取り専用 plan review を提供。approval と keyboard 操作は計画中。
5. **Session surface:** Pi が信頼できる公開 event を提供する範囲で context、resume reference、subagent 状態を表示。

詳細は [product context](docs/product-context.md)、[positioning](docs/positioning.md)、[architecture](docs/architecture.md) を参照してください。

## 互換性契約

- Pi Coding Agent `>=0.84.0`。
- `@earendil-works/pi-tui` `>=0.84.0` を peer dependency として利用。
- model call、tool execution、session、permission、credential、persistence は Pi が所有。
- 文書化された公開 extension contract のみを対象とし、private module は patch/vendor しない。
- 無効化・削除時に Pi session や project file の移行は不要。
- Claude Code の source、private protocol、branding、proprietary asset は含まない。

## ドキュメント

- [Product context](docs/product-context.md)
- [Positioning](docs/positioning.md)
- [Architecture](docs/architecture.md)
- [Development version](docs/development.md)
- [Release process](docs/releasing.md)
- [Documentation policy](docs/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## コントリビューション

対象が明確な issue と PR を歓迎します。変更前に次を実行してください。

```bash
npm run check
npm run test
npm run pack:check
```

UI 変更は狭い terminal と通常幅で、idle、running、success、error、cancellation の各状態を確認してください。tool renderer の変更では Pi の実行、キャンセル、エラー、権限が変わらないことを示す必要があります。

## ライセンス

Pi-TUIX は [MIT License](LICENSE) で公開されています。
