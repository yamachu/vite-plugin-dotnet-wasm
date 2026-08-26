import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, resolve } from "node:path";

import type { DotnetCommand } from "./dotnet.js";

export interface WwwrootPathCommandOptions {
  projectPath: string;
  configuration: string;
  publish: boolean;
  dumpTargets: string;
  cwd?: string;
}

export function createWwwrootPathCommand(
  options: WwwrootPathCommandOptions,
): DotnetCommand {
  const target = options.publish ? "PrintPublishWwwroot" : "PrintWwwroot";
  return {
    executable: "dotnet",
    args: [
      "msbuild",
      options.projectPath,
      `-property:Configuration=${options.configuration}`,
      `-property:CustomAfterMicrosoftCommonTargets=${options.dumpTargets}`,
      `-t:${target}`,
      "-v:d",
    ],
  };
}

export function parseWwwrootPath(
  output: string,
  projectPath: string,
  cwd = process.cwd(),
): string {
  const wwwrootMatch = /(?:publish )?wwwroot path:\s*(.+?)(?:\r?\n|$)/i.exec(
    output,
  );
  if (!wwwrootMatch?.[1]) {
    throw new Error("Failed to detect wwwroot path from msbuild output.");
  }

  const matched = wwwrootMatch[1].trim();
  if (isAbsolute(matched)) {
    return matched;
  }

  return resolve(cwd, dirname(projectPath), matched);
}

export function getWwwrootPath(
  options: WwwrootPathCommandOptions,
): string {
  const cwd = options.cwd ?? process.cwd();
  const command = createWwwrootPathCommand(options);
  const { error, output } = spawnSync(command.executable, command.args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  if (error) {
    throw error;
  }

  return parseWwwrootPath(output.toString(), options.projectPath, cwd);
}
