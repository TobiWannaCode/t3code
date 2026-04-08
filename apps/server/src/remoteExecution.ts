import type { ExecutionMode } from "@t3tools/contracts";

export interface CommandSpec {
  readonly binary: string;
  readonly args: readonly string[];
  readonly env?: Record<string, string | undefined>;
  readonly cwd?: string;
  readonly shell?: boolean;
}

/**
 * Convert a Windows path to a WSL-compatible `/mnt/<drive>/...` path.
 * If the path is already a POSIX path it is returned as-is.
 */
export function toWslPath(windowsPath: string): string {
  // Match `C:\...` or `C:/...`
  const match = /^([A-Za-z]):[/\\](.*)$/.exec(windowsPath);
  if (!match) return windowsPath;
  const drive = match[1]!.toLowerCase();
  const rest = match[2]!.replace(/\\/g, "/");
  return `/mnt/${drive}/${rest}`;
}

/**
 * Pure function that wraps a local command spec according to the execution mode.
 *
 * - **local**: passthrough
 * - **wsl**: wraps with `wsl [-d distro] -- binary args...`
 * - **ssh**: wraps with `ssh [opts] host -- binary args...`
 */
export function wrapCommand(mode: ExecutionMode, spec: CommandSpec): CommandSpec {
  switch (mode.kind) {
    case "local":
      return spec;

    case "wsl": {
      const wslArgs: string[] = [];
      if (mode.distro) {
        wslArgs.push("-d", mode.distro);
      }
      if (spec.cwd) {
        wslArgs.push("--cd", toWslPath(spec.cwd));
      }
      wslArgs.push("--", spec.binary, ...spec.args);

      return {
        binary: "wsl",
        args: wslArgs,
        env: spec.env,
        shell: true,
      };
    }

    case "ssh": {
      const sshArgs: string[] = ["-o", "BatchMode=yes"];
      if (mode.identityFile) {
        sshArgs.push("-i", mode.identityFile);
      }
      if (mode.port && mode.port !== 22) {
        sshArgs.push("-p", String(mode.port));
      }
      const userHost = mode.user ? `${mode.user}@${mode.host}` : mode.host;
      sshArgs.push(userHost);

      // Forward key environment variables to the remote side
      const envPrefix: string[] = [];
      if (spec.env) {
        for (const [key, value] of Object.entries(spec.env)) {
          if (value !== undefined) {
            envPrefix.push(`${key}=${shellEscape(value)}`);
          }
        }
      }

      // Build the remote command: optional cd, optional env, then binary + args
      const remoteFragments: string[] = [];
      if (spec.cwd) {
        remoteFragments.push(`cd ${shellEscape(spec.cwd)} &&`);
      }
      remoteFragments.push(...envPrefix);
      remoteFragments.push(spec.binary, ...spec.args);

      sshArgs.push("--", ...remoteFragments);

      return {
        binary: "ssh",
        args: sshArgs,
        // Don't forward local env over SSH — it's handled by remote env prefix
        shell: false,
      };
    }
  }
}

/** Simple shell escaping for values that may contain spaces or special chars. */
function shellEscape(value: string): string {
  if (/^[A-Za-z0-9._/:-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
