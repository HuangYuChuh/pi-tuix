# Pi-TUIX

<div align="center">

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [繁體中文](README.zh-TW.md) | [한국어](README.ko.md) | [Español](README.es.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Node.js >=22.19](https://img.shields.io/badge/Node.js-%3E%3D22.19-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![Pi Coding Agent >=0.84](https://img.shields.io/badge/Pi%20Coding%20Agent-%3E%3D0.84-4B5563)](https://github.com/badlogic/pi-mono)

</div>

> [!NOTE]
> Esta traducción es mantenida por la comunidad. Si encuentras errores, los PR son bienvenidos. Está basada en el [`README.md`](README.md) actual.

> **Estado:** desarrollo inicial. `pi-tuix` aún no está publicado en npm.

**Pi-TUIX** es una extensión open source de interfaz de terminal para Pi Coding Agent. Ofrece una experiencia más clara y compacta para sesiones largas de programación, mientras Pi sigue controlando las solicitudes a modelos, herramientas integradas, sesiones, permisos e integraciones con providers.

## Por qué Pi-TUIX

Cuando una sesión se alarga, cuesta saber qué está ocurriendo, qué cambió y si hace falta intervenir. Pi-TUIX mejora esa jerarquía de información sin trasladar el trabajo a otro Agent runtime.

- Muestra el modelo activo, el workspace y la señal de context en el shell.
- Mantiene visibles los estados running y streaming sin añadir ruido al transcript.
- Permite volver a la interfaz predeterminada de Pi en la misma sesión.
- Se instala como package removible; Pi sigue siendo el system of record.

## Inicio rápido

### Instalar la versión de desarrollo

Requisitos: Node.js `>=22.19.0` y Pi Coding Agent `>=0.84.0`.

```bash
npm install
npm run check
pi install /absolute/path/to/pi-tuix --approve
pi list
```

Pi guarda la ruta local en la configuración del usuario y carga ese working tree en todos los proyectos. Reinicia Pi después de cambiar el código. Usa `pi install -l /absolute/path/to/pi-tuix --approve` para una instalación por proyecto o `pi -e ./extensions/index.ts` para una vista previa puntual que no se guarda.

### Instalar desde npm (después del primer lanzamiento)

```bash
pi install npm:pi-tuix
```

Para instalarlo solo en un proyecto, usa `pi install -l npm:pi-tuix`.

Consulta [la guia de desarrollo](docs/development.md) para cambiar la fuente instalada y [el proceso de lanzamiento](docs/releasing.md) para las reglas de los canales development, prerelease y stable.

## Prototipo actual

La versión base conecta la `ExtensionAPI` pública de Pi con un header, footer, título de terminal, working indicator, editor chrome y presentación compacta de Read/Bash/Edit/Write. La ejecución de las herramientas sigue delegada a Pi sin cambios.

El borde del editor muestra `READY/WORKING`, líneas y caracteres del prompt. Extiende el `CustomEditor` público de Pi, por lo que conserva submission, history, autocomplete, paste y los app shortcuts registrados.

Cada tool row muestra explícitamente la acción, el objetivo, el estado y la señal `ATTENTION/CLEAR`. Read/Bash resumen el volumen de salida, Edit muestra estadísticas del diff y Write indica las líneas escritas; al expandir se muestran los detalles con límites de ancho compatibles con ANSI.

| Comando | Función |
| --- | --- |
| `/pituix` | Activar o restaurar el shell de Pi-TUIX |
| `/pituix-default` | Restaurar los componentes TUI predeterminados de Pi |
| `/pituix-about` | Mostrar el package y la versión compatible de Pi |

El theme `pi-tuix-dark` incluido se puede seleccionar desde `/settings` en Pi.

## Cómo funciona

```text
Pi Coding Agent (runtime, providers, tools, sessions, permissions)
                     |
               public ExtensionAPI
                     |
                 Pi-TUIX shell
          (header, footer, indicators, themes)
```

Los components solo renderizan state. Los lifecycle handlers convierten los eventos de Pi en pequeñas actualizaciones de UI; no llaman a providers ni ejecutan comandos shell como efecto secundario del renderizado. Los tool renderers previstos delegarán la ejecución a Pi sin cambios y sustituirán únicamente la presentación.

## Hoja de ruta

1. **Shell (actual):** header, footer, título, theme, working state y editor chrome reversible.
2. **Tool surface (actual):** filas compactas para Read/Bash/Edit/Write, estados queued/running/success/error/cancelled, salida expandible y resúmenes de diff.
3. **Stream surface:** etiquetas de thinking, progreso, estado de token/context y repaint estable.
4. **Control surface:** diálogos de approval, revisión de planes, steering queue y teclado.
5. **Session surface:** context, referencias de resume y estado de subagents cuando Pi exponga eventos públicos fiables.

Consulta [product context](docs/product-context.md), [positioning](docs/positioning.md) y [architecture](docs/architecture.md) para conocer los límites y criterios del producto.

## Contrato de compatibilidad

- Pi Coding Agent `>=0.84.0`.
- `@earendil-works/pi-tui` `>=0.84.0` como peer dependency.
- Pi controla model calls, tool execution, sessions, permissions, credentials y persistence.
- Solo se utilizan extension contracts públicos y documentados; no se parchean ni incorporan módulos privados.
- Desactivar o eliminar Pi-TUIX no exige migrar sesiones de Pi ni archivos del proyecto.
- No incluye source, private protocols, branding ni proprietary assets de Claude Code.

## Documentación

- [Product context](docs/product-context.md)
- [Positioning](docs/positioning.md)
- [Architecture](docs/architecture.md)
- [Development version](docs/development.md)
- [Release process](docs/releasing.md)
- [Documentation policy](docs/README.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Contribuir

Se aceptan issues y PR con un alcance concreto. Ejecuta lo siguiente antes de realizar cambios:

```bash
npm run check
npm run test
npm run pack:check
```

Los cambios de UI deben comprobarse en terminales estrechas y normales, incluidos los estados idle, running, success, error y cancellation. Los cambios de tool renderer deben demostrar que la ejecución, cancelación, errores y permisos de Pi no se alteran.

## Licencia

Pi-TUIX se publica bajo la [MIT License](LICENSE).
