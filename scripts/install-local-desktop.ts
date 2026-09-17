#!/usr/bin/env node
// oxlint-disable t3code/no-global-process-runtime -- Standalone installer selects the host bundle before starting the application runtime.
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- Standalone macOS installer owns process lifecycle and atomic bundle replacement outside the app runtime.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeTimersPromises from "node:timers/promises";

import { LOCAL_DESKTOP_BUILD } from "@t3tools/shared/desktopBuild";

const repoRoot = NodeURL.fileURLToPath(new URL("..", import.meta.url));
function resolveApplicationsDir(): string {
  const userApplications = NodePath.join(NodeOS.homedir(), "Applications");
  if (!NodeFS.existsSync(userApplications)) return userApplications;
  try {
    NodeFS.accessSync(userApplications, NodeFS.constants.W_OK);
    return userApplications;
  } catch {
    // Some Macs have a root-owned ~/Applications. Use the standard system
    // location when writable, without changing permissions or requiring sudo.
    NodeFS.accessSync("/Applications", NodeFS.constants.W_OK);
    return "/Applications";
  }
}

const applicationsDir = NodeOS.platform() === "darwin" ? resolveApplicationsDir() : "";
const appName = `${LOCAL_DESKTOP_BUILD.productName}.app`;
const destination = NodePath.join(applicationsDir, appName);
const lockDir = NodePath.join(applicationsDir, ".t3code-local-install-lock");

function readBundleId(appPath: string): string {
  return NodeChildProcess.execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleIdentifier", NodePath.join(appPath, "Contents/Info.plist")],
    { encoding: "utf8" },
  ).trim();
}

async function build(outputDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      "vp",
      [
        "run",
        "dist:desktop:artifact",
        "--platform",
        "mac",
        "--arch",
        NodeOS.arch(),
        "--target",
        "dir",
        "--local-test",
        "--output-dir",
        outputDir,
      ],
      {
        cwd: repoRoot,
        stdio: "inherit",
        // A local install must always build current sources, even if the caller
        // previously exported release or mock-update settings.
        env: {
          ...process.env,
          T3CODE_DESKTOP_SKIP_BUILD: "false",
          T3CODE_DESKTOP_SIGNED: "false",
          T3CODE_DESKTOP_MOCK_UPDATES: "false",
        },
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Local desktop build failed (${signal ?? code}).`));
    });
  });
}

async function quitInstalledApp(): Promise<void> {
  NodeChildProcess.execFileSync(
    "/usr/bin/osascript",
    [
      "-e",
      `if application id "${LOCAL_DESKTOP_BUILD.appId}" is running then tell application id "${LOCAL_DESKTOP_BUILD.appId}" to quit`,
    ],
    { timeout: 35_000 },
  );

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const processes = NodeChildProcess.execFileSync("/bin/ps", ["-axo", "command="], {
      encoding: "utf8",
    });
    if (!processes.includes(`${destination}/Contents/`)) return;
    await NodeTimersPromises.setTimeout(250);
  }
  throw new Error("T3 Code (Local) is still running. Quit it and rerun the install command.");
}

async function install(): Promise<void> {
  if (NodeOS.platform() !== "darwin" || !["arm64", "x64"].includes(NodeOS.arch())) {
    throw new Error("Local desktop installation requires an Apple Silicon or Intel Mac.");
  }
  await NodeFSP.mkdir(applicationsDir, { recursive: true });
  try {
    await NodeFSP.mkdir(lockDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(
        `Another local install may be running. If an earlier install was interrupted, remove ${lockDir} and retry.`,
        { cause: error },
      );
    }
    throw error;
  }

  let buildDir: string | undefined;
  let installDir: string | undefined;
  try {
    buildDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-local-build-"));
    await build(buildDir);

    const builtApp = NodePath.join(
      buildDir,
      NodeOS.arch() === "arm64" ? "mac-arm64" : "mac",
      appName,
    );
    if (readBundleId(builtApp) !== LOCAL_DESKTOP_BUILD.appId) {
      throw new Error("Refusing to install a build without the local app identity.");
    }
    if (NodeFS.existsSync(destination) && readBundleId(destination) !== LOCAL_DESKTOP_BUILD.appId) {
      throw new Error(`Refusing to replace a different app at ${destination}.`);
    }

    // Stage on the destination volume before stopping the running app. A failed
    // build or copy leaves the installed app available and untouched.
    installDir = await NodeFSP.mkdtemp(NodePath.join(applicationsDir, ".t3code-local-install-"));
    const stagedApp = NodePath.join(installDir, appName);
    const previousApp = NodePath.join(installDir, "previous.app");
    NodeChildProcess.execFileSync("/usr/bin/ditto", [builtApp, stagedApp], { stdio: "inherit" });
    NodeChildProcess.execFileSync(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", stagedApp],
      {
        stdio: "inherit",
      },
    );
    // Load the actual packaged server and dependencies before replacing a
    // working install. --help exits without starting a server or migrating data.
    NodeChildProcess.execFileSync(
      NodePath.join(stagedApp, "Contents/MacOS", LOCAL_DESKTOP_BUILD.productName),
      [NodePath.join(stagedApp, "Contents/Resources/app.asar/apps/server/dist/bin.mjs"), "--help"],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          T3CODE_HOME: NodePath.join(buildDir, "smoke-data"),
        },
        timeout: 30_000,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );

    const replacing = NodeFS.existsSync(destination);
    if (replacing) {
      console.log("Closing T3 Code (Local) to install the completed build...");
      await quitInstalledApp();
      await NodeFSP.rename(destination, previousApp);
    }
    try {
      await NodeFSP.rename(stagedApp, destination);
    } catch (error) {
      if (replacing) {
        try {
          await NodeFSP.rename(previousApp, destination);
        } catch (rollbackError) {
          // Retain the previous app for manual recovery if rollback itself fails.
          installDir = undefined;
          throw new Error(
            `Could not restore the previous local app. It is preserved at ${previousApp}.`,
            { cause: rollbackError },
          );
        }
      }
      throw error;
    }
    console.log(`Installed ${destination}`);
    console.log(
      `Local app data: ${NodePath.join(NodeOS.homedir(), LOCAL_DESKTOP_BUILD.homeDirName)}`,
    );
    const launchEnv = { ...process.env };
    delete launchEnv.ELECTRON_RUN_AS_NODE;
    NodeChildProcess.execFileSync("/usr/bin/open", [destination], {
      stdio: "inherit",
      env: launchEnv,
    });
  } finally {
    if (buildDir) await NodeFSP.rm(buildDir, { recursive: true, force: true });
    if (installDir) await NodeFSP.rm(installDir, { recursive: true, force: true });
    await NodeFSP.rm(lockDir, { recursive: true, force: true });
  }
}

await install().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
