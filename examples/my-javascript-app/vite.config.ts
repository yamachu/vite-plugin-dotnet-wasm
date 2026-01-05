import { defineConfig } from "vite";
import dotnetWasm from "vite-plugin-dotnet-wasm";

export default defineConfig({
  plugins: [
    dotnetWasm({
      projectPath: "../dotnet-wasm/dotnet-wasm.csproj",
    }),
  ],
  build: {
    rolldownOptions: {
      // NOTE: ./_framework/dotnet.js のパスをそのまま出力するため（設定しないと、"../src/_framework/dotnet.js" みたいになってしまう）
      makeAbsoluteExternalsRelative: false,
    },
  },
});
