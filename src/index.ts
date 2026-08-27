import { cp } from "node:fs/promises";
import type { ChildProcess } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { normalizePath, searchForWorkspaceRoot } from "vite";

import { spawnDotnet, stopDotnet } from "./dotnet.js";
import { getOutputDir } from "./framework.js";
import { rewriteDotnetScriptImportsInBundle } from "./imports.js";
import { findRuntimeManifest, readManifestAssets } from "./manifest.js";
import { materializeAssets } from "./materialize.js";
import { createBuildMarkerDetector } from "./watch-marker.js";

const pluginDir = dirname(fileURLToPath(import.meta.url));
const dumpTargets = resolve(pluginDir, "../resources/DumpInfo.targets");
const buildCompleteMarker = "vite-plugin-dotnet-wasm:build-complete";
const activeDotnetProcesses = new Set<ChildProcess>();

const stopActiveDotnetProcesses = (signal: NodeJS.Signals) => {
  for (const dotnetProcess of activeDotnetProcesses) {
    try {
      stopDotnet(dotnetProcess);
    } catch (error) {
      console.error(
        `[vite-plugin-dotnet-wasm] Failed to stop dotnet process during ${signal}: ${error}`,
      );
    }
  }

  process.removeAllListeners(signal);
  process.kill(process.pid, signal);
};

process.prependListener("SIGINT", () => stopActiveDotnetProcesses("SIGINT"));
process.prependListener("SIGTERM", () => stopActiveDotnetProcesses("SIGTERM"));

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
   *
   * @deprecated Framework assets are resolved from a staging directory built
   * out of the SDK's static web assets manifest, so an alias onto the wwwroot
   * can no longer see every asset. Setting this keeps the old wwwroot-only
   * behavior for now; it will be removed in a future release.
   */
  frameworkPathAlias?: (wwwroot: string) => { [alias: string]: string };
}

/** Import prefix the .NET SDK emits in `dotnet.js` and in app code. */
const frameworkImportPrefix = "./_framework/";

/**
 * Name the staging directory after what was built into it.
 *
 * Two plugin instances in one Vite config - or one project built two ways -
 * share a cacheDir, and staging prunes whatever it does not expect, so a shared
 * directory would have them deleting each other's assets on every build.
 */
