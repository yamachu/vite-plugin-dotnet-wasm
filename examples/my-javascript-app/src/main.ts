import "./style.css";
// @ts-expect-error: 型定義がないけど、問題ない
import { setupDotnet } from "./dotnetWasm.js";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <h1>Stopwatch</h1>
  <p>
    Time elapsed in .NET is <span id="time"><i>loading...</i></span>
  </p>
  <p>
    <button id="pause">Pause</button>
    <button id="reset">Reset</button>
  </p>
`;

setupDotnet();
