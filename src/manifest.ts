import { readFileSync, readdirSync, type Dirent } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Reader for `{Project}.staticwebassets.runtime.json`.
 *
 * The manifest is the SDK's own answer to "where does this asset physically
 * live?". MSBuild scatters build output across several directories (`obj/fx`,
 * `obj/webcil`, `obj/compressed`, ...) and the manifest maps every served path
 * back to its real location, so reading it removes the need to guess a wwwroot
 * layout. `dotnet publish` consolidates everything and emits no runtime
 * manifest; callers should fall back to the publish directory in that case.
 */

export interface RuntimeManifestAsset {
  ContentRootIndex: number;
  SubPath: string;
}

export interface RuntimeManifestPattern {
  ContentRootIndex: number;
  Pattern: string;
  Depth: number;
}

export interface RuntimeManifestNode {
  Children: Record<string, RuntimeManifestNode> | null;
  Asset: RuntimeManifestAsset | null;
  Patterns: RuntimeManifestPattern[] | null;
}

export interface RuntimeManifest {
  ContentRoots: string[];
  Root: RuntimeManifestNode;
}

/**
 * A `Patterns` entry, resolved to an absolute directory. The SDK uses these for
 * the project's own `wwwroot`, whose files are globbed at serve time instead of
 * being enumerated in the tree.
 */
export interface ManifestPatternSource {
  /** Served path of the node the pattern hangs off, e.g. "" or "css". */
  routePrefix: string;
  /** Absolute path of the directory the pattern matches against. */
  contentRoot: string;
  pattern: string;
  depth: number;
}

export interface ManifestAssets {
  /** Served path (POSIX separators, no leading slash) to absolute file path. */
  files: Map<string, string>;
  patterns: ManifestPatternSource[];
}

export interface CollectManifestAssetsOptions {
  /**
   * Whether to keep pre-compressed representations (`.gz`, `.br`).
   * Vite serves and compresses assets itself, so these are dropped by default.
   */
  includeCompressed?: boolean;
}

const compressedSuffixes = [".gz", ".br"];

const isCompressedRoute = (route: string): boolean =>
  compressedSuffixes.some((suffix) => route.endsWith(suffix));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseAsset(value: unknown, route: string): RuntimeManifestAsset {
  if (
    !isRecord(value) ||
    typeof value["ContentRootIndex"] !== "number" ||
    typeof value["SubPath"] !== "string"
  ) {
    throw new Error(`Malformed Asset entry at "${route}".`);
  }

  return {
    ContentRootIndex: value["ContentRootIndex"],
    SubPath: value["SubPath"],
  };
}

function parsePatterns(value: unknown, route: string): RuntimeManifestPattern[] {
  if (!Array.isArray(value)) {
    throw new Error(`Malformed Patterns entry at "${route}".`);
  }

  return value.map((pattern) => {
    if (
      !isRecord(pattern) ||
      typeof pattern["ContentRootIndex"] !== "number" ||
      typeof pattern["Pattern"] !== "string" ||
      typeof pattern["Depth"] !== "number"
    ) {
      throw new Error(`Malformed Patterns entry at "${route}".`);
    }

    return {
      ContentRootIndex: pattern["ContentRootIndex"],
      Pattern: pattern["Pattern"],
      Depth: pattern["Depth"],
    };
  });
}

function parseNode(value: unknown, route: string): RuntimeManifestNode {
  if (!isRecord(value)) {
    throw new Error(`Malformed node at "${route}".`);
  }

  const rawChildren = value["Children"];
  let children: Record<string, RuntimeManifestNode> | null = null;
  if (rawChildren !== null && rawChildren !== undefined) {
    if (!isRecord(rawChildren)) {
      throw new Error(`Malformed Children entry at "${route}".`);
    }
    children = {};
    for (const [name, child] of Object.entries(rawChildren)) {
      children[name] = parseNode(child, route === "" ? name : `${route}/${name}`);
    }
  }

  const rawAsset = value["Asset"];
  const rawPatterns = value["Patterns"];

  return {
    Children: children,
    Asset:
      rawAsset === null || rawAsset === undefined
        ? null
        : parseAsset(rawAsset, route),
    Patterns:
      rawPatterns === null || rawPatterns === undefined
        ? null
        : parsePatterns(rawPatterns, route),
  };
}

/**
 * Parse the manifest text, validating the parts this plugin relies on. The SDK
 * stamps no version into this file, so a shape check is the only guard against
 * a future layout change silently producing an empty asset set.
 */
export function parseRuntimeManifest(json: string): RuntimeManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new Error(`Failed to parse the static web assets runtime manifest: ${error}`);
  }

  if (!isRecord(raw)) {
    throw new Error("The static web assets runtime manifest is not an object.");
  }

  const contentRoots = raw["ContentRoots"];
  if (
    !Array.isArray(contentRoots) ||
    contentRoots.some((root) => typeof root !== "string")
  ) {
    throw new Error("The static web assets runtime manifest has no ContentRoots.");
  }

  return {
    ContentRoots: contentRoots as string[],
    Root: parseNode(raw["Root"], ""),
  };
}

