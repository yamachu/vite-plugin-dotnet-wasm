import { defineConfig } from "vite";
import dotnetWasm from "@yamachu/vite-plugin-dotnet-wasm";

export default defineConfig({
  plugins: [
    dotnetWasm({
      projectPath: "../dotnet-wasm/dotnet-wasm.csproj",
    }),
  ],
});
