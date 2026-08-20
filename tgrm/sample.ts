import type { Constraint } from "./types";

export const SAMPLE_TITLE = "Weekend plan";

export const SAMPLE_TEXT = `Saturday
- 9:00 Farmers market at the plaza (keep this)
- 11:00 Espresso at the corner cafe
- 14:00 Read in the park
- 19:00 Coffee after dinner while watching a movie

Sunday
- Sleep until noon
- Brunch with friends
- Evening on the couch`;

export const SAMPLE_CONSTRAINTS: Constraint[] = [
  {
    id: "c-caffeine",
    kind: "must_not",
    body: "coffee",
    aliases: ["espresso", "latte", "cappuccino", "caffeine"],
    active: true,
  },
  {
    id: "c-walk",
    kind: "must_include",
    body: "walk",
    aliases: ["walking", "stroll"],
    active: true,
  },
  {
    id: "c-market",
    kind: "keep_fact",
    body: "Farmers market",
    aliases: ["farmers market"],
    active: true,
  },
];

export function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
