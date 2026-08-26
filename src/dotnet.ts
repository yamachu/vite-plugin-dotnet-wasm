import { spawn, type ChildProcess } from "node:child_process";

export interface DotnetBuildCommandOptions {
  projectFile: string;
  projectPath: string;
  configuration: string;
  watch: boolean;
  publish: boolean;
  optionalArgs?: readonly string[] | undefined;
  dumpTargets: string;
}

export interface DotnetCommand {
  executable: "dotnet";
  args: string[];
}

/**
 * Build the arguments used to invoke dotnet build/publish (or dotnet watch).
 * Keeping argument construction separate makes it possible to verify command
 * ordering without starting a dotnet process.
 */
export function createDotnetBuildCommand(
  options: DotnetBuildCommandOptions,
): DotnetCommand {
  const subcommand = options.publish ? "publish" : "build";
  const args = [
    subcommand,
    options.projectFile,
    "--configuration",
    options.configuration,
    ...(options.optionalArgs ?? []),
  ];

  if (options.watch) {
    args.unshift("watch", "--non-interactive");
    args.push(
      `-property:CustomAfterMicrosoftCommonTargets=${options.dumpTargets}`,
      `-property:VitePluginDotnetWasmReloadAfterTargets=${options.publish ? "Publish" : "Build"}`,
    );
  }

  return { executable: "dotnet", args };
}

export function spawnDotnetBuild(
  options: DotnetBuildCommandOptions,
): ChildProcess {
  const command = createDotnetBuildCommand(options);

  return spawn(command.executable, command.args, {
    cwd: options.projectPath,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    env: { ...process.env },
  });
}
