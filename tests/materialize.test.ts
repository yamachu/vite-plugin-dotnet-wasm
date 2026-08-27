import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  listStagedRoutes,
  materializeAssets,
  resolveStagingPath,
  stagingMarkerName,
} from "../src/materialize";

describe("resolveStagingPath", () => {
  it("maps a served path onto the staging directory", () => {
    expect(resolveStagingPath("/stage", "_framework/dotnet.js")).toBe(
      join("/stage", "_framework", "dotnet.js"),
    );
  });

  it("refuses to escape the staging directory", () => {
    expect(() => resolveStagingPath("/stage", "../outside.js")).toThrow(
      /Refusing to materialize/,
    );
    expect(() => resolveStagingPath("/stage", "_framework/../../x.js")).toThrow(
      /Refusing to materialize/,
    );
  });

  it("refuses an empty served path", () => {
    expect(() => resolveStagingPath("/stage", "")).toThrow(
      /Refusing to materialize/,
    );
  });
});

describe("materializeAssets", () => {
  let scratch: string;
  let source: string;
  let stage: string;

  const writeSource = (name: string, content: string): string => {
    const path = join(source, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
    return path;
  };

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "vite-plugin-dotnet-wasm-"));
    source = join(scratch, "obj");
    stage = join(scratch, "stage");
    mkdirSync(source, { recursive: true });
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("copies assets from scattered roots into one directory", () => {
    const files = new Map([
      ["_framework/dotnet.js", writeSource("fx/dotnet.js", "loader")],
      ["_framework/App.wasm", writeSource("webcil/App.wasm", "wasm")],
      ["favicon.ico", writeSource("wwwroot/favicon.ico", "icon")],
    ]);

    const result = materializeAssets(files, stage);

    expect(result).toEqual({ written: 3, unchanged: 0, removed: 0 });
    expect(listStagedRoutes(stage)).toEqual([
      "_framework/App.wasm",
      "_framework/dotnet.js",
      "favicon.ico",
    ]);
    expect(readFileSync(join(stage, "_framework", "dotnet.js"), "utf8")).toBe(
      "loader",
    );
  });

  it("skips files that are already current on a second run", () => {
    const files = new Map([
      ["_framework/dotnet.js", writeSource("fx/dotnet.js", "loader")],
    ]);

    materializeAssets(files, stage);
    expect(materializeAssets(files, stage)).toEqual({
      written: 0,
      unchanged: 1,
      removed: 0,
    });
  });

  it("recopies a file whose contents changed", () => {
    const path = writeSource("fx/dotnet.js", "loader");
    const files = new Map([["_framework/dotnet.js", path]]);
    materializeAssets(files, stage);

    writeFileSync(path, "rebuilt loader");
    expect(materializeAssets(files, stage).written).toBe(1);
    expect(readFileSync(join(stage, "_framework", "dotnet.js"), "utf8")).toBe(
      "rebuilt loader",
    );
  });

  it("recopies a same-size file that was rebuilt", () => {
    const path = writeSource("fx/dotnet.js", "aaaa");
    const files = new Map([["_framework/dotnet.js", path]]);
    materializeAssets(files, stage);

    writeFileSync(path, "bbbb");
    const later = new Date(statSync(path).mtimeMs + 5000);
    utimesSync(path, later, later);

    expect(materializeAssets(files, stage).written).toBe(1);
    expect(readFileSync(join(stage, "_framework", "dotnet.js"), "utf8")).toBe(
      "bbbb",
    );
  });

  it("deletes assets a rebuild no longer declares", () => {
    materializeAssets(
      new Map([["_framework/App.abc123.wasm", writeSource("webcil/App.wasm", "v1")]]),
      stage,
    );

    const result = materializeAssets(
      new Map([["_framework/App.def456.wasm", writeSource("webcil/App.wasm", "v2")]]),
      stage,
    );

    expect(result.removed).toBe(1);
    expect(listStagedRoutes(stage)).toEqual(["_framework/App.def456.wasm"]);
  });

  it("removes directories that pruning emptied", () => {
    materializeAssets(
      new Map([["old/nested/App.wasm", writeSource("webcil/App.wasm", "v1")]]),
      stage,
    );
    materializeAssets(
      new Map([["_framework/App.wasm", writeSource("webcil/App.wasm", "v1")]]),
      stage,
    );

    expect(existsSync(join(stage, "old"))).toBe(false);
  });

  it("keeps stale files when pruning is off", () => {
    materializeAssets(
      new Map([["_framework/App.abc123.wasm", writeSource("webcil/App.wasm", "v1")]]),
      stage,
    );

    const result = materializeAssets(
      new Map([["_framework/App.def456.wasm", writeSource("webcil/App.wasm", "v2")]]),
      stage,
      { prune: false },
    );

    expect(result.removed).toBe(0);
    expect(listStagedRoutes(stage)).toEqual([
      "_framework/App.abc123.wasm",
      "_framework/App.def456.wasm",
    ]);
  });

  it("marks the directory it owns", () => {
    materializeAssets(
      new Map([["_framework/dotnet.js", writeSource("fx/dotnet.js", "loader")]]),
      stage,
    );

    expect(existsSync(join(stage, stagingMarkerName))).toBe(true);
    expect(listStagedRoutes(stage)).not.toContain(stagingMarkerName);
  });

  it("refuses to prune a directory it does not own", () => {
    mkdirSync(stage, { recursive: true });
    writeFileSync(join(stage, "important.txt"), "not ours");

    expect(() =>
      materializeAssets(
        new Map([["_framework/dotnet.js", writeSource("fx/dotnet.js", "loader")]]),
        stage,
      ),
    ).toThrow(/Refusing to prune/);
    expect(existsSync(join(stage, "important.txt"))).toBe(true);
  });

  it("adopts an empty directory", () => {
    mkdirSync(stage, { recursive: true });

    expect(() =>
      materializeAssets(
        new Map([["_framework/dotnet.js", writeSource("fx/dotnet.js", "loader")]]),
        stage,
      ),
    ).not.toThrow();
  });
});
