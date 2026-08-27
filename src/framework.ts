import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

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

const targetFrameworkPattern =
  /<TargetFramework>\s*([^<\s]+)\s*<\/TargetFramework>/;

/**
 * Read a single `TargetFramework` straight out of the project file.
 *
 * Returns null when the project declares `TargetFrameworks` instead, or gets
 * its framework from Directory.Build.props - both need MSBuild to evaluate.
 */
export function parseTargetFramework(projectXml: string): string | null {
  const match = targetFrameworkPattern.exec(projectXml);

  return match?.[1] ?? null;
}

/**
 * The `bin/<Configuration>/<TargetFramework>[/publish]` directory the SDK
 * writes to by default. This mirrors the convention DumpInfo.targets already
 * hardcodes, so it is no less faithful than asking MSBuild - just free.
 */
export function createOutputDirPath(options: {
  projectPath: string;
  configuration: string;
  targetFramework: string;
  publish: boolean;
  cwd?: string;
}): string {
  const projectDir = resolve(
    options.cwd ?? process.cwd(),
    dirname(options.projectPath),
  );
  const outputDir = join(
    projectDir,
    "bin",
    options.configuration,
    options.targetFramework,
  );

  return options.publish ? join(outputDir, "publish") : outputDir;
}

/**
 * Locate the .NET output directory, preferring the convention over spawning
 * MSBuild: the synchronous `dotnet msbuild` call costs seconds of startup on
 * every dev server boot, so it is kept as the fallback for projects whose
 * framework cannot be read off the project file.
 */
export function getOutputDir(options: WwwrootPathCommandOptions): string {
  const cwd = options.cwd ?? process.cwd();
  const projectPath = resolve(cwd, options.projectPath);

  let targetFramework: string | null = null;
  try {
    targetFramework = parseTargetFramework(readFileSync(projectPath, "utf8"));
  } catch {
    targetFramework = null;
  }

  if (targetFramework !== null) {
    return createOutputDirPath({
      projectPath: options.projectPath,
      configuration: options.configuration,
      targetFramework,
      publish: options.publish,
      cwd,
    });
  }

  return dirname(getWwwrootPath(options));
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
