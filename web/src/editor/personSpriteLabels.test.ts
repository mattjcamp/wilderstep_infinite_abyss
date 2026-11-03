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
