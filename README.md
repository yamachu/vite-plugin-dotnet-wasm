# vite-plugin-dotnet-wasm

Vite plugin for .NET WebAssembly projects.
It supports building, publishing, and serving .NET WebAssembly projects with Vite.

## Installation

```bash
pnpm add -D @yamachu/vite-plugin-dotnet-wasm
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite";
import dotnetWasm from "@yamachu/vite-plugin-dotnet-wasm";

export default defineConfig({
  plugins: [
    dotnetWasm({
      /** Required */
      projectPath: "./PATH/TO/DOTNET/WEBASSEMBLY/Project.csproj",
      /** Optional */
      configuration: "Release",
      dotnetBuildArgs: [/* Additional arguments for dotnet build/publish, default: undefined */],
      publish: false, // Use dotnet publish instead of dotnet build
      watch: true, // Enable watch mode (dotnet watch). Successful builds/publishes trigger a Vite full reload.
      noBuild: false, // Skip dotnet build/publish and only copy prebuilt _framework files
    }),
  ],
});
```

And, see example project in the `examples/` folder.

## How framework assets are resolved

The plugin reads the .NET SDK's static web assets manifest
(`{Project}.staticwebassets.runtime.json`) and stages every asset it declares
into `<cacheDir>/dotnet-wasm/<project>-<configuration>-<build|publish>`
(under `node_modules/.vite` by default), one directory per plugin instance.
`./_framework/*` imports resolve from there in dev, and the staged directory is
what gets copied next to the bundle on build.

This is the approach the .NET team recommends for external bundlers
([dotnet/runtime#132789](https://github.com/dotnet/runtime/issues/132789)). It
means:

- `dotnet build` output works on .NET 11, where framework assets are no longer
  copied to `bin/wwwroot`. No `_WasmFrameworkCopyToOutputDirectory` workaround
  is needed - that property is internal to the SDK and should not be used.
- Assets that never lived in `bin/wwwroot` - your project's own `wwwroot`, static
  files from NuGet packages - are picked up too.
- Fingerprinted file names resolve as-is.

When no manifest is present - `dotnet publish` output, which is already
consolidated, or an SDK that predates the manifest - the plugin falls back to
reading the wwwroot directly, so nothing needs configuring either way.

## LICENSE

MIT
