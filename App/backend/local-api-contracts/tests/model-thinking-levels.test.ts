import { describe, expect, it } from "vitest";
import {
  defaultThinkingLevel,
  getModelThinkingConfig,
  isThinkingToggleOnly,
  resolveThinkingEnabled,
  resolveThinkingLevel,
} from "../src/model-thinking-levels.js";

describe("model thinking levels", () => {
  it("returns table config, toggle-only, and default middle level", () => {
    const gpt = getModelThinkingConfig("gpt-5.4");
    expect(gpt).toMatchObject({
      switchable: true,
      defaultEnabled: true,
      defaultLevel: "medium",
    });
    expect(isThinkingToggleOnly(getModelThinkingConfig("claude-haiku-4-5"))).toBe(true);
    expect(getModelThinkingConfig("unlisted-model")).toBeNull();
    expect(defaultThinkingLevel(["low", "medium", "high"])).toBe("medium");
    expect(defaultThinkingLevel(["low", "high"])).toBe("low");
    expect(defaultThinkingLevel([])).toBeUndefined();
  });

  it("resolves session override against table defaults", () => {
    const gpt = getModelThinkingConfig("gpt-5.4")!;
    expect(resolveThinkingEnabled(gpt, undefined)).toBe(true);
    expect(resolveThinkingEnabled(gpt, false)).toBe(false);
    expect(resolveThinkingLevel(gpt, undefined)).toBe("medium");
    expect(resolveThinkingLevel(gpt, "high")).toBe("high");
    expect(resolveThinkingLevel(gpt, "not-a-level")).toBe("medium");

    const alwaysOn = getModelThinkingConfig("claude-fable-5")!;
    expect(resolveThinkingEnabled(alwaysOn, false)).toBe(true);
  });
});
