import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { readGitBranch } from "../extensions/session/git-branch.ts";

test("Git observation handles unborn/nested repositories, detached HEAD and cancellation without changing the checkout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pituix-branch-"));
  const git = (args: string[]) => promisify(execFile)("git", args, { cwd: dir });
  try {
    assert.equal(await readGitBranch(dir), undefined);
    await git(["init", "-b", "fixture-branch"]);
    await mkdir(join(dir, "nested"));
    assert.equal(await readGitBranch(join(dir, "nested")), "fixture-branch");
    await git([
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "fixture",
    ]);
    const before = (await git(["rev-parse", "HEAD"])).stdout;
    await git(["checkout", "--detach"]);
    assert.equal(await readGitBranch(dir), "HEAD");
    const abort = new AbortController();
    abort.abort();
    assert.equal(await readGitBranch(dir, abort.signal), undefined);
    assert.equal((await git(["rev-parse", "HEAD"])).stdout, before);
    assert.equal((await git(["status", "--porcelain"])).stdout, "");
    assert.equal(await readGitBranch(join(dir, "missing")), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
