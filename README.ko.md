# Pi-TUIX

<div align="center">

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md) | [Español](README.es.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Node.js >=22.19](https://img.shields.io/badge/Node.js-%3E%3D22.19-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![Pi Coding Agent >=0.84](https://img.shields.io/badge/Pi%20Coding%20Agent-%3E%3D0.84-4B5563)](https://github.com/badlogic/pi-mono)

</div>

> [!NOTE]
> 이 번역은 커뮤니티에서 관리합니다. 오류가 있다면 PR을 보내 주세요. 현재 [`README.md`](README.md)를 기준으로 합니다.

> **상태:** 초기 개발 단계입니다. `pi-tuix`는 아직 npm에 배포되지 않았습니다.

**Pi-TUIX**는 Pi Coding Agent를 위한 오픈 소스 terminal UI 확장입니다. 긴 코딩 세션을 더 명확하고 조밀하게 보여 주면서도 모델 요청, 내장 도구, 세션, 권한 및 provider 연동은 계속 Pi가 관리합니다.

## Pi-TUIX가 필요한 이유

세션이 길어지면 현재 무엇을 하고 있는지, 무엇이 변경되었는지, 사용자의 개입이 필요한지를 파악하는 데 큰 노력이 듭니다. Pi-TUIX는 다른 Agent runtime으로 작업을 옮기지 않고 정보 구조를 개선합니다.

- shell에서 활성 모델, workspace, context 신호를 확인합니다.
- transcript 노이즈를 줄이면서 running 및 streaming 상태를 표시합니다.
- 같은 세션에서 Pi 기본 UI로 돌아갈 수 있습니다.
- 제거 가능한 package로 사용하며 Pi를 system of record로 유지합니다.

## 빠른 시작

### 개발 버전 설치

요구 사항: Node.js `>=22.19.0`, Pi Coding Agent `>=0.84.0`.

```bash
npm install
npm run check
pi install /absolute/path/to/pi-tuix --approve
pi list
```

Pi는 로컬 경로를 사용자 설정에 저장하고 모든 프로젝트에서 해당 working tree를 로드합니다. 코드를 변경한 후 Pi를 다시 시작하세요. 프로젝트 단위 설치에는 `pi install -l /absolute/path/to/pi-tuix --approve`, 저장하지 않는 일회성 미리 보기에는 `pi -e ./extensions/index.ts`를 사용합니다.

### npm 설치 (첫 릴리스 이후)

```bash
pi install npm:pi-tuix
```

프로젝트 단위 설치는 `pi install -l npm:pi-tuix`를 사용합니다.

설치 소스 전환은 [개발 버전 가이드](docs/development.md), 개발·prerelease·stable 채널 규칙은 [릴리스 절차](docs/releasing.md)를 참조하세요.

## 0.1.0 안정 릴리스

`0.1.0`은 Pi의 공개 `ExtensionAPI`를 통해 header, footer, terminal title, working indicator, editor chrome 및 3단계 Read/Bash/Edit/Write 표시를 제공합니다. tool execution은 변경 없이 Pi에 위임합니다. 기본 preview는 앞 2줄과 뒤 2줄을 표시하며, collapsed는 요약만, expanded는 전체 출력 또는 diff를 표시합니다.

Editor border는 `READY/WORKING`, 입력 줄 수 및 문자 수를 표시합니다. Pi의 공개 `CustomEditor`를 확장하므로 submit, history, autocomplete, paste 및 app shortcut 동작이 유지됩니다.

각 tool row는 action, target, state 및 `ATTENTION/CLEAR`를 명확히 표시합니다. Read/Bash는 출력 크기, Edit는 diff stats, Write는 작성된 줄 수를 요약하며, 펼치면 ANSI-aware 너비 제한이 적용된 세부 정보를 볼 수 있습니다.

| 명령 | 용도 |
| --- | --- |
| `/pituix` | Pi-TUIX shell 활성화 또는 복원 |
| `/pituix-default` | Pi 기본 TUI component 복원 |
| `/pituix-compact` | 기존 compact tool renderer 사용 |
| `/pituix-three-layer` | 3단계 tool renderer 사용 |
| `/pituix-mode <collapsed\|preview\|expanded>` | tool detail mode 설정, 기본값은 preview |
| `/pituix-about` | package 및 호환 Pi 버전 표시 |
| `/pituix-steer <message>` | 실행 중인 작업에 즉시 수정 지시 전송 |
| `/pituix-followup <message>` | 현재 실행 후 처리할 메시지를 큐에 추가 |
| `/pituix-queue` | Pi에 대기 중인 메시지가 있는지 표시 |
| `/pituix-plan [show\|hide\|clear]` | 자동 감지된 읽기 전용 plan panel 제어 |

포함된 `pi-tuix-dark` theme은 Pi의 `/settings`에서 선택할 수 있습니다.

## 작동 방식

```text
Pi Coding Agent (runtime, provider, tool, session, permission)
                     |
               public ExtensionAPI
                     |
                 Pi-TUIX shell
          (header, footer, indicator, theme)
```

component는 state만 렌더링합니다. lifecycle handler는 Pi event를 작은 UI state update로 변환하며, 렌더링의 부수 효과로 provider를 호출하거나 shell command를 실행하지 않습니다. tool renderer는 실행을 Pi에 그대로 위임하고 표시 방식만 바꿉니다.

stream line은 Turn별 thinking, 응답, tool 실행을 구분합니다. context는 80%에서 `HIGH`, 95%에서 `CRITICAL`로 표시됩니다. `Plan:` 제목과 번호 또는 checkbox 단계가 있는 응답은 읽기 전용 plan panel로 표시되며 prompt, tool, 실행은 변경하지 않습니다.

## 로드맵

1. **Shell (현재):** header, footer, terminal title, theme, working state, reversible editor chrome.
2. **Tool surface (현재):** collapsed, preview, expanded 모드를 지원하는 Read/Bash/Edit/Write row, queued/running/success/error/cancelled 상태, 확장 가능한 출력 및 diff summary.
3. **Stream surface (현재):** thinking/responding/tool 상태, Turn 진행, thinking level, context pressure.
4. **Control surface (진행 중):** steer/follow-up과 읽기 전용 plan review를 제공하며 approval과 keyboard 규칙은 계획 중입니다.
5. **Session surface:** Pi가 신뢰할 수 있는 공개 event를 제공하는 범위에서 context, resume reference, subagent 상태 표시.

자세한 내용은 [product context](docs/product-context.md), [positioning](docs/positioning.md), [architecture](docs/architecture.md)를 참조하세요.

## 호환성 계약

- Pi Coding Agent `>=0.84.0`.
- `@earendil-works/pi-tui` `>=0.84.0`를 peer dependency로 사용.
- model call, tool execution, session, permission, credential, persistence는 Pi가 소유.
- 문서화된 공개 extension contract만 사용하며 private module을 patch/vendor하지 않음.
- 비활성화 또는 제거 시 Pi session이나 project file 이전이 필요 없음.
- Claude Code source, private protocol, branding, proprietary asset을 포함하지 않음.

## 문서

- [Product context](docs/product-context.md)
- [Positioning](docs/positioning.md)
- [Architecture](docs/architecture.md)
- [Development version](docs/development.md)
- [Release process](docs/releasing.md)
- [Documentation policy](docs/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## 기여

범위가 명확한 issue와 PR을 환영합니다. 변경하기 전에 다음을 실행하세요.

```bash
npm run check
npm run test
npm run pack:check
```

UI 변경은 좁은 terminal과 일반 너비에서 idle, running, success, error, cancellation 상태를 확인해야 합니다. tool renderer 변경은 Pi의 실행, 취소, 오류 및 권한 동작이 바뀌지 않음을 입증해야 합니다.

## 라이선스

Pi-TUIX는 [MIT License](LICENSE)로 배포됩니다.
