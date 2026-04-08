import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExecutionMode } from "@t3tools/contracts";

const WRAPPER_DIR = path.join(os.tmpdir(), "t3code-wrappers");

/** Cache: serialised mode+binary → wrapper path */
const wrapperCache = new Map<string, string>();

function cacheKey(mode: ExecutionMode, binaryPath: string): string {
  return JSON.stringify({ mode, binaryPath });
}

function ensureDir() {
  fs.mkdirSync(WRAPPER_DIR, { recursive: true });
}

/**
 * For remote execution modes the Claude Agent SDK needs a local executable
 * that transparently proxies to the remote Claude binary. This function
 * generates that wrapper and returns its path.
 *
 * For **local** mode the original `binaryPath` is returned unchanged.
 */
export function resolveClaudeExecutablePath(
  mode: ExecutionMode,
  binaryPath: string,
): string {
  if (mode.kind === "local") return binaryPath;

  const key = cacheKey(mode, binaryPath);
  const cached = wrapperCache.get(key);
  if (cached && fs.existsSync(cached)) return cached;

  ensureDir();

  let content: string;
  let ext: string;

  if (mode.kind === "wsl") {
    // On Windows the SDK spawns a child process — we give it a .cmd batch file
    const distroArg = mode.distro ? ` -d ${mode.distro}` : "";
    content = `@echo off\r\nwsl${distroArg} -- ${binaryPath} %*\r\n`;
    ext = ".cmd";
  } else {
    // SSH wrapper — cross-platform shell script
    const sshArgs: string[] = ["-o", "BatchMode=yes"];
    if (mode.identityFile) sshArgs.push("-i", mode.identityFile);
    if (mode.port && mode.port !== 22) sshArgs.push("-p", String(mode.port));
    const userHost = mode.user ? `${mode.user}@${mode.host}` : mode.host;
    sshArgs.push(userHost);

    content = [
      "#!/bin/sh",
      `exec ssh ${sshArgs.join(" ")} -- ${binaryPath} "$@"`,
      "",
    ].join("\n");
    ext = process.platform === "win32" ? ".cmd" : ".sh";

    // On Windows, generate a .cmd that calls ssh instead
    if (process.platform === "win32") {
      content = `@echo off\r\nssh ${sshArgs.join(" ")} -- ${binaryPath} %*\r\n`;
    }
  }

  const filename = `claude-wrapper-${mode.kind}-${Date.now()}${ext}`;
  const wrapperPath = path.join(WRAPPER_DIR, filename);

  fs.writeFileSync(wrapperPath, content, { mode: 0o755 });
  wrapperCache.set(key, wrapperPath);

  return wrapperPath;
}

/** Invalidate all cached wrapper scripts (call when settings change). */
export function invalidateWrapperCache(): void {
  for (const filePath of wrapperCache.values()) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Already gone — fine
    }
  }
  wrapperCache.clear();
}
