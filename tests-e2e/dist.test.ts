import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import dotnetWasm from "../src/index";

/**
 * The one test that exercises the whole chain: dotnet build/publish, the
 * framework copy into dist, the rewritten dotnet.js import, and the .NET
 * runtime actually booting from those files in a browser.
 *
 * The unit tests cover pure functions; nothing else proves a built dist runs.
 * The plugin is imported from src so the suite cannot silently test a stale
 * dist, and so it needs no shelling out to npm - which would not work on
 * Windows, where npm is a .cmd that execFile cannot launch.
 * Both output layouts are covered because they take different paths through the
 * plugin: build output is staged from the SDK manifest, while publish output is
 * consolidated already and read straight from the wwwroot. Publish also trims,
 * which can break a [JSExport] at runtime while the build still succeeds.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(repoRoot, "examples", "my-javascript-app");
/** Paths reaching the plugin are resolved against the cwd, not the Vite root. */
const projectPath = "examples/dotnet-wasm/dotnet-wasm.csproj";

/** The stopwatch the sample renders into #time once .NET has booted. */
const elapsedPattern = /^\d{2}:\d{2}$/;

const bootedSelector = () =>
  /^\d{2}:\d{2}$/.test(document.querySelector("#time")?.textContent ?? "");

const outputModes = [
  { name: "dotnet build", publish: false, outDir: "dist-e2e-build", port: 5211 },
  {
    name: "dotnet publish",
    publish: true,
    outDir: "dist-e2e-publish",
    port: 5212,
  },
];

describe.each(outputModes)(
  "a dist built from $name output",
  ({ publish, outDir, port }) => {
    const distDir = join(appDir, outDir);

    let server: PreviewServer;
    let browser: Browser;
    let url: string;

    const openBootedPage = async (): Promise<{
      page: Page;
      failures: string[];
    }> => {
      const page = await browser.newPage();
      const failures: string[] = [];
      page.on("pageerror", (error) => failures.push(String(error)));
      page.on("response", (response) => {
        if (response.status() >= 400) {
          failures.push(`${response.status()} ${response.url()}`);
        }
      });

      await page.goto(url);
      await page.waitForFunction(bootedSelector, undefined, { timeout: 60_000 });

      return { page, failures };
    };

    beforeAll(async () => {
      rmSync(distDir, { recursive: true, force: true });
      await build({
        root: appDir,
        configFile: false,
        logLevel: "warn",
        build: { outDir },
        plugins: [dotnetWasm({ projectPath, publish })],
      });

      server = await preview({
        root: appDir,
        configFile: false,
        build: { outDir },
        preview: { port, strictPort: true },
      });

      const [previewUrl] = server.resolvedUrls?.local ?? [];
      if (previewUrl === undefined) {
        throw new Error("The preview server exposed no local URL.");
      }
      url = previewUrl;

      browser = await chromium.launch();
    }, 600_000);

    afterAll(async () => {
      await browser?.close();
      await server?.close();
      rmSync(distDir, { recursive: true, force: true });
    });

    it("emits the framework assets next to the bundle", () => {
      const frameworkDir = join(distDir, "assets", "_framework");
      const files = existsSync(frameworkDir) ? readdirSync(frameworkDir) : [];

      expect(files).toContain("dotnet.js");
      expect(files.some((file) => file.endsWith(".wasm"))).toBe(true);
    });

    it("imports dotnet.js by a path relative to the bundle", () => {
      const assets = join(distDir, "assets");
      const entry = readdirSync(assets).find((file) => file.endsWith(".js"));
      if (entry === undefined) {
        throw new Error("The build emitted no JavaScript chunk.");
      }

      expect(readFileSync(join(assets, entry), "utf8")).toContain(
        "./_framework/dotnet.js",
      );
    });

    it("runs C# that renders into the DOM", async () => {
      const { page, failures } = await openBootedPage();

      expect(await page.textContent("#time")).toMatch(elapsedPattern);
      expect(failures).toEqual([]);

      await page.close();
    }, 120_000);

    it("round-trips a [JSExport] call from the page", async () => {
      const { page, failures } = await openBootedPage();

      // Toggle() flips the C# stopwatch and returns its new state, so the
      // button label changing proves a value crossed the boundary both ways.
      // Publish trims the assembly, which is where this would break first.
      await page.click("#pause");
      expect(await page.textContent("#pause")).toBe("Start");

      await page.click("#pause");
      expect(await page.textContent("#pause")).toBe("Pause");

      expect(failures).toEqual([]);

      await page.close();
    }, 120_000);
  },
);
