import * as Schema from "effect/Schema";

export const LOCAL_DESKTOP_BUILD = {
  channel: "local",
  updateRepository: "TobiWannaCode/t3code",
  productName: "T3 Code (Local)",
  appId: "com.t3tools.t3code.local",
  homeDirName: ".t3-local-current",
  userDataDirName: "t3code-local-current",
} as const;

export const isLocalDesktopBuild = Schema.is(
  Schema.Struct({
    t3codeBuildChannel: Schema.Literal(LOCAL_DESKTOP_BUILD.channel),
  }),
);