function resolveContentRoot(
  manifest: RuntimeManifest,
  index: number,
  route: string,
  manifestDir: string,
): string {
  const contentRoot = manifest.ContentRoots[index];
  if (contentRoot === undefined) {
    throw new Error(
      `ContentRootIndex ${index} at "${route}" is outside ContentRoots.`,
    );
  }

  // Content roots are absolute in practice, but the manifest format does not
  // guarantee it; anchor anything relative to the manifest's own directory.
  return isAbsolute(contentRoot)
    ? contentRoot
    : resolve(manifestDir, contentRoot);
}

/**
 * Flatten the manifest tree into served path -> absolute file path.
 *
 * `Patterns` nodes are returned separately rather than expanded: resolving them
 * needs the filesystem, and keeping this function pure makes it testable
 * against a manifest alone.
 */
export function collectManifestAssets(
  manifest: RuntimeManifest,
  manifestDir: string,
  options: CollectManifestAssetsOptions = {},
): ManifestAssets {
  const { includeCompressed = false } = options;

  const files = new Map<string, string>();
  const patterns: ManifestPatternSource[] = [];

  const visit = (node: RuntimeManifestNode, route: string): void => {
    if (node.Asset !== null && (includeCompressed || !isCompressedRoute(route))) {
      const contentRoot = resolveContentRoot(
        manifest,
        node.Asset.ContentRootIndex,
        route,
        manifestDir,
      );
      files.set(route, resolve(contentRoot, node.Asset.SubPath));
    }

    for (const pattern of node.Patterns ?? []) {
      patterns.push({
        routePrefix: route,
        contentRoot: resolveContentRoot(
          manifest,
          pattern.ContentRootIndex,
          route,
          manifestDir,
        ),
        pattern: pattern.Pattern,
        depth: pattern.Depth,
      });
    }

    for (const [name, child] of Object.entries(node.Children ?? {})) {
      visit(child, route === "" ? name : `${route}/${name}`);
    }
  };

  visit(manifest.Root, "");

  return { files, patterns };
}

/**
 * Expand `Patterns` sources against the filesystem.
 *
 * Only the `**` pattern the SDK emits for a project's own wwwroot is supported;
 * anything else is reported so the caller can decide rather than silently
 * dropping files. A missing directory is not an error - an empty or absent
 * wwwroot is the common case.
 */
export function expandPatternSources(
  patterns: readonly ManifestPatternSource[],
  options: CollectManifestAssetsOptions = {},
): Map<string, string> {
  const { includeCompressed = false } = options;
  const files = new Map<string, string>();

  for (const source of patterns) {
    if (source.pattern !== "**") {
      throw new Error(
        `Unsupported static web assets pattern "${source.pattern}" at "${source.routePrefix}".`,
      );
    }

    let entries: Dirent[];
    try {
      entries = readdirSync(source.contentRoot, {
        recursive: true,
        withFileTypes: true,
      });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const absolutePath = join(entry.parentPath, entry.name);
      const route = [
        source.routePrefix,
        relative(source.contentRoot, absolutePath).split(sep).join("/"),
      ]
        .filter((segment) => segment !== "")
        .join("/");

      if (!includeCompressed && isCompressedRoute(route)) {
        continue;
      }
      if (files.has(route)) {
        continue;
      }
      files.set(route, absolutePath);
    }
  }

  return files;
}

const runtimeManifestSuffix = ".staticwebassets.runtime.json";

/**
 * Locate the runtime manifest in a .NET output directory.
 *
 * Returns null when there is none, which is the normal case for `dotnet
 * publish` output (already consolidated) and for SDKs older than the manifest.
 * Callers should fall back to reading the wwwroot directly.
 */
export function findRuntimeManifest(outputDir: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(outputDir);
  } catch {
    return null;
  }

  const manifest = entries.find((entry) => entry.endsWith(runtimeManifestSuffix));

  return manifest === undefined ? null : join(outputDir, manifest);
}

/**
 * Read a manifest from disk and return every served path it declares, with
 * `Patterns` expanded. Pattern-sourced files never shadow an explicit asset.
 */
export function readManifestAssets(
  manifestPath: string,
  options: CollectManifestAssetsOptions = {},
): Map<string, string> {
  const manifestDir = resolve(manifestPath, "..");
  const manifest = parseRuntimeManifest(readFileSync(manifestPath, "utf8"));
  const { files, patterns } = collectManifestAssets(
    manifest,
    manifestDir,
    options,
  );

  for (const [route, filePath] of expandPatternSources(patterns, options)) {
    if (!files.has(route)) {
      files.set(route, filePath);
    }
  }

  return files;
}
