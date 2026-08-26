import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(
    "Usage: npm run release:check -- --tag v<version> --channel <latest|beta|next>",
  );
  process.exit(0);
}

function valueFor(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function fail(message) {
  console.error(`release:check failed: ${message}`);
  process.exit(1);
}

function run(command, commandArgs, capture = false) {
  return execFileSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
}

const tag = valueFor("--tag");
const channel = valueFor("--channel");
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (!tag || !channel) {
  fail("both --tag and --channel are required");
}

if (!semverPattern.test(version)) {
  fail(`package.json version is not valid SemVer: ${version}`);
}

if (tag !== `v${version}`) {
  fail(`tag ${tag} does not match package.json version ${version}`);
}

const supportedChannels = new Set(["latest", "beta", "next"]);
if (!supportedChannels.has(channel)) {
  fail(`unsupported npm channel: ${channel}`);
}

const isPrerelease = version.includes("-");
if (isPrerelease && channel === "latest") {
  fail("prerelease versions cannot use the npm latest channel");
}

if (!isPrerelease && channel !== "latest") {
  fail("stable versions must use the npm latest channel");
}

const branch = run("git", ["branch", "--show-current"], true).trim();
if (branch !== "main") {
  fail(`releases must run from main, current branch is ${branch || "detached HEAD"}`);
}

const status = run("git", ["status", "--porcelain"], true).trim();
if (status) {
  fail("worktree is not clean");
}

run("git", ["fetch", "origin", "main", "--tags"]);
const head = run("git", ["rev-parse", "HEAD"], true).trim();
const remoteMain = run("git", ["rev-parse", "origin/main"], true).trim();
if (head !== remoteMain) {
  fail("HEAD must exactly match origin/main before release");
}

try {
  run("git", ["rev-parse", "--quiet", "--verify", `refs/tags/${tag}`], true);
  fail(`tag ${tag} already exists locally`);
} catch (error) {
  if (error?.status !== 1) {
    throw error;
  }
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  fail("invoke this gate through npm run release:check");
}

run(process.execPath, [npmCli, "run", "check"]);
run(process.execPath, [npmCli, "run", "test"]);
run(process.execPath, [npmCli, "run", "pack:check"]);

console.log(`release:check passed for ${tag} on npm channel ${channel}`);
