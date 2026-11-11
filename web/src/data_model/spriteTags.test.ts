import { describe, expect, it } from "vitest";
import {
  parseCategoryTag,
  spriteDisplayName,
  spriteTagSummary,
  spriteTags,
} from "./spriteTags";

describe("spriteTags", () => {
  it("parses race, gender, role and detail", () => {
    expect(spriteTags("person/elf_male_villager_wealthy.png")).toEqual([
      { category: "Race", value: "Elf" },
      { category: "Gender", value: "Male" },
      { category: "Role", value: "Villager" },
      { category: "Detail", value: "Wealthy" },
    ]);
  });
  it("maps person → Human and a bare body → Commoner", () => {
    expect(spriteTagSummary("person_female.png")).toBe("Human · Female · Commoner");
  });
  it("handles classes and animals", () => {
    expect(spriteTagSummary("person/gnome_male_wizard.png")).toBe("Gnome · Male · Wizard");
    expect(spriteTagSummary("person/animal_goat.png")).toBe("Animal · Goat");
  });
  it("gives non-descriptive names no tags", () => {
    expect(spriteTags("item/club.png")).toEqual([]);
    expect(spriteTags("monster/orc.png")).toEqual([]);
    expect(spriteTags("")).toEqual([]);
  });
  it("builds readable display names", () => {
    expect(spriteDisplayName("person/dwarf_female_musician_lute.png")).toEqual({
      label: "Musician (Lute)",
      sublabel: "Dwarf · Female",
    });
    expect(spriteDisplayName("map/lake_inner_tr.png")).toEqual({
      label: "lake inner tr",
      sublabel: "",
    });
  });
  it("parses Category: Value tags", () => {
    expect(parseCategoryTag("role: Guard")).toEqual({ category: "Role", value: "Guard" });
    expect(parseCategoryTag("shopkeeper")).toBeNull();
  });
});
