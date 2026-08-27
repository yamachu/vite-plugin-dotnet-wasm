import { describe, expect, it } from "vitest";

import { createStagingKey } from "../src/index";

describe("createStagingKey", () => {
  it("names the directory after the project, configuration and output kind", () => {
    expect(
      createStagingKey({
        projectPath: "../app/MyApp.csproj",
        configuration: "Release",
        publish: false,
      }),
    ).toBe("MyApp-Release-build");
  });

  it("keeps build and publish output apart", () => {
    const options = { projectPath: "app.csproj", configuration: "Release" };

    expect(createStagingKey({ ...options, publish: true })).not.toBe(
      createStagingKey({ ...options, publish: false }),
    );
  });

  it("keeps two projects apart so pruning cannot cross over", () => {
    const options = { configuration: "Debug", publish: false };

    expect(createStagingKey({ ...options, projectPath: "a/Core.csproj" })).not.toBe(
      createStagingKey({ ...options, projectPath: "b/Ui.csproj" }),
    );
  });

  it("keeps the directory name filesystem-safe", () => {
    expect(
      createStagingKey({
        projectPath: "My App (v2).csproj",
        configuration: "Release",
        publish: false,
      }),
    ).toBe("My_App__v2_-Release-build");
  });
});
