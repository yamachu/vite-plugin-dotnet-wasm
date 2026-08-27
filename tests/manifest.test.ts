import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  collectManifestAssets,
  expandPatternSources,
  parseRuntimeManifest,
  readManifestAssets,
  type RuntimeManifest,
} from "../src/manifest";

const manifestDir = "/repo/app/bin/Release/net11.0";

/**
 * Shaped after real `dotnet build` output: fingerprinted served names, a
 * webcil/compressed split across content roots, and the wwwroot glob the SDK
 * emits instead of enumerating a project's own static files.
 */
const sampleManifest = {
  ContentRoots: [
    "/repo/app/obj/Release/net11.0/fx/app/",
    "/repo/app/obj/Release/net11.0/compressed/",
    "/repo/app/obj/Release/net11.0/webcil/",
    "/repo/app/wwwroot/",
  ],
  Root: {
    Children: {
      _framework: {
        Children: {
          "dotnet.js": {
            Children: null,
            Asset: { ContentRootIndex: 0, SubPath: "_framework/dotnet.js" },
            Patterns: null,
          },
          "App.abc123.wasm": {
            Children: null,
            Asset: { ContentRootIndex: 2, SubPath: "App.wasm" },
            Patterns: null,
          },
          "App.abc123.wasm.gz": {
            Children: null,
            Asset: {
              ContentRootIndex: 1,
              SubPath: "zzz-{0}-abc123-abc123.gz",
            },
            Patterns: null,
          },
        },
        Asset: null,
        Patterns: null,
      },
    },
    Asset: null,
    Patterns: [{ ContentRootIndex: 3, Pattern: "**", Depth: 0 }],
  },
};

describe("parseRuntimeManifest", () => {
  it("accepts a manifest and preserves its content roots", () => {
    const manifest = parseRuntimeManifest(JSON.stringify(sampleManifest));

    expect(manifest.ContentRoots).toHaveLength(4);
    expect(manifest.Root.Children?.["_framework"]?.Children).toBeDefined();
  });

  it("rejects a manifest without ContentRoots instead of yielding no assets", () => {
    expect(() =>
      parseRuntimeManifest(JSON.stringify({ Root: { Children: null } })),
    ).toThrow(/ContentRoots/);
  });

  it("reports the served path of a malformed asset entry", () => {
    const broken = {
      ContentRoots: ["/repo/"],
      Root: {
        Children: {
          _framework: {
            Children: {
              "dotnet.js": {
                Children: null,
                Asset: { ContentRootIndex: 0 },
                Patterns: null,
              },
            },
            Asset: null,
            Patterns: null,
          },
        },
        Asset: null,
        Patterns: null,
      },
    };

    expect(() => parseRuntimeManifest(JSON.stringify(broken))).toThrow(
      /_framework\/dotnet\.js/,
    );
  });

  it("rejects text that is not JSON", () => {
    expect(() => parseRuntimeManifest("dotnet watch ⌚")).toThrow(
      /Failed to parse/,
    );
  });
});

describe("collectManifestAssets", () => {
  const manifest: RuntimeManifest = parseRuntimeManifest(
    JSON.stringify(sampleManifest),
  );

  it("maps served paths to the scattered physical files", () => {
    const { files } = collectManifestAssets(manifest, manifestDir);

    expect(Object.fromEntries(files)).toEqual({
      "_framework/dotnet.js": "/repo/app/obj/Release/net11.0/fx/app/_framework/dotnet.js",
      "_framework/App.abc123.wasm": "/repo/app/obj/Release/net11.0/webcil/App.wasm",
    });
  });

  it("drops pre-compressed representations by default", () => {
    const { files } = collectManifestAssets(manifest, manifestDir);
    expect(files.has("_framework/App.abc123.wasm.gz")).toBe(false);

    const withCompressed = collectManifestAssets(manifest, manifestDir, {
      includeCompressed: true,
    });
    expect(withCompressed.files.get("_framework/App.abc123.wasm.gz")).toBe(
      "/repo/app/obj/Release/net11.0/compressed/zzz-{0}-abc123-abc123.gz",
    );
  });

  it("returns wwwroot globs as patterns rather than assets", () => {
    const { patterns } = collectManifestAssets(manifest, manifestDir);

    expect(patterns).toEqual([
      {
        routePrefix: "",
        contentRoot: "/repo/app/wwwroot/",
        pattern: "**",
        depth: 0,
      },
    ]);
  });

  it("anchors a relative content root to the manifest directory", () => {
    const relativeRoot = parseRuntimeManifest(
      JSON.stringify({
        ContentRoots: ["wwwroot/"],
        Root: {
          Children: {
            "app.js": {
              Children: null,
              Asset: { ContentRootIndex: 0, SubPath: "app.js" },
              Patterns: null,
            },
          },
          Asset: null,
          Patterns: null,
        },
      }),
    );

    const { files } = collectManifestAssets(relativeRoot, manifestDir);
    expect(files.get("app.js")).toBe(`${manifestDir}/wwwroot/app.js`);
  });

  it("fails loudly on a content root index the manifest does not have", () => {
    const dangling = parseRuntimeManifest(
      JSON.stringify({
        ContentRoots: [],
        Root: {
          Children: {
            "app.js": {
              Children: null,
              Asset: { ContentRootIndex: 3, SubPath: "app.js" },
              Patterns: null,
            },
          },
          Asset: null,
          Patterns: null,
        },
      }),
    );

    expect(() => collectManifestAssets(dangling, manifestDir)).toThrow(
      /ContentRootIndex 3/,
    );
  });
});

