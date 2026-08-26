import { describe, expect, it } from "vitest";

import { createDotnetCommand } from "../src/dotnet";

describe("createDotnetCommand", () => {
  it("creates a build command with optional arguments", () => {
    expect(
      createDotnetCommand({
        projectFile: "app.csproj",
        projectPath: "/workspace",
        configuration: "Release",
        watch: false,
        publish: false,
        optionalArgs: ["-p:Foo=bar"],
        dumpTargets: "/plugin/DumpInfo.targets",
      }),
    ).toEqual({
      executable: "dotnet",
      args: [
        "build",
        "app.csproj",
        "--configuration",
        "Release",
        "-p:Foo=bar",
      ],
    });
  });

  it("adds watch and publish arguments in dotnet's expected order", () => {
    expect(
      createDotnetCommand({
        projectFile: "app.csproj",
        projectPath: "/workspace",
        configuration: "Debug",
        watch: true,
        publish: true,
        dumpTargets: "/plugin/DumpInfo.targets",
      }).args,
    ).toEqual([
      "watch",
      "--non-interactive",
      "publish",
      "app.csproj",
      "--configuration",
      "Debug",
      "-property:CustomAfterMicrosoftCommonTargets=/plugin/DumpInfo.targets",
      "-property:VitePluginDotnetWasmReloadAfterTargets=Publish",
    ]);
  });
});
