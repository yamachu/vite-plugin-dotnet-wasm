import { describe, expect, it } from "vitest";

import {
  createOutputDirPath,
  createWwwrootPathCommand,
  parseTargetFramework,
  parseWwwrootPath,
} from "../src/framework";

describe("wwwroot helpers", () => {
  it("builds the msbuild command for the build output", () => {
    expect(
      createWwwrootPathCommand({
        projectPath: "src/app.csproj",
        configuration: "Release",
        publish: false,
        dumpTargets: "/plugin/DumpInfo.targets",
      }),
    ).toEqual({
      executable: "dotnet",
      args: [
        "msbuild",
        "src/app.csproj",
        "-property:Configuration=Release",
        "-property:CustomAfterMicrosoftCommonTargets=/plugin/DumpInfo.targets",
        "-t:PrintWwwroot",
        "-v:d",
      ],
    });
  });

  it("resolves relative output against the working directory and project path", () => {
    expect(
      parseWwwrootPath(
        "wwwroot path: bin/Release/net10.0/wwwroot\r\n",
        "src/app.csproj",
        "/workspace",
      ),
    ).toBe("/workspace/src/bin/Release/net10.0/wwwroot");
  });

  it("keeps absolute output paths unchanged", () => {
    expect(
      parseWwwrootPath(
        "info\npublish wwwroot path: /var/www/app/wwwroot\n",
        "src/app.csproj",
        "/workspace",
      ),
    ).toBe("/var/www/app/wwwroot");
  });

  it("reports missing path output", () => {
    expect(() => parseWwwrootPath("build succeeded", "app.csproj")).toThrow(
      "Failed to detect wwwroot path",
    );
  });
});

describe("output directory resolution", () => {
  it("reads a single TargetFramework off the project file", () => {
    expect(
      parseTargetFramework(`<Project Sdk="Microsoft.NET.Sdk.WebAssembly">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>
</Project>`),
    ).toBe("net10.0");
  });

  it("declines multi-targeting so MSBuild can decide", () => {
    expect(
      parseTargetFramework(
        "<Project><PropertyGroup><TargetFrameworks>net10.0;net11.0</TargetFrameworks></PropertyGroup></Project>",
      ),
    ).toBeNull();
  });

  it("declines a project that inherits its framework", () => {
    expect(parseTargetFramework("<Project><PropertyGroup /></Project>")).toBeNull();
  });

  it("builds the conventional build output path", () => {
    expect(
      createOutputDirPath({
        projectPath: "../app/app.csproj",
        configuration: "Release",
        targetFramework: "net10.0",
        publish: false,
        cwd: "/repo/web",
      }),
    ).toBe("/repo/app/bin/Release/net10.0");
  });

  it("appends publish for publish output", () => {
    expect(
      createOutputDirPath({
        projectPath: "../app/app.csproj",
        configuration: "Debug",
        targetFramework: "net11.0",
        publish: true,
        cwd: "/repo/web",
      }),
    ).toBe("/repo/app/bin/Debug/net11.0/publish");
  });
});
