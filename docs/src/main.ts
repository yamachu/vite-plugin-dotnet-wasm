import { marked } from "marked";
import readmeContent from "../../README.md?raw";
// @ts-expect-error: no type definitions
import { setupDotnet } from "./dotnetWasm.js";
import "./style.css";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <header>
    <h1>vite-plugin-dotnet-wasm</h1>
    <p class="tagline">Vite plugin for .NET WebAssembly projects</p>
    <a href="https://github.com/yamachu/vite-plugin-dotnet-wasm" class="github-link">View on GitHub</a>
  </header>

  <main>
    <section class="demo-section">
      <h2>Live Demo</h2>
      <p class="demo-description">
        This stopwatch is powered by .NET WebAssembly, built and served with this plugin.
      </p>
      <div class="stopwatch">
        <div class="time-display">
          Time elapsed in .NET: <span id="time"><i>loading...</i></span>
        </div>
        <div class="controls">
          <button id="pause" class="btn btn-primary">Pause</button>
          <button id="reset" class="btn btn-secondary">Reset</button>
        </div>
      </div>
    </section>

    <section class="readme-section">
      <div class="readme-content" id="readme"></div>
    </section>
  </main>
`;

document.getElementById("readme")!.innerHTML = await marked.parse(readmeContent);

setupDotnet();
