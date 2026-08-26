import { spawn, spawnSync, type ChildProcess } from "node:child_process";

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
export function createDotnetCommand(
  options: DotnetBuildCommandOptions,
): DotnetCommand {
  const args = [
    options.publish ? "publish" : "build",
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

export function spawnDotnet(options: DotnetBuildCommandOptions): ChildProcess {
  const command = createDotnetCommand(options);

  return spawn(command.executable, command.args, {
    cwd: options.projectPath,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
    detached: process.platform !== "win32",
  });
}

export function stopDotnet(childProcess: ChildProcess): void {
  const { pid } = childProcess;
  if (pid === undefined) return;

  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
    });
    if (result.status !== 0 && result.status !== 128) {
      throw new Error(`taskkill failed with exit code ${result.status}`);
    }
    return;
  }

  process.kill(-pid, "SIGKILL");
}
