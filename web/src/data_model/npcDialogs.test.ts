/**
 * normalizeNpcDialogs — the tolerant reader between authored
 * npcs.json `dialogs` values and the play overlay. The bare-object
 * case is the real-world regression this guards: a hand-written
 * single dialog without `[ ]` used to render as the silent fallback.
 */
import { describe, expect, it } from "vitest";

import {
  normalizeNpcDialogs,
  npcDialogLinesForEditing,
} from "./npcDialogs";

describe("normalizeNpcDialogs", () => {
  it("passes a canonical array through", () => {
    const dialogs = [
      { id: "a", title: "First", text: "Hello." },
      { id: "b", text: "Goodbye." },
    ];
    expect(normalizeNpcDialogs(dialogs)).toEqual([
      { id: "a", title: "First", text: "Hello." },
      { id: "b", title: undefined, text: "Goodbye." },
    ]);
  });

  it("wraps a bare single-dialog object (the King's Messenger case)", () => {
    const dialogs = {
      id: "introduction",
      title: "The King's Message",
      text: "Seek out King Wellerman in the Capital!",
    };
    expect(normalizeNpcDialogs(dialogs)).toEqual([
      {
        id: "introduction",
        title: "The King's Message",
        text: "Seek out King Wellerman in the Capital!",
      },
    ]);
  });

  it("wraps a bare string as one line", () => {
    expect(normalizeNpcDialogs("Well met, traveler.")).toEqual([
      { id: "dialog_1", text: "Well met, traveler." },
    ]);
  });

  it("accepts string entries inside an array", () => {
    expect(normalizeNpcDialogs(["One.", { id: "x", text: "Two." }])).toEqual([
      { id: "dialog_1", text: "One." },
      { id: "x", title: undefined, text: "Two." },
    ]);
  });

  it("backfills missing ids", () => {
    const out = normalizeNpcDialogs([{ text: "A." }, { text: "B." }]);
    expect(out.map((d) => d.id)).toEqual(["dialog_1", "dialog_2"]);
  });

  it("drops entries without usable text", () => {
    expect(
      normalizeNpcDialogs([
        { id: "empty", text: "" },
        { id: "blank", text: "   " },
        { id: "none" },
        42,
        null,
        { id: "ok", text: "Kept." },
      ]),
    ).toEqual([{ id: "ok", title: undefined, text: "Kept." }]);
  });

  it("returns empty for null / undefined / garbage", () => {
    expect(normalizeNpcDialogs(null)).toEqual([]);
    expect(normalizeNpcDialogs(undefined)).toEqual([]);
    expect(normalizeNpcDialogs(42)).toEqual([]);
    expect(normalizeNpcDialogs({ id: "x", title: "no text" })).toEqual([]);
    expect(normalizeNpcDialogs("")).toEqual([]);
  });
});

describe("npcDialogLinesForEditing", () => {
  it("keeps empty-text lines so in-progress edits don't vanish", () => {
    const out = npcDialogLinesForEditing([
      { id: "a", text: "Done." },
      { id: "b", title: "WIP", text: "" },
    ]);
    expect(out).toEqual([
      { id: "a", title: undefined, text: "Done." },
      { id: "b", title: "WIP", text: "" },
    ]);
  });

  it("still coerces non-array shapes through the strict reader", () => {
    expect(
      npcDialogLinesForEditing({ id: "intro", text: "Hello." }),
    ).toEqual([{ id: "intro", title: undefined, text: "Hello." }]);
    expect(npcDialogLinesForEditing(null)).toEqual([]);
  });
});
