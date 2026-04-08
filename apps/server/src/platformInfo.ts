import { spawnSync } from "node:child_process";
import type { ServerPlatform } from "@t3tools/contracts";

let cachedPlatform: ServerPlatform | undefined;

/**
 * Enumerate installed WSL distributions on Windows.
 * Returns an empty array on non-Windows or if wsl is unavailable.
 */
function detectWslDistros(): readonly string[] {
  if (process.platform !== "win32") return [];
  try {
    const result = spawnSync("wsl", ["-l", "-q"], {
      timeout: 5_000,
      encoding: "utf-8",
      windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout) return [];
    return result.stdout
      .split(/\r?\n/)
      // eslint-disable-next-line no-control-regex -- WSL outputs UTF-16LE with null bytes
      .map((line) => line.replace(/\0/g, "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildPlatform(): ServerPlatform {
  const os = process.platform as ServerPlatform["os"];
  return {
    os: os === "win32" || os === "darwin" ? os : "linux",
    isWsl: Boolean(process.env.WSL_DISTRO_NAME),
    wslDistros: detectWslDistros() as string[],
  };
}

/** Get the current server platform info (cached after first call). */
export function getServerPlatform(): ServerPlatform {
  if (!cachedPlatform) {
    cachedPlatform = buildPlatform();
  }
  return cachedPlatform;
}

/** Force-refresh WSL distros and return the updated platform. */
export function refreshServerPlatform(): ServerPlatform {
  cachedPlatform = buildPlatform();
  return cachedPlatform;
}
