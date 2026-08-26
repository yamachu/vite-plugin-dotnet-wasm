const dotnetScriptPath = /_framework\/dotnet\.js$/;

export interface BundleEntry {
  type: string;
  code?: string;
}

/**
 * Keep dotnet.js imports relative to the generated bundle. Vite may rewrite
 * the path during bundling, so both static and dynamic imports are handled.
 */
export function rewriteDotnetScriptImports(code: string): string {
  let rewritten = code.replace(
    /(import\s*[^;]*?from\s*)(["'])([^"']*_framework\/dotnet\.js)\2/g,
    (match, prefix: string, quote: string, importPath: string) => {
      if (
        !dotnetScriptPath.test(importPath) ||
        importPath.startsWith("./_framework/dotnet.js")
      ) {
        return match;
      }
      return `${prefix}${quote}./_framework/dotnet.js${quote}`;
    },
  );

  rewritten = rewritten.replace(
    /(import\s*)(["'])([^"']*_framework\/dotnet\.js)\2/g,
    (match, prefix: string, quote: string, importPath: string) => {
      if (
        !dotnetScriptPath.test(importPath) ||
        importPath.startsWith("./_framework/dotnet.js")
      ) {
        return match;
      }
      return `${prefix}${quote}./_framework/dotnet.js${quote}`;
    },
  );

  rewritten = rewritten.replace(
    /(import\s*\(\s*)(["'])([^"']*_framework\/dotnet\.js)\2(\s*\))/g,
    (
      match,
      prefix: string,
      quote: string,
      importPath: string,
      suffix: string,
    ) => {
      if (
        !dotnetScriptPath.test(importPath) ||
        importPath.startsWith("./_framework/dotnet.js")
      ) {
        return match;
      }
      return `${prefix}${quote}./_framework/dotnet.js${quote}${suffix}`;
    },
  );

  return rewritten;
}

export function rewriteDotnetScriptImportsInBundle(
  bundle: Record<string, BundleEntry>,
): void {
  for (const chunk of Object.values(bundle)) {
    if (chunk.type !== "chunk" || chunk.code === undefined) {
      continue;
    }

    const rewritten = rewriteDotnetScriptImports(chunk.code);
    if (rewritten !== chunk.code) {
      chunk.code = rewritten;
    }
  }
}
