// Glyphs for the sport navigation, keyed by the slugs in ./azuro/sports.ts.
// Anything unmapped falls back to a bullet — a missing icon should never hide a market.

export const SPORT_ICONS: Record<string, string> = {
  // Team sports
  football: "⚽",
  "beach-soccer": "⚽",
  futsal: "⚽",
  basketball: "🏀",
  "3x3-basketball": "🏀",
  "ice-hockey": "🏒",
  "field-hockey": "🏑",
  bandy: "🏒",
  floorball: "🏑",
  baseball: "⚾",
  softball: "🥎",
  "american-football": "🏈",
  rugby: "🏉",
  "rugby-league": "🏉",
  "rugby-union": "🏉",
  "rugby-league-nines": "🏉",
  "rugby-union-sevens": "🏉",
  "aussie-rules": "🏉",
  "australian-rules": "🏉",
  "gaelic-football": "🏐",
  hurling: "🏑",
  handball: "🤾",
  volleyball: "🏐",
  "beach-volleyball": "🏐",
  netball: "🏐",
  "water-polo": "🤽",
  cricket: "🏏",

  // Racket & individual
  tennis: "🎾",
  "table-tennis": "🏓",
  badminton: "🏸",
  squash: "🎾",
  golf: "⛳",
  snooker: "🎱",
  billiards: "🎱",
  bowls: "🎳",
  darts: "🎯",
  archery: "🏹",

  // Combat
  boxing: "🥊",
  mma: "🥋",
  sumo: "🤼",

  // Motor & racing
  "formula-1": "🏎️",
  motorsport: "🏁",
  motorbikes: "🏍️",
  speedway: "🏍️",
  "bicycle-racing": "🚴",
  "horse-racing": "🐎",
  "horse-racing-antepost": "🐎",
  trotting: "🐎",
  "trotting-antepost": "🐎",
  sailing: "⛵",
  surfing: "🏄",

  // Winter & endurance
  skiing: "⛷️",
  "ski-jumping": "🎿",
  biathlon: "🎿",
  curling: "🥌",
  athletics: "🏃",
  crossfit: "🏋️",

  // Mind & other
  chess: "♟️",
  poker: "🃏",
  lottery: "🎰",
  politics: "🗳️",
  "tv-games": "📺",
  "special-bets": "✨",
  unique: "✨",
  "mlb-series-prices": "⚾",

  // Esports
  "dota-2": "🎮",
  "cs-go": "🔫",
  "league-of-legends": "🎮",
  "starcraft-ii": "🚀",
  "call-of-duty": "🔫",
  fortnite: "🎮",
  fifa: "🎮",
  "rocket-league": "🚗",
  valorant: "🔫",
  overwatch: "🎮",
  hearthstone: "🃏",
  "clash-royale": "👑",
  "arena-of-valor": "⚔️",
  "age-of-empires": "🏰",
  "rainbow-six": "🔫",
  "mobile-legends": "📱",
  "king-of-glory": "👑",
  "pubg": "🔫",
  "world-of-tanks": "🚜",
};

export const getSportIcon = (slug: string): string => SPORT_ICONS[slug] ?? "•";
