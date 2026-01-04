import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cp } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { searchForWorkspaceRoot } from "vite";

const pluginDir = dirname(fileURLToPath(import.meta.url));
const dumpTargets = resolve(pluginDir, "../resources/DumpInfo.targets");

export interface VitePluginDotnetWasmOptions {
  /**
   * Path to the .NET project file (e.g., .csproj).
   */
  projectPath: string;
  /**
   * Build configuration, either "Debug" or "Release".
   * @default "Release"
   */
  configuration?: "Debug" | "Release";
  /**
   * Whether to start 'dotnet watch' for continuous building.
   * @default true in dev mode
   */
  watch?: boolean;
  /**
   * Additional arguments to pass to the 'dotnet build' command.
   */
  dotnetBuildArgs?: string[];
  /**
   * Alias for the framework path used in module resolution.
   * @default (wwwroot) => ({ "./_framework": resolve(wwwroot, "_framework") })
   */
  frameworkPathAlias?: (wwwroot: string) => { [alias: string]: string };
}

const createDotnetBuildProcess = (
  projectFile: string,
  projectPath: string,
  configuration: string,
  watch: boolean,
  optionalArgs?: string[]
): ChildProcess => {
  const args = [
    "build",
    projectFile,
    "--configuration",
    configuration,
    ...(optionalArgs ?? []),
  ];

  if (watch) {
    args.unshift("watch", "--non-interactive");
  }

  return spawn("dotnet", args, {
    cwd: projectPath,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    env: { ...process.env },
  });
};

const getWwwRootPath = (projectPath: string, configuration: string): string => {
  const cwd = process.cwd();

  const { error, output } = spawnSync(
    "dotnet",
    [
      "msbuild",
      projectPath,
      `-property:Configuration=${configuration}`,
      `-property:CustomAfterMicrosoftCommonTargets=${dumpTargets}`,
      "-t:PrintWwwroot",
      "-v:d",
    ],
    {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    }
  );
  if (error) {
    throw error;
  }
  const stdout = output.toString();
  const wwwrootMatch = /wwwroot path:\s*(.+)\s*/.exec(stdout);
  if (wwwrootMatch && wwwrootMatch[1]) {
    const matched = wwwrootMatch[1];
    if (isAbsolute(matched)) {
      return matched;
    }

    const projDirName = dirname(projectPath);
    return resolve(cwd, projDirName, matched);
  } else {
    throw new Error("Failed to detect wwwroot path from msbuild output.");
  }
};

export default function vitePluginDotnetWasm(
  options: VitePluginDotnetWasmOptions
): Plugin {
  const {
    projectPath,
    configuration = "Release",
    watch: watchOption,
    dotnetBuildArgs,
    frameworkPathAlias = (wwwroot) => ({
      "./_framework": resolve(wwwroot, "_framework"),
    }),
  } = options;

  let server: ViteDevServer;
  let config: ResolvedConfig;
  let dotnetProcess: ChildProcess | null = null;
  let wwwroot: string;
  let projectFile: string;
  let projectRoot: string;

  return {
    name: "vite-plugin-dotnet-wasm",
    enforce: "pre",

    config(prevConfig) {
      try {
        wwwroot = getWwwRootPath(projectPath, configuration);
      } catch (e) {
        console.error(
          `[vite-plugin-dotnet-wasm] Failed to detect wwwroot path: ${e}`
        );
      }

      projectFile = basename(projectPath);
      projectRoot = resolve(process.cwd(), dirname(projectPath));

      const prevExternal = prevConfig.build?.rollupOptions?.external;

      return {
        resolve: {
          alias: {
            ...frameworkPathAlias(wwwroot),
          },
        },
        server: {
          fs: {
            allow: [
              searchForWorkspaceRoot(process.cwd()),
              resolve(wwwroot, "_framework"),
            ],
          },
        },

        build: {
          rollupOptions: {
            external:
              prevExternal === undefined
                ? [/^\.\/_framework\//]
                : Array.isArray(prevExternal)
                ? [...prevExternal, /^\.\/_framework\//]
                : typeof prevExternal === "function"
                ? (source, importer, isResolved) => {
                    return (
                      prevExternal(source, importer, isResolved) ||
                      /^\.\/_framework\//.test(source)
                    );
                  }
                : [prevExternal, /^\.\/_framework\//],
          },
        },
      };
    },

    async configResolved(resolvedConfig: ResolvedConfig): Promise<void> {
      config = resolvedConfig;
    },

    async configureServer(viteServer) {
      if (dotnetProcess) return;

      server = viteServer;

      dotnetProcess = createDotnetBuildProcess(
        projectPath,
        projectRoot,
        configuration,
        watchOption ?? config.command === "serve",
        dotnetBuildArgs
      );

      dotnetProcess.stdout?.on("data", (data) => {
        const text = data.toString();
        process.stdout.write(`[dotnet] ${text}`);
      });
      dotnetProcess.stderr?.on("data", (data) => {
        const text = data.toString();
        process.stderr.write(`[dotnet] ${text}\n`);

        if (text.includes("Waiting for a file to change before restarting")) {
          console.log(
            `[vite-plugin-dotnet-wasm] Build succeeded, triggering Vite server reload...`
          );
          server.ws.send({
            type: "full-reload",
          });
        }
      });

      dotnetProcess.on("close", (code) => {
        console.log(`dotnet process exited with code ${code}`);
        dotnetProcess = null;
      });
      dotnetProcess.on("error", (err) => {
        console.error(`dotnet process error: ${err}`);
        dotnetProcess = null;
      });

      server.httpServer?.once("close", () => {
        if (dotnetProcess) {
          dotnetProcess.kill();
          dotnetProcess = null;
        }
      });
    },
    async generateBundle() {
      const distFramework = resolve(
        config.root,
        config.build.outDir,
        config.build.assetsDir,
        "_framework"
      );

      try {
        await new Promise((resolve) => {
          createDotnetBuildProcess(
            projectFile,
            projectRoot,
            configuration,
            false,
            dotnetBuildArgs
          ).on("close", (code) => {
            resolve({});
          });
        });

        await cp(resolve(wwwroot, "_framework"), distFramework, {
          recursive: true,
        });

        console.log(
          `[vite-plugin-dotnet-wasm] Copied framework to ${distFramework}`
        );
      } catch (e) {
        console.error(`[vite-plugin-dotnet-wasm] Failed to copy framework:`, e);
      }
    },
    async closeBundle() {
      if (dotnetProcess) {
        dotnetProcess.kill();
        dotnetProcess = null;
      }
    },
  };
}
