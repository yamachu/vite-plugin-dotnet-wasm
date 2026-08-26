import { describe, expect, it } from "vitest";

import {
  rewriteDotnetScriptImports,
  rewriteDotnetScriptImportsInBundle,
} from "../src/imports";

describe("rewriteDotnetScriptImports", () => {
  it("rewrites static and dynamic dotnet.js imports", () => {
    const source = [
      'import { foo } from "/assets/_framework/dotnet.js";',
      'import "/assets/_framework/dotnet.js";',
      'const runtime = import("/assets/_framework/dotnet.js");',
    ].join("\n");

    expect(rewriteDotnetScriptImports(source)).toBe(
      [
        'import { foo } from "./_framework/dotnet.js";',
        'import "./_framework/dotnet.js";',
        'const runtime = import("./_framework/dotnet.js");',
      ].join("\n"),
    );
  });

  it("does not rewrite already-relative imports or unrelated files", () => {
    const source = [
      'import "./_framework/dotnet.js";',
      'import "/assets/_framework/other.js";',
    ].join("\n");

    expect(rewriteDotnetScriptImports(source)).toBe(source);
  });

  it("rewrites only JavaScript chunks in a bundle", () => {
    const chunk = {
      type: "chunk" as const,
      code: 'import "/assets/_framework/dotnet.js";',
    };
    const asset = { type: "asset" as const };
    const bundle = { "entry.js": chunk, "style.css": asset };

    rewriteDotnetScriptImportsInBundle(bundle);

    expect(chunk.code).toBe('import "./_framework/dotnet.js";');
    expect(asset).toEqual({ type: "asset" });
  });
});
