import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_CONFIG,
  getConfigPath,
  loadConfig,
  saveConfig,
} from "../extensions/shell/open-tui/config.ts";

test("preferences preserve disabled/ASCII choices and reject malformed types without mutating defaults", () => {
  const previous = process.env.PI_CODING_AGENT_DIR;
  const dir = mkdtempSync(join(tmpdir(), "pituix-config-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  const defaults = structuredClone(DEFAULT_CONFIG);
  try {
    const config = {
      ...structuredClone(defaults),
      enabled: false,
      icons: { mode: "ascii" as const },
    };
    saveConfig(config);
    assert.deepEqual(loadConfig(), config);
    writeFileSync(
      getConfigPath(),
      JSON.stringify({
        enabled: "false",
        icons: { mode: "invalid" },
        footerSegments: null,
        telemetry: { enabled: 0 },
        fullscreen: [],
      }),
    );
    assert.deepEqual(loadConfig(), defaults);
    writeFileSync(getConfigPath(), JSON.stringify({ fullscreen: { wheelScrollLines: 8 } }));
    const changed = loadConfig();
    assert.equal(changed.fullscreen.wheelScrollLines, 8);
    changed.footerSegments.cwd = false;
    assert.deepEqual(DEFAULT_CONFIG, defaults);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
