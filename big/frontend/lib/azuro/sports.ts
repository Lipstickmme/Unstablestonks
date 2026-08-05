// Generated from @azuro-org/dictionaries (dictionaries/sports.json).
// Regenerate with `npm run gen:sports` in big/frontend.
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
  { sportId: 1, name: "Table Tennis", slug: "table-tennis", hub: 'sports' },
  { sportId: 2, name: "Netball", slug: "netball", hub: 'sports' },
  { sportId: 3, name: "Horse Racing AntePost", slug: "horse-racing-antepost", hub: 'sports' },
  { sportId: 4, name: "Athletics", slug: "athletics", hub: 'sports' },
  { sportId: 5, name: "Gaelic Football", slug: "gaelic-football", hub: 'sports' },
  { sportId: 6, name: "Hurling", slug: "hurling", hub: 'sports' },
  { sportId: 7, name: "Trotting", slug: "trotting", hub: 'sports' },
  { sportId: 8, name: "Horse Racing", slug: "horse-racing", hub: 'sports' },
  { sportId: 9, name: "Surfing", slug: "surfing", hub: 'sports' },
  { sportId: 10, name: "Sailing", slug: "sailing", hub: 'sports' },
  { sportId: 11, name: "Beach Soccer", slug: "beach-soccer", hub: 'sports' },
  { sportId: 12, name: "Motorsport", slug: "motorsport", hub: 'sports' },
  { sportId: 13, name: "Chess", slug: "chess", hub: 'sports' },
  { sportId: 14, name: "Golf", slug: "golf", hub: 'sports' },
  { sportId: 15, name: "Billiards", slug: "billiards", hub: 'sports' },
  { sportId: 16, name: "Lottery", slug: "lottery", hub: 'sports' },
  { sportId: 17, name: "Curling", slug: "curling", hub: 'sports' },
  { sportId: 18, name: "Water Polo", slug: "water-polo", hub: 'sports' },
  { sportId: 19, name: "Speedway", slug: "speedway", hub: 'sports' },
  { sportId: 20, name: "Trotting AntePost", slug: "trotting-antepost", hub: 'sports' },
  { sportId: 21, name: "Futsal", slug: "futsal", hub: 'sports' },
  { sportId: 22, name: "Special bets", slug: "special-bets", hub: 'sports' },
  { sportId: 23, name: "Ski Jumping", slug: "ski-jumping", hub: 'sports' },
  { sportId: 24, name: "Skiing", slug: "skiing", hub: 'sports' },
  { sportId: 25, name: "Rugby", slug: "rugby", hub: 'sports' },
  { sportId: 26, name: "Volleyball", slug: "volleyball", hub: 'sports' },
  { sportId: 27, name: "Handball", slug: "handball", hub: 'sports' },
  { sportId: 28, name: "Baseball", slug: "baseball", hub: 'sports' },
  { sportId: 29, name: "Boxing", slug: "boxing", hub: 'sports' },
  { sportId: 30, name: "Formula 1", slug: "formula-1", hub: 'sports' },
  { sportId: 31, name: "Basketball", slug: "basketball", hub: 'sports' },
  { sportId: 32, name: "Ice Hockey", slug: "ice-hockey", hub: 'sports' },
  { sportId: 33, name: "Football", slug: "football", hub: 'sports' },
  { sportId: 34, name: "Snooker", slug: "snooker", hub: 'sports' },
  { sportId: 35, name: "Australian Rules", slug: "australian-rules", hub: 'sports' },
  { sportId: 36, name: "MMA", slug: "mma", hub: 'sports' },
  { sportId: 37, name: "Biathlon", slug: "biathlon", hub: 'sports' },
  { sportId: 38, name: "Motorbikes", slug: "motorbikes", hub: 'sports' },
  { sportId: 39, name: "Bicycle Racing", slug: "bicycle-racing", hub: 'sports' },
  { sportId: 40, name: "Cricket", slug: "cricket", hub: 'sports' },
  { sportId: 41, name: "Bowls", slug: "bowls", hub: 'sports' },
  { sportId: 42, name: "TV-Games", slug: "tv-games", hub: 'sports' },
  { sportId: 43, name: "Darts", slug: "darts", hub: 'sports' },
  { sportId: 44, name: "American Football", slug: "american-football", hub: 'sports' },
  { sportId: 45, name: "Tennis", slug: "tennis", hub: 'sports' },
  { sportId: 46, name: "Badminton", slug: "badminton", hub: 'sports' },
  { sportId: 47, name: "Esports", slug: "esports", hub: 'sports' },
  { sportId: 48, name: "Floorball", slug: "floorball", hub: 'sports' },
  { sportId: 49, name: "Sumo", slug: "sumo", hub: 'sports' },
  { sportId: 50, name: "Beach Volleyball", slug: "beach-volleyball", hub: 'sports' },
  { sportId: 51, name: "Field Hockey", slug: "field-hockey", hub: 'sports' },
  { sportId: 52, name: "Squash", slug: "squash", hub: 'sports' },
  { sportId: 53, name: "Crossfit", slug: "crossfit", hub: 'sports' },
  { sportId: 54, name: "Softball", slug: "softball", hub: 'sports' },
  { sportId: 55, name: "Bandy", slug: "bandy", hub: 'sports' },
  { sportId: 56, name: "Politics", slug: "politics", hub: 'sports' },
  { sportId: 57, name: "Aussie Rules", slug: "aussie-rules", hub: 'sports' },
  { sportId: 58, name: "Rugby League", slug: "rugby-league", hub: 'sports' },
  { sportId: 59, name: "Rugby Union", slug: "rugby-union", hub: 'sports' },
  { sportId: 60, name: "Rugby League Nines", slug: "rugby-league-nines", hub: 'sports' },
  { sportId: 61, name: "Rugby Union Sevens", slug: "rugby-union-sevens", hub: 'sports' },
  { sportId: 62, name: "Archery", slug: "archery", hub: 'sports' },
  { sportId: 63, name: "Poker", slug: "poker", hub: 'sports' },
  { sportId: 64, name: "3x3 Basketball", slug: "3x3-basketball", hub: 'sports' },
  { sportId: 65, name: "MLB Series Prices", slug: "mlb-series-prices", hub: 'sports' },
  { sportId: 66, name: "Unique", slug: "unique", hub: 'sports' },
  { sportId: 1000, name: "Dota 2", slug: "dota-2", hub: 'esports' },
  { sportId: 1001, name: "CS:GO", slug: "cs-go", hub: 'esports' },
  { sportId: 1002, name: "League of Legends", slug: "league-of-legends", hub: 'esports' },
  { sportId: 1003, name: "StarCraft II", slug: "starcraft-ii", hub: 'esports' },
  { sportId: 1004, name: "Age of Empires", slug: "age-of-empires", hub: 'esports' },
  { sportId: 1005, name: "Arena of Valor", slug: "arena-of-valor", hub: 'esports' },
  { sportId: 1006, name: "Artifact", slug: "artifact", hub: 'esports' },
  { sportId: 1007, name: "Call of Duty", slug: "call-of-duty", hub: 'esports' },
  { sportId: 1008, name: "Clash Royale", slug: "clash-royale", hub: 'esports' },
  { sportId: 1009, name: "Dragon Ball FighterZ", slug: "dragon-ball-fighterz", hub: 'esports' },
  { sportId: 1010, name: "FIFA", slug: "fifa", hub: 'esports' },
  { sportId: 1011, name: "Fortnite", slug: "fortnite", hub: 'esports' },
  { sportId: 1012, name: "Halo", slug: "halo", hub: 'esports' },
  { sportId: 1013, name: "Hearthstone", slug: "hearthstone", hub: 'esports' },
  { sportId: 1014, name: "Heroes of the Storm", slug: "heroes-of-the-storm", hub: 'esports' },
  { sportId: 1015, name: "King of Glory", slug: "king-of-glory", hub: 'esports' },
  { sportId: 1016, name: "Madden", slug: "madden", hub: 'esports' },
  { sportId: 1017, name: "Magic", slug: "magic", hub: 'esports' },
  { sportId: 1018, name: "NBA2K", slug: "nba2k", hub: 'esports' },
  { sportId: 1019, name: "Overwatch", slug: "overwatch", hub: 'esports' },
  { sportId: 1020, name: "Paladins", slug: "paladins", hub: 'esports' },
  { sportId: 1021, name: "Pro Evolution Soccer", slug: "pro-evolution-soccer", hub: 'esports' },
  { sportId: 1022, name: "PUBG", slug: "pubg", hub: 'esports' },
  { sportId: 1023, name: "Quake", slug: "quake", hub: 'esports' },
  { sportId: 1024, name: "Rainbow Six", slug: "rainbow-six", hub: 'esports' },
  { sportId: 1025, name: "Rocket League", slug: "rocket-league", hub: 'esports' },
  { sportId: 1026, name: "Smite", slug: "smite", hub: 'esports' },
  { sportId: 1027, name: "StarCraft 2", slug: "starcraft-2", hub: 'esports' },
  { sportId: 1028, name: "StarCraft: Brood War", slug: "starcraft-brood-war", hub: 'esports' },
  { sportId: 1029, name: "Street Fighter", slug: "street-fighter", hub: 'esports' },
  { sportId: 1030, name: "Super Smash Bros", slug: "super-smash-bros", hub: 'esports' },
  { sportId: 1031, name: "Team Fortress 2", slug: "team-fortress-2", hub: 'esports' },
  { sportId: 1032, name: "Tekken", slug: "tekken", hub: 'esports' },
  { sportId: 1033, name: "Vainglory", slug: "vainglory", hub: 'esports' },
  { sportId: 1034, name: "Warcraft 3", slug: "warcraft-3", hub: 'esports' },
  { sportId: 1035, name: "Warhammer 2", slug: "warhammer-2", hub: 'esports' },
  { sportId: 1036, name: "World of Tanks", slug: "world-of-tanks", hub: 'esports' },
  { sportId: 1037, name: "World of Warcraft", slug: "world-of-warcraft", hub: 'esports' },
  { sportId: 1038, name: "Dota Auto Chess", slug: "dota-auto-chess", hub: 'esports' },
  { sportId: 1039, name: "Apex Legends", slug: "apex-legends", hub: 'esports' },
  { sportId: 1040, name: "Auto Chess", slug: "auto-chess", hub: 'esports' },
  { sportId: 1041, name: "Dota Underlords", slug: "dota-underlords", hub: 'esports' },
  { sportId: 1042, name: "CrossFire", slug: "crossfire", hub: 'esports' },
  { sportId: 1043, name: "Ragnarok", slug: "ragnarok", hub: 'esports' },
  { sportId: 1044, name: "F1 Esports", slug: "f1-esports", hub: 'esports' },
  { sportId: 1045, name: "Valorant", slug: "valorant", hub: 'esports' },
  { sportId: 1046, name: "Free Fire", slug: "free-fire", hub: 'esports' },
  { sportId: 1047, name: "Brawlhalla", slug: "brawlhalla", hub: 'esports' },
  { sportId: 1048, name: "Brawl Stars", slug: "brawl-stars", hub: 'esports' },
  { sportId: 1049, name: "Call of Duty Mobile", slug: "call-of-duty-mobile", hub: 'esports' },
  { sportId: 1050, name: "Diabotical", slug: "diabotical", hub: 'esports' },
  { sportId: 1051, name: "Legends of Runeterra", slug: "legends-of-runeterra", hub: 'esports' },
  { sportId: 1052, name: "Mobile Legends: Bang Bang", slug: "mobile-legends-bang-bang", hub: 'esports' },
  { sportId: 1053, name: "PUBG Mobile", slug: "pubg-mobile", hub: 'esports' },
  { sportId: 1054, name: "Shadowverse", slug: "shadowverse", hub: 'esports' },
  { sportId: 1055, name: "Teamfight Tactics", slug: "teamfight-tactics", hub: 'esports' },
  { sportId: 1056, name: "Wild Rift", slug: "wild-rift", hub: 'esports' },
  { sportId: 1057, name: "DCL The Game", slug: "dcl-the-game", hub: 'esports' },
  { sportId: 1058, name: "Overwatch 2", slug: "overwatch-2", hub: 'esports' },
  { sportId: 1059, name: "NARAKA: BLADEPOINT", slug: "naraka-bladepoint", hub: 'esports' },
  { sportId: 1060, name: "Honor of Kings", slug: "honor-of-kings", hub: 'esports' },
  { sportId: 1061, name: "Counter-Strike 2", slug: "counter-strike-2", hub: 'esports' },
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
  SPORT_BY_ID.get(Number(sportId))?.name ?? `Sport #${sportId}`

export const getSportSlug = (sportId: number | string): string =>
  SPORT_BY_ID.get(Number(sportId))?.slug ?? String(sportId)

export const getSportHub = (sportId: number | string): SportHubSlug =>
  SPORT_BY_ID.get(Number(sportId))?.hub ?? 'sports'
