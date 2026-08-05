// Regenerates lib/azuro/sports.ts from @azuro-org/dictionaries.
//
// The sport catalogue is the feed's key space, so it is checked in rather than fetched at
// runtime — but it does move as Azuro adds sports, hence this script.
//
// Usage:
//   npm i -D @azuro-org/dictionaries
//   npm run gen:sports

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "lib", "azuro", "sports.ts");

const loadSports = () => {
  // The package ships the raw dictionaries; fall back to a sibling checkout of the repo
  // so this works without installing anything.
  const candidates = [
    () => require("@azuro-org/dictionaries/dictionaries/sports.json"),
    () =>
      JSON.parse(
        readFileSync(join(here, "../../../dictionaries/dictionaries/sports.json"), "utf8"),
      ),
  ];

  for (const load of candidates) {
    try {
      return load();
    } catch {
      // Try the next source.
    }
  }

  throw new Error(
    "Could not find sports.json. Install @azuro-org/dictionaries or clone Azuro-protocol/dictionaries alongside this repo.",
  );
};

const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const sports = loadSports();

const rows = Object.entries(sports)
  .map(([id, name]) => ({
    sportId: Number(id),
    name,
    slug: slugify(name),
    // Azuro splits the book into two hubs; esports ids start at 1000.
    hub: Number(id) >= 1000 ? "esports" : "sports",
  }))
  .sort((a, b) => a.sportId - b.sportId);

const body = rows
  .map(
    (row) =>
      `  { sportId: ${row.sportId}, name: ${JSON.stringify(row.name)}, slug: ${JSON.stringify(row.slug)}, hub: '${row.hub}' },`,
  )
  .join("\n");

const file = `// Generated from @azuro-org/dictionaries (dictionaries/sports.json).
// Regenerate with \`npm run gen:sports\` in big/frontend.
//
// This is the whole reason the book is not football-only: Azuro's feed is keyed by
// these sport ids, and every one of them is a live market on the protocol.

import type { SportHubSlug } from './types'

export type SportDefinition = {
  sportId: number
  name: string
  slug: string
  hub: SportHubSlug
}

export const SPORTS: readonly SportDefinition[] = [
${body}
] as const

export const SPORT_BY_ID: ReadonlyMap<number, SportDefinition> = new Map(
  SPORTS.map((sport) => [sport.sportId, sport]),
)

export const SPORT_BY_SLUG: ReadonlyMap<string, SportDefinition> = new Map(
  SPORTS.map((sport) => [sport.slug, sport]),
)

export const TRADITIONAL_SPORTS = SPORTS.filter((sport) => sport.hub === 'sports')
export const ESPORTS = SPORTS.filter((sport) => sport.hub === 'esports')

export const getSportName = (sportId: number | string): string =>
  SPORT_BY_ID.get(Number(sportId))?.name ?? \`Sport #\${sportId}\`

export const getSportSlug = (sportId: number | string): string =>
  SPORT_BY_ID.get(Number(sportId))?.slug ?? String(sportId)

export const getSportHub = (sportId: number | string): SportHubSlug =>
  SPORT_BY_ID.get(Number(sportId))?.hub ?? 'sports'
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, file);
console.log(`Wrote ${rows.length} sports to ${out}`);
