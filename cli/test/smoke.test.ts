import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("node runtime loads", () => {
    expect(1 + 1).toBe(2);
  });
});
