import { describe, expect, it } from "vitest";

import {
  createWwwrootPathCommand,
  parseWwwrootPath,
} from "../src/framework";

describe("wwwroot helpers", () => {
  it("builds the msbuild command for a normal build", () => {
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
        "info\nwwwroot path: /var/www/app/wwwroot\n",
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
