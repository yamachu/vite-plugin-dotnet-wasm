import { defineConfig } from "vite";
import dotnetWasm from "vite-plugin-dotnet-wasm";

export default defineConfig({
  plugins: [
    dotnetWasm({
      projectPath: "../dotnet-wasm/dotnet-wasm.csproj",
    }),
  ],
});
