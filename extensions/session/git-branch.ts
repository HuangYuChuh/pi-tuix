import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** A bounded, read-only observation; unborn branches and detached HEAD both work. */
export async function readGitBranch(
  cwd: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const read = async (args: string[]) => {
    try {
      const { stdout } = await execute("git", args, {
        cwd,
        signal,
        timeout: 1000,
        maxBuffer: 8192,
      });
      return stdout.trim();
    } catch {
      return undefined;
    }
  };
  const branch = await read(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (branch) return branch;
  if (signal?.aborted) return;
  if (await read(["rev-parse", "--verify", "HEAD"])) return "HEAD";
}
