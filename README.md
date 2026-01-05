# vite-plugin-dotnet-wasm

Vite plugin for .NET WebAssembly projects.
It supports building and serving .NET WebAssembly projects with Vite.

## Installation

```bash
pnpm add -D vite-plugin-dotnet-wasm
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite";
import dotnetWasm from "vite-plugin-dotnet-wasm";

export default defineConfig({
  plugins: [
    dotnetWasm({
      /** Required */
      projectPath: "./PATH/TO/DOTNET/WEBASSEMBLY/Project.csproj",
      /** Optional */
      configuration: "Release",
      dotnetBuildArgs: [/* Additional arguments for dotnet build, default: undefined */],
      watch: true, // Enable watch mode (dotnet watch build), if you want to build once and without watching .NET files changes, set to false
    }),
  ],
});
```

And, see example project in the `examples/` folder.

## LICENSE

MIT
