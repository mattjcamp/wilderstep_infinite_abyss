import { beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createElement } from "react";

// vitest compiles JSX in classic mode (tsconfig has `jsx: preserve` for
// Next), so the component needs a global `React`. Import it after.
let TravelPlacard: typeof import("./TravelPlacard").TravelPlacard;
beforeAll(async () => {
  (globalThis as { React?: typeof React }).React = React;
  ({ TravelPlacard } = await import("./TravelPlacard"));
});

function render(
  props: Partial<Parameters<typeof import("./TravelPlacard").TravelPlacard>[0]> = {},
) {
  return renderToStaticMarkup(
    createElement(TravelPlacard, {
      questName: "The Hermit's Chart",
      giverName: "Old Hermit",
      destinationName: "The Sunken Vault",
      destinationDescription: "A drowned treasury beneath the bay.",
      message: "Take this chart.",
      onTravel: () => {},
      ...props,
    }),
  );
}

describe("TravelPlacard", () => {
  it("names the giver, destination, quest and quotes the message", () => {
    const html = render();
    expect(html).toContain("The Sunken Vault");
    expect(html).toContain("Old Hermit sends the party to The Sunken Vault.");
    expect(html).toContain("“Take this chart.”");
    expect(html).toContain("— Old Hermit");
    expect(html).toContain("A drowned treasury beneath the bay.");
    expect(html).toContain("The Hermit&#x27;s Chart");
    expect(html).toContain(">Travel<");
    // Single action — no way to decline the trip.
    expect(html).not.toContain("Stay");
  });

  it("falls back to giver-less copy and omits an empty message", () => {
    const html = render({ giverName: "", message: "", destinationDescription: undefined });
    expect(html).toContain("The party is sent to The Sunken Vault.");
    expect(html).not.toContain("blockquote");
    expect(html).not.toContain("—");
  });
});
