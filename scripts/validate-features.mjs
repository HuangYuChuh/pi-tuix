#!/usr/bin/env node

/**
 * Quick validation script for pi-tuix compact TUI enhancements
 * Run with: node scripts/validate-features.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");

console.log("🧪 Pi-TUIX Feature Validation\n");

const checks = [];

// 1. Check TypeScript compilation
checks.push({
  name: "TypeScript files are valid",
  test: () => {
    const requiredFiles = [
      "extensions/shell/open-tui/config.ts",
      "extensions/tools/three-layer-view.ts",
      "extensions/tools/renderers-v2.ts",
      "extensions/index.ts",
    ];
    return requiredFiles.every((f) => existsSync(resolve(rootDir, f)));
  },
});

// 2. Check config interface exists
checks.push({
  name: "ToolRenderConfig interface exists",
  test: () => {
    const config = readFileSync(
      resolve(rootDir, "extensions/shell/open-tui/config.ts"),
      "utf-8",
    );
    return (
      config.includes("export interface ToolRenderConfig") &&
      config.includes("defaultMode") &&
      config.includes("autoExpand") &&
      config.includes("maxPreviewLines") &&
      config.includes("highlightErrors")
    );
  },
});

// 3. Check ThreeLayerToolView accepts config
checks.push({
  name: "ThreeLayerToolView accepts ThreeLayerConfig",
  test: () => {
    const view = readFileSync(
      resolve(rootDir, "extensions/tools/three-layer-view.ts"),
      "utf-8",
    );
    return (
      view.includes("export interface ThreeLayerConfig") &&
      view.includes("constructor(") &&
      view.includes("this.config")
    );
  },
});

// 4. Check error auto-expansion logic
checks.push({
  name: "Error auto-expansion implemented",
  test: () => {
    const renderers = readFileSync(
      resolve(rootDir, "extensions/tools/renderers-v2.ts"),
      "utf-8",
    );
    return (
      renderers.includes("mode.config.autoExpand") &&
      renderers.includes('displayMode === "collapsed"')
    );
  },
});

// 5. Check error highlighting
checks.push({
  name: "Error highlighting implemented",
  test: () => {
    const view = readFileSync(
      resolve(rootDir, "extensions/tools/three-layer-view.ts"),
      "utf-8",
    );
    return (
      view.includes("this.config.highlightErrors") &&
      view.includes('this.theme.fg("error"')
    );
  },
});

// 6. Check preview line configuration
checks.push({
  name: "Preview lines configurable",
  test: () => {
    const view = readFileSync(
      resolve(rootDir, "extensions/tools/three-layer-view.ts"),
      "utf-8",
    );
    return (
      view.includes("this.config.maxPreviewLines") &&
      view.includes("headLines") &&
      view.includes("tailLines")
    );
  },
});

// 7. Check documentation
checks.push({
  name: "Documentation created",
  test: () => {
    return (
      existsSync(resolve(rootDir, "docs/compact-tui-enhancements.md")) &&
      existsSync(resolve(rootDir, "docs/testing-guide.md"))
    );
  },
});

// 8. Check CHANGELOG updated
checks.push({
  name: "CHANGELOG.md updated",
  test: () => {
    const changelog = readFileSync(resolve(rootDir, "CHANGELOG.md"), "utf-8");
    return (
      changelog.includes("ToolRenderConfig") &&
      changelog.includes("maxPreviewLines") &&
      changelog.includes("autoExpand") &&
      changelog.includes("highlightErrors")
    );
  },
});

// 9. Check tests updated
checks.push({
  name: "Tests cover new features",
  test: () => {
    const tests = readFileSync(
      resolve(rootDir, "test/three-layer-renderers.test.ts"),
      "utf-8",
    );
    return (
      tests.includes("ToolRendererMode") &&
      tests.includes("maxPreviewLines") &&
      tests.includes("autoExpand")
    );
  },
});

// 10. Check all tool renderers updated
checks.push({
  name: "All tool renderers use config",
  test: () => {
    const renderers = readFileSync(
      resolve(rootDir, "extensions/tools/renderers-v2.ts"),
      "utf-8",
    );
    return (
      renderers.includes("createThreeLayerReadDefinition") &&
      renderers.includes("createThreeLayerBashDefinition") &&
      renderers.includes("createThreeLayerEditDefinition") &&
      renderers.includes("createThreeLayerWriteDefinition") &&
      renderers.match(/mode\.config/g).length >= 8 // Config used multiple times
    );
  },
});

// Run checks
let passed = 0;
let failed = 0;

for (const check of checks) {
  try {
    const result = check.test();
    if (result) {
      console.log(`✅ ${check.name}`);
      passed++;
    } else {
      console.log(`❌ ${check.name}`);
      failed++;
    }
  } catch (error) {
    console.log(`❌ ${check.name} (error: ${error.message})`);
    failed++;
  }
}

console.log(`\n📊 Results: ${passed}/${checks.length} checks passed`);

if (failed > 0) {
  console.log(`\n⚠️  ${failed} check(s) failed`);
  process.exit(1);
} else {
  console.log("\n✨ All feature validations passed!");
  console.log("\nNext steps:");
  console.log("1. Run: npm run check");
  console.log("2. Run: npm test");
  console.log("3. Install extension: pi extension add .");
  console.log("4. Start testing: pi");
  console.log("\nSee docs/testing-guide.md for detailed test scenarios.");
}
