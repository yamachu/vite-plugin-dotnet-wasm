import { describe, expect, it } from "vitest";

import { StreamMarkerDetector } from "../src/watch-marker";

describe("StreamMarkerDetector", () => {
  it("detects markers split across stream chunks", () => {
    let matches = 0;
    const detector = new StreamMarkerDetector("build-complete", () => {
      matches += 1;
    });

    detector.push("build-");
    detector.push("complete");

    expect(matches).toBe(1);
  });

  it("detects every marker in a chunk and ignores incomplete text", () => {
    let matches = 0;
    const detector = new StreamMarkerDetector("done", () => {
      matches += 1;
    });

    detector.push("done done do");
    detector.push("ne");

    expect(matches).toBe(3);
  });

  it("rejects an empty marker", () => {
    expect(() => new StreamMarkerDetector("", () => {})).toThrow(
      "must not be empty",
    );
  });
});
