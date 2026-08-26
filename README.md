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

For .NET 11 projects using the default `build` mode, framework assets are no
longer copied to `bin` by default. Until `publish` becomes the default, opt in
to the compatibility behavior with `dotnetBuildArgs`:

```ts
dotnetWasm({
  projectPath: "./PATH/TO/PROJECT.csproj",
  dotnetBuildArgs: [
    "-p:_WasmFrameworkCopyToOutputDirectory=PreserveNewest",
  ],
});
```

`_WasmFrameworkCopyToOutputDirectory` is an internal .NET SDK property and may
change or be removed in a future SDK release. Prefer `publish: true` for new
projects.

## LICENSE

MIT
