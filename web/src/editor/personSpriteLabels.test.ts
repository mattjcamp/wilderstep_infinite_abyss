import { describe, expect, it } from "vitest";

import { parsePersonSprite } from "./personSpriteLabels";

describe("parsePersonSprite", () => {
  it("reads race / gender / class, with person = Human", () => {
    expect(parsePersonSprite("person_male_ranger.png")).toMatchObject({
      path: "person/person_male_ranger.png",
      kind: "class",
      race: "human",
      gender: "male",
      classId: "ranger",
      label: "Ranger",
      sublabel: "Human · Male",
    });
  });

  it("labels villagers, musicians and the plain body", () => {
    expect(parsePersonSprite("dwarf_female_villager_noble.png")).toMatchObject({
      kind: "villager",
      label: "Villager (Noble)",
      sublabel: "Dwarf · Female",
    });
    expect(parsePersonSprite("person_male_musician_lute.png")).toMatchObject({
      kind: "musician",
      label: "Musician (Lute)",
    });
    expect(parsePersonSprite("gnome_female.png")).toMatchObject({
      kind: "commoner",
      label: "Commoner",
      race: "gnome",
    });
  });

  it("labels animals and keeps unknown names visible", () => {
    expect(parsePersonSprite("animal_goat.png")).toMatchObject({
      kind: "animal",
      label: "Goat",
      race: null,
    });
    expect(parsePersonSprite("mystery.png")).toMatchObject({
      kind: "other",
      label: "Mystery",
    });
  });

  it("uses the catalog race name when given", () => {
    const info = parsePersonSprite("halfling_male_thief.png", (id) =>
      id === "halfling" ? "Hobbit" : id,
    );
    expect(info.sublabel).toBe("Hobbit · Male");
  });
});

import { recommendedPersonSprite } from "./personSpriteLabels";

describe("recommendedPersonSprite", () => {
  const files = [
    "animal_goat.png",
    "dwarf_male.png",
    "dwarf_male_fighter.png",
    "elf_female_ranger.png",
    "person_female.png",
    "person_female_wizard.png",
    "gnome_female_wizard.png",
  ];
  it("prefers the exact race + gender + class sprite", () => {
    expect(
      recommendedPersonSprite(files, { raceId: "gnome", gender: "Female", classId: "wizard" }),
    ).toBe("person/gnome_female_wizard.png");
  });
  it("falls back to the class + gender in another race, Human first", () => {
    expect(
      recommendedPersonSprite(files, { raceId: "elf", gender: "Female", classId: "wizard" }),
    ).toBe("person/person_female_wizard.png");
  });
  it("then the class default, then a race + gender commoner", () => {
    expect(
      recommendedPersonSprite(files, {
        raceId: "dwarf", gender: "Male", classId: "thief", classDefault: "person/x.png",
      }),
    ).toBe("person/x.png");
    expect(
      recommendedPersonSprite(files, { raceId: "dwarf", gender: "Male", classId: "thief" }),
    ).toBe("person/dwarf_male.png");
  });
  it("returns empty when there is no art", () => {
    expect(recommendedPersonSprite([], { raceId: "elf", gender: "Male", classId: "ranger" })).toBe("");
  });
});