export function createStagingKey(options: {
  projectPath: string;
  configuration: string;
  publish: boolean;
}): string {
  const project = basename(options.projectPath).replace(/\.[^.]+$/, "");
  const suffix = options.publish ? "publish" : "build";

  return `${project}-${options.configuration}-${suffix}`.replace(
    /[^A-Za-z0-9._-]/g,
    "_",
  );
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
    frameworkPathAlias,
  } = options;

  // Setting the deprecated option opts out of the manifest-backed staging
  // directory entirely: an alias and a resolveId hook would otherwise fight
  // over the same specifiers.
  const useLegacyAlias = frameworkPathAlias !== undefined;

  let server: ViteDevServer;
  let config: ResolvedConfig;
  let dotnetProcess: ChildProcess | null = null;
  let projectFile: string;
  let projectRoot: string;
  /** Directory that holds `_framework`: the staging dir, or the wwwroot. */
  let frameworkRoot: string;
  let stagingDir: string | null = null;
  let outputDir: string | null = null;

  /**
   * The .NET output directory, resolved once and only when needed. Resolving it
   * can spawn MSBuild, so nothing should ask for it during `config()`.
   */
  const getOutput = (): string => {
    outputDir ??= getOutputDir({
      projectPath,
      configuration,
      publish,
      dumpTargets,
    });

    return outputDir;
  };

  const getWwwroot = (): string =>
    normalizePath(resolve(getOutput(), "wwwroot"));

  /**
   * Let the dev server read a directory the framework was resolved into.
   * Paths are compared POSIX-style because that is how Vite stores them.
   */
  const allowServing = (directory: string): void => {
    const allow = config?.server.fs.allow;
    if (allow === undefined) {
      return;
    }
    const normalized = normalizePath(directory);
    if (!allow.some((allowed) => normalized.startsWith(normalizePath(allowed)))) {
      allow.push(normalized);
    }
  };

  /**
   * Bring the staging directory in line with the current .NET output.
   *
   * `dotnet build` scatters assets across obj/, so the manifest is the only way
   * to find them all; `dotnet publish` consolidates them and emits no manifest,
   * in which case the wwwroot is already what we need and is used directly.
   */
  const syncFrameworkRoot = (): void => {
    if (stagingDir === null) {
      return;
    }

    // Earlier releases allowed serving the output wwwroot's _framework
    // directly. Nothing the plugin resolves needs that any more, but keeping it
    // permitted costs nothing and cannot break someone who reached for it.
    allowServing(resolve(getOutput(), "wwwroot", "_framework"));

    const manifestPath = findRuntimeManifest(getOutput());
    if (manifestPath === null) {
      // publish output, or an SDK too old to emit a manifest: the wwwroot is
      // already consolidated, so serve it where it lies.
      frameworkRoot = getWwwroot();
      allowServing(frameworkRoot);
      return;
    }

    const { written, unchanged, removed } = materializeAssets(
      readManifestAssets(manifestPath),
      stagingDir,
    );
    frameworkRoot = stagingDir;

    if (written > 0 || removed > 0) {
      console.log(
        `[vite-plugin-dotnet-wasm] Staged ${written} changed and removed ${removed} stale framework assets (${unchanged} unchanged).`,
      );
    }
  };

  /** Drop transformed copies of staged files so a rebuild is actually served. */
  const invalidateStagedModules = (): void => {
    const moduleGraph =
      server?.environments?.["client"]?.moduleGraph ?? server?.moduleGraph;
    if (moduleGraph === undefined) {
      return;
    }

    for (const [id, module] of moduleGraph.idToModuleMap) {
      if (id.startsWith(frameworkRoot)) {
        moduleGraph.invalidateModule(module);
      }
    }
  };

  return {
    name: "vite-plugin-dotnet-wasm",
    enforce: "pre",

    config(prevConfig) {
      projectFile = basename(projectPath);
      projectRoot = resolve(process.cwd(), dirname(projectPath));

      // Only the deprecated path needs the wwwroot this early, and only it pays
      // for resolving the output directory before the dev server starts.
      let legacyAlias: { [alias: string]: string } = {};
      if (useLegacyAlias) {
        console.warn(
          `[vite-plugin-dotnet-wasm] 'frameworkPathAlias' is deprecated and keeps the plugin on the wwwroot, ` +
            `which no longer holds every framework asset on .NET 11. Remove it to resolve assets from the SDK manifest.`,
        );
        legacyAlias = frameworkPathAlias(getWwwroot());
      }

      const prevExternal = prevConfig.build?.rollupOptions?.external;

      return {
        resolve: {
          alias: legacyAlias,
        },
        server: {
          fs: {
            allow: [searchForWorkspaceRoot(process.cwd())],
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

      if (useLegacyAlias) {
        frameworkRoot = getWwwroot();
        allowServing(frameworkRoot);
        return;
      }

      // cacheDir is only known once Vite has resolved it, which is why the
      // framework path is intercepted in resolveId rather than through an
      // alias: aliases have to be declared before this point.
      stagingDir = normalizePath(
        resolve(
          config.cacheDir,
          "dotnet-wasm",
          createStagingKey({ projectPath, configuration, publish }),
        ),
      );

      // cacheDir normally sits under the workspace root and is already
      // servable, but it is configurable and the root need not be the cwd.
      allowServing(stagingDir);

      // The output may already be there from an earlier run; anything missing
      // is staged again after each successful build.
      try {
        syncFrameworkRoot();
      } catch (error) {
        console.error(
          `[vite-plugin-dotnet-wasm] Failed to stage framework assets: ${error}`,
        );
      }
    },

    resolveId(source) {
      if (stagingDir === null || !source.startsWith(frameworkImportPrefix)) {
        return;
      }

      return normalizePath(resolve(frameworkRoot, source.slice("./".length)));
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
      activeDotnetProcesses.add(dotnetProcess);
      const spawnedDotnetProcess = dotnetProcess;

      const dotnetWatchOutput = createBuildMarkerDetector(
        buildCompleteMarker,
        () => {
          console.log(
            `[vite-plugin-dotnet-wasm] Build succeeded, triggering Vite server reload...`,
          );
          try {
            // Restage before the reload: the browser refetches immediately, and
            // the staging directory sits in cacheDir where Vite's watcher does
            // not look, so nothing else would invalidate the old copies.
            syncFrameworkRoot();
            invalidateStagedModules();
          } catch (error) {
            console.error(
              `[vite-plugin-dotnet-wasm] Failed to stage framework assets: ${error}`,
            );
          }
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
        activeDotnetProcesses.delete(spawnedDotnetProcess);
        dotnetProcess = null;
      });
      dotnetProcess.on("error", (err) => {
        console.error(`dotnet process error: ${err}`);
        activeDotnetProcesses.delete(spawnedDotnetProcess);
        dotnetProcess = null;
      });

      server.httpServer?.once("close", () => {
        if (dotnetProcess) {
          const processToStop = dotnetProcess;
          activeDotnetProcesses.delete(processToStop);
          dotnetProcess = null;
          try {
            stopDotnet(processToStop);
          } catch (error) {
            console.error(
              `[vite-plugin-dotnet-wasm] Failed to stop dotnet process: ${error}`,
            );
          }
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

        // The build just wrote new output, so the staging directory is stale.
        syncFrameworkRoot();

        await cp(resolve(frameworkRoot, "_framework"), distFramework, {
          recursive: true,
        });

        console.log(
          `[vite-plugin-dotnet-wasm] Copied framework to ${distFramework}`,
        );
      } catch (e) {
        // Failing the build beats emitting a dist whose _framework is missing
        // or stale: that only shows up as a blank page at runtime.
        this.error(
          `[vite-plugin-dotnet-wasm] Failed to produce the framework output: ${e instanceof Error ? e.message : e}`,
        );
      }

      if (!keepDotnetScriptRelative) {
        return;
      }

      rewriteDotnetScriptImportsInBundle(bundle);
    },
    async closeBundle() {
      if (dotnetProcess) {
        const processToStop = dotnetProcess;
        dotnetProcess = null;
        await stopDotnet(processToStop);
      }
    },
  };
}
