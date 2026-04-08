import { describe, expect, it } from "vitest";
import { wrapCommand, toWslPath } from "./remoteExecution";

describe("toWslPath", () => {
  it("converts a Windows drive path to a WSL mount path", () => {
    expect(toWslPath("C:\\Users\\tobi\\project")).toBe("/mnt/c/Users/tobi/project");
  });

  it("handles forward slashes", () => {
    expect(toWslPath("D:/code/repo")).toBe("/mnt/d/code/repo");
  });

  it("passes through POSIX paths unchanged", () => {
    expect(toWslPath("/usr/local/bin/claude")).toBe("/usr/local/bin/claude");
  });

  it("passes through relative paths unchanged", () => {
    expect(toWslPath("claude")).toBe("claude");
  });
});

describe("wrapCommand", () => {
  describe("local mode", () => {
    it("returns the spec unchanged", () => {
      const spec = { binary: "claude", args: ["--version"], shell: true };
      const result = wrapCommand({ kind: "local" }, spec);
      expect(result).toEqual(spec);
    });
  });

  describe("wsl mode", () => {
    it("wraps with wsl using default distro", () => {
      const result = wrapCommand(
        { kind: "wsl", distro: "" },
        { binary: "claude", args: ["--version"] },
      );
      expect(result.binary).toBe("wsl");
      expect(result.args).toEqual(["--", "claude", "--version"]);
    });

    it("wraps with wsl using a specific distro", () => {
      const result = wrapCommand(
        { kind: "wsl", distro: "Ubuntu" },
        { binary: "claude", args: ["-p"] },
      );
      expect(result.binary).toBe("wsl");
      expect(result.args).toEqual(["-d", "Ubuntu", "--", "claude", "-p"]);
    });

    it("translates cwd to WSL path", () => {
      const result = wrapCommand(
        { kind: "wsl", distro: "" },
        { binary: "codex", args: ["app-server"], cwd: "C:\\Users\\tobi\\project" },
      );
      expect(result.args).toContain("--cd");
      expect(result.args).toContain("/mnt/c/Users/tobi/project");
    });
  });

  describe("ssh mode", () => {
    it("wraps with ssh using host only", () => {
      const result = wrapCommand(
        { kind: "ssh", host: "myserver" as never, port: 22, user: "", identityFile: "" },
        { binary: "claude", args: ["--version"] },
      );
      expect(result.binary).toBe("ssh");
      expect(result.args).toContain("myserver");
      expect(result.args).toContain("--");
      expect(result.args).toContain("claude");
      expect(result.args).toContain("--version");
    });

    it("includes user@host when user is set", () => {
      const result = wrapCommand(
        { kind: "ssh", host: "myserver" as never, port: 22, user: "admin", identityFile: "" },
        { binary: "claude", args: [] },
      );
      expect(result.args).toContain("admin@myserver");
    });

    it("includes -p flag for non-default port", () => {
      const result = wrapCommand(
        { kind: "ssh", host: "myserver" as never, port: 2222, user: "", identityFile: "" },
        { binary: "claude", args: [] },
      );
      expect(result.args).toContain("-p");
      expect(result.args).toContain("2222");
    });

    it("includes -i flag for identity file", () => {
      const result = wrapCommand(
        {
          kind: "ssh",
          host: "myserver" as never,
          port: 22,
          user: "",
          identityFile: "~/.ssh/id_rsa",
        },
        { binary: "claude", args: [] },
      );
      expect(result.args).toContain("-i");
      expect(result.args).toContain("~/.ssh/id_rsa");
    });

    it("prefixes cd when cwd is set", () => {
      const result = wrapCommand(
        { kind: "ssh", host: "myserver" as never, port: 22, user: "", identityFile: "" },
        { binary: "codex", args: ["exec"], cwd: "/home/user/project" },
      );
      const afterDashes = result.args.slice(result.args.indexOf("--") + 1);
      expect(afterDashes[0]).toContain("cd");
      expect(afterDashes.join(" ")).toContain("/home/user/project");
    });
  });
});