describe("expandPatternSources", () => {
  const scratch = mkdtempSync(join(tmpdir(), "vite-plugin-dotnet-wasm-"));

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("walks a wwwroot recursively and keeps served paths POSIX-shaped", () => {
    const wwwroot = join(scratch, "wwwroot");
    mkdirSync(join(wwwroot, "css"), { recursive: true });
    writeFileSync(join(wwwroot, "index.html"), "");
    writeFileSync(join(wwwroot, "css", "site.css"), "");
    writeFileSync(join(wwwroot, "css", "site.css.gz"), "");

    const files = expandPatternSources([
      { routePrefix: "", contentRoot: wwwroot, pattern: "**", depth: 0 },
    ]);

    expect([...files.keys()].sort()).toEqual(["css/site.css", "index.html"]);
    expect(files.get("css/site.css")).toBe(join(wwwroot, "css", "site.css"));
  });

  it("prefixes served paths with the node the pattern hangs off", () => {
    const contentRoot = join(scratch, "content");
    mkdirSync(contentRoot, { recursive: true });
    writeFileSync(join(contentRoot, "logo.svg"), "");

    const files = expandPatternSources([
      { routePrefix: "_content/pkg", contentRoot, pattern: "**", depth: 0 },
    ]);

    expect([...files.keys()]).toEqual(["_content/pkg/logo.svg"]);
  });

  it("treats a missing wwwroot as no files", () => {
    const files = expandPatternSources([
      {
        routePrefix: "",
        contentRoot: join(scratch, "absent"),
        pattern: "**",
        depth: 0,
      },
    ]);

    expect(files.size).toBe(0);
  });

  it("refuses a pattern it cannot faithfully expand", () => {
    expect(() =>
      expandPatternSources([
        {
          routePrefix: "",
          contentRoot: scratch,
          pattern: "*.css",
          depth: 0,
        },
      ]),
    ).toThrow(/Unsupported static web assets pattern/);
  });
});

describe("readManifestAssets", () => {
  const scratch = mkdtempSync(join(tmpdir(), "vite-plugin-dotnet-wasm-"));

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("merges explicit assets with pattern-sourced wwwroot files", () => {
    const outDir = join(scratch, "bin");
    const wwwroot = join(scratch, "wwwroot");
    mkdirSync(outDir, { recursive: true });
    mkdirSync(wwwroot, { recursive: true });
    writeFileSync(join(wwwroot, "favicon.ico"), "");

    const manifestPath = join(outDir, "app.staticwebassets.runtime.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        ContentRoots: [outDir, wwwroot],
        Root: {
          Children: {
            _framework: {
              Children: {
                "dotnet.js": {
                  Children: null,
                  Asset: { ContentRootIndex: 0, SubPath: "dotnet.js" },
                  Patterns: null,
                },
              },
              Asset: null,
              Patterns: null,
            },
          },
          Asset: null,
          Patterns: [{ ContentRootIndex: 1, Pattern: "**", Depth: 0 }],
        },
      }),
    );

    const files = readManifestAssets(manifestPath);

    expect([...files.keys()].sort()).toEqual([
      "_framework/dotnet.js",
      "favicon.ico",
    ]);
    expect(files.get("_framework/dotnet.js")).toBe(
      resolve(outDir, "dotnet.js"),
    );
  });
});
