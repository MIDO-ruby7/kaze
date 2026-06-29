import { describe, expect, it } from "vitest";

import { name, VERSION } from "../index.js";

describe("kaze", () => {
  it("should export the package name", () => {
    expect(name()).toBe("kaze");
  });

  it("should export a version string", () => {
    expect(VERSION).toBe("0.0.1");
  });
});
