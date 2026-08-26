import { cp } from "node:fs/promises";
import type { ChildProcess } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { searchForWorkspaceRoot } from "vite";

import { spawnDotnet } from "./dotnet.js";
import { getWwwrootPath } from "./framework.js";
import { rewriteDotnetScriptImportsInBundle } from "./imports.js";
import { createBuildMarkerDetector } from "./watch-marker.js";

const pluginDir = dirname(fileURLToPath(import.meta.url));
const dumpTargets = resolve(pluginDir, "../resources/DumpInfo.targets");
const buildCompleteMarker = "vite-plugin-dotnet-wasm:build-complete";

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
   * Whether to keep the relative path to ./_framework/dotnet.js in import statements.
   * If false, the path will be handled by Vite's bundle output method.
   * @default true
   */
  keepDotnetScriptRelative?: boolean;
  /**
   * Additional arguments to pass to the 'dotnet build' or 'dotnet publish' command.
   */
  dotnetBuildArgs?: string[];
  /**
   * Whether to run 'dotnet publish' instead of 'dotnet build'.
   * @default false
   */
  publish?: boolean;
  /** Whether to skip running 'dotnet build' or 'dotnet publish'. @default false */
  noBuild?: boolean;
  /**
   * Alias for the framework path used in module resolution.
   * @default (wwwroot) => ({ "./_framework": resolve(wwwroot, "_framework") })
   */
  frameworkPathAlias?: (wwwroot: string) => { [alias: string]: string };
}

export default function vitePluginDotnetWasm(
  options: VitePluginDotnetWasmOptions,
): Plugin {
  const {
    projectPath,
    configuration = "Release",
    watch: watchOption,
    keepDotnetScriptRelative = true,
    dotnetBuildArgs,
    publish = false,
    noBuild = false,
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
        wwwroot = getWwwrootPath({
          projectPath,
          configuration,
          publish,
          dumpTargets,
        });
      } catch (e) {
        console.error(
          `[vite-plugin-dotnet-wasm] Failed to detect wwwroot path: ${e}`,
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
      if (noBuild) return;
      if (dotnetProcess) return;

      server = viteServer;

      dotnetProcess = spawnDotnet({
        projectFile,
        projectPath: projectRoot,
        configuration,
        watch: watchOption ?? config.command === "serve",
        publish,
        optionalArgs: dotnetBuildArgs,
        dumpTargets,
      });

      const dotnetWatchOutput = createBuildMarkerDetector(
        buildCompleteMarker,
        () => {
          console.log(
            `[vite-plugin-dotnet-wasm] Build succeeded, triggering Vite server reload...`,
          );
          server.ws.send({
            type: "full-reload",
          });
        },
      );

      dotnetProcess.stdout?.on("data", (data) => {
        const text = data.toString();
        process.stdout.write(`[dotnet] ${text}`);
        dotnetWatchOutput.push(text);
      });
      dotnetProcess.stderr?.on("data", (data) => {
        const text = data.toString();
        process.stderr.write(`[dotnet] ${text}`);
        dotnetWatchOutput.push(text);
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
    async generateBundle(options, bundle) {
      const distFramework = resolve(
        config.root,
        config.build.outDir,
        config.build.assetsDir,
        "_framework",
      );

      try {
        if (!noBuild) {
          await new Promise((resolve, reject) => {
            const proc = spawnDotnet({
              projectFile,
              projectPath: projectRoot,
              configuration,
              watch: false,
              publish,
              optionalArgs: dotnetBuildArgs,
              dumpTargets,
            });
            proc.stdout?.on("data", (_) => {});
            proc.stderr?.on("data", (data) => {
              console.error(
                `[vite-plugin-dotnet-wasm] Initial dotnet ${publish ? "publish" : "build"} error: ${data.toString()}`,
              );
            });
            proc
              .on("close", (code) => {
                console.log(
                  `[vite-plugin-dotnet-wasm] Initial dotnet ${publish ? "publish" : "build"} process completed with code ${code}`,
                );
                if (code === 0) {
                  resolve({});
                } else {
                  reject(
                    new Error(
                      `dotnet ${publish ? "publish" : "build"} failed with exit code ${code}`,
                    ),
                  );
                }
              })
              .on("error", (err) => {
                console.error(
                  `[vite-plugin-dotnet-wasm] Initial dotnet ${publish ? "publish" : "build"} process error: ${err}`,
                );
                reject(err);
              });
          });
        } else {
          console.log(
            `[vite-plugin-dotnet-wasm] Skipping dotnet ${publish ? "publish" : "build"} because noBuild=true`,
          );
        }

        await cp(resolve(wwwroot, "_framework"), distFramework, {
          recursive: true,
        });

        console.log(
          `[vite-plugin-dotnet-wasm] Copied framework to ${distFramework}`,
        );
      } catch (e) {
        console.error(`[vite-plugin-dotnet-wasm] Failed to copy framework:`, e);
      }

      if (!keepDotnetScriptRelative) {
        return;
      }

      rewriteDotnetScriptImportsInBundle(bundle);
    },
    async closeBundle() {
      if (dotnetProcess) {
        dotnetProcess.kill();
        dotnetProcess = null;
      }
    },
  };
}
