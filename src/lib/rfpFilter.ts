export type RelevanceLabel = "relevant" | "maybe" | "irrelevant";

type KeywordCategory = {
  name: string;
  keywords: string[];
};

export type ChunkScore = {
  label: RelevanceLabel;
  score: number;
  reason: string;
  categoryHits: string[];
  riskHits: string[];
  matchedKeywords: string[];
};

const KEYWORD_CATEGORIES: KeywordCategory[] = [
  {
    name: "Display Hardware",
    keywords: ["led", "video board", "scoreboard", "ribbon board", "fascia"],
  },
  {
    name: "Display Specs",
    keywords: ["pixel pitch", "nits", "brightness", "resolution", "ip65"],
  },
  {
    name: "Electrical",
    keywords: ["voltage", "amperage", "circuit breaker", "conduit"],
  },
  {
    name: "Structural",
    keywords: ["rigging", "steel", "i-beam", "anchor", "dead load"],
  },
  {
    name: "Installation",
    keywords: ["crane", "lift", "scaffolding", "commissioning"],
  },
  {
    name: "Control/Data",
    keywords: ["fiber", "hdmi", "processor", "media player"],
  },
  {
    name: "Permits",
    keywords: ["building code", "zoning", "fire marshal"],
  },
  {
    name: "Commercial",
    keywords: ["pricing", "bid", "rfp", "sow", "warranty"],
  },
];

const MUST_KEEP_KEYWORDS = ["11 06 60", "display schedule", "exhibit b", "division 26", "division 27"];
const SIGNAL_KEYWORDS = ["pixel pitch", "nits", "structural", "warranty"];
const NOISE_KEYWORDS = ["indemnification", "force majeure", "arbitration"];
const RISK_KEYWORDS = ["liability", "liquidated damages", "insurance", "bonding", "compliance", "penalty"];

function includesKeyword(text: string, keyword: string): boolean {
  return text.includes(keyword.toLowerCase());
}

export function toChunkTitle(text: string, index: number): string {
  const heading = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line.length < 110);
  return heading || `Section ${index + 1}`;
}

export function splitIntoChunks(rawText: string): string[] {
  const normalized = rawText.trim();
  if (!normalized) return [];

  if (normalized.includes("\n\n---\n\n")) {
    return normalized
      .split("\n\n---\n\n")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 80);
}

export function scoreRfpChunk(text: string): ChunkScore {
  const hay = text.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  const matchedKeywords = new Set<string>();
  const categoryHits = new Set<string>();
  const riskHits = new Set<string>();

  for (const keyword of MUST_KEEP_KEYWORDS) {
    if (includesKeyword(hay, keyword)) {
      score += 6;
      matchedKeywords.add(keyword);
      reasons.push(`must-keep: "${keyword}"`);
    }
  }

  for (const keyword of SIGNAL_KEYWORDS) {
    if (includesKeyword(hay, keyword)) {
      score += 2;
      matchedKeywords.add(keyword);
      reasons.push(`signal: "${keyword}"`);
    }
  }

  for (const keyword of NOISE_KEYWORDS) {
    if (includesKeyword(hay, keyword)) {
      score -= 2;
      matchedKeywords.add(keyword);
      reasons.push(`noise: "${keyword}"`);
    }
  }

  for (const keyword of RISK_KEYWORDS) {
    if (includesKeyword(hay, keyword)) {
      score += 1;
      riskHits.add(keyword);
      matchedKeywords.add(keyword);
    }
  }

  for (const category of KEYWORD_CATEGORIES) {
    const hasCategoryMatch = category.keywords.some((keyword) => {
      if (!includesKeyword(hay, keyword)) return false;
      matchedKeywords.add(keyword);
      return true;
    });
    if (hasCategoryMatch) {
      categoryHits.add(category.name);
      score += 2;
    }
  }

  if (hay.includes("mandatory") || hay.includes("must")) {
    score += 1;
    reasons.push("mandatory language");
  }
  if (hay.includes("deadline") || hay.includes("due date") || hay.includes("submission")) {
    score += 1;
    reasons.push("submission/deadline language");
  }

  let label: RelevanceLabel = "irrelevant";
  if (score >= 6 || Array.from(matchedKeywords).some((keyword) => MUST_KEEP_KEYWORDS.includes(keyword))) {
    label = "relevant";
  } else if (score >= 2) {
    label = "maybe";
  }

  return {
    label,
    score,
    reason: reasons.slice(0, 3).join(", ") || "low keyword signal",
    categoryHits: Array.from(categoryHits),
    riskHits: Array.from(riskHits),
    matchedKeywords: Array.from(matchedKeywords).slice(0, 8),
  };
}
