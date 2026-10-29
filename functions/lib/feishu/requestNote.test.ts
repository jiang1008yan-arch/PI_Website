import { describe, expect, it } from "vitest";
import { customerWordsOf, requestNote } from "./requestNote";

describe("the first note of a ticket made from a request", () => {
  it("is written in the two forms the timeline has always had", () => {
    expect(requestNote("", "it is off")).toBe("From Feishu: it is off");
    expect(requestNote("- offline since Monday", "it is off")).toBe("- offline since Monday\n\nFrom Feishu:\nit is off");
  });

  it("gives back the customer's words only for a note without details", () => {
    expect(customerWordsOf(requestNote("", "it is off"))).toBe("it is off");
    expect(customerWordsOf("From Feishu:\n  it is off")).toBe("it is off");
    expect(customerWordsOf(requestNote("- offline", "it is off"))).toBe("");
    expect(customerWordsOf("Called the customer")).toBe("");
  });
});
