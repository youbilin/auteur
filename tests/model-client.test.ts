import { describe, expect, it } from "vitest";
import { chatCompletionsUrl, extractJson, modelsUrl } from "../src/models/client.js";

describe("model client helpers", () => {
  it("normalizes relay URLs", () => {
    expect(chatCompletionsUrl("https://relay.example.com/v1")).toBe(
      "https://relay.example.com/v1/chat/completions",
    );
    expect(chatCompletionsUrl("https://relay.example.com/v1/chat/completions")).toBe(
      "https://relay.example.com/v1/chat/completions",
    );
    expect(modelsUrl("https://relay.example.com/v1")).toBe("https://relay.example.com/v1/models");
  });

  it("extracts fenced and embedded JSON", () => {
    expect(extractJson('```json\n{"ok":true}\n```')).toEqual({ ok: true });
    expect(extractJson('Here is the plan: {"ok":true} done')).toEqual({ ok: true });
    expect(extractJson('prefix [1,2,3] suffix')).toEqual([1, 2, 3]);
  });

  it("throws on empty or non-JSON output", () => {
    expect(() => extractJson("no json here")).toThrow();
    expect(() => extractJson("")).toThrow();
  });
});
