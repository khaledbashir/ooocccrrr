export type RelevanceLabel = "relevant" | "maybe" | "irrelevant";

export type RfpMeta = {
  clientName: string | null;
  venueName: string | null;
  projectTitle: string | null;
};

type KeywordCategory = {
  name: string;
  keywords: string[];
};

type PatternBucket = {
  name: string;
  patterns: RegExp[];
};

export type ChunkScore = {
  label: RelevanceLabel;
  score: number;
  reason: string;
  categoryHits: string[];
  riskHits: string[];
  matchedKeywords: string[];
  boosterHits: string[];
  drawingCandidate: boolean;
};

const KEYWORD_CATEGORIES: KeywordCategory[] = [
  {
    name: "Display Hardware",
    keywords: [
      "led", "l.e.d.", "led display", "video board", "video display", "video wall", "scoreboard", "ribbon board",
      "ribbon display", "fascia", "fascia board", "center hung", "centerhung", "auxiliary board", "auxiliary display",
      "marquee", "digital signage", "display panel", "display module", "led module", "led cabinet", "led tile",
    ],
  },
  {
    name: "Display Specs",
    keywords: [
      "pixel pitch", "smd", "dip", "brightness", "nits", "candela", "viewing distance", "viewing angle",
      "refresh rate", "resolution", "grayscale", "color temperature", "contrast ratio", "ip rating", "ip65", "ip54",
      "weatherproof", "outdoor rated", "indoor rated",
    ],
  },
  {
    name: "Electrical",
    keywords: [
      "electrical", "power distribution", "power supply", "power requirements", "voltage", "amperage", "wattage",
      "circuit breaker", "transformer", "ups", "uninterruptible", "generator", "conduit", "junction box", "disconnect",
      "nec", "electrical code", "branch circuit", "dedicated circuit", "service entrance", "panel board", "load calculation",
    ],
  },
  {
    name: "Structural",
    keywords: [
      "mounting", "rigging", "structural", "structural steel", "steel", "i-beam", "w-beam", "catenary", "guy wire",
      "dead load", "live load", "wind load", "seismic", "anchor", "concrete anchor", "embed plate", "unistrut", "bracket",
      "cleat", "hanger", "truss", "canopy", "overhang", "elevation", "structural engineer", "pe stamp",
    ],
  },
  {
    name: "Installation",
    keywords: [
      "installation", "install", "labor", "crew", "lift", "crane", "boom lift", "scissor lift", "scaffolding",
      "conduit run", "cable tray", "wire pull", "termination", "commissioning", "testing", "alignment", "leveling",
    ],
  },
  {
    name: "Control/Data",
    keywords: [
      "control system", "controller", "processor", "video processor", "scaler", "fiber", "fiber optic", "data cable",
      "cat6", "cat5", "hdmi", "dvi", "sdi", "signal", "redundancy", "failover", "network", "switch", "media player",
    ],
  },
  {
    name: "Permits",
    keywords: [
      "permit", "permits", "sign code", "building code", "zoning", "variance", "ada", "egress", "fire code",
      "fire marshal", "inspection", "stamped drawings", "pe", "professional engineer", "shop drawings", "submittals",
    ],
  },
  {
    name: "Commercial",
    keywords: [
      "pricing", "bid", "proposal", "quote", "rfp", "rfq", "scope of work", "sow", "specification", "spec",
      "spec section", "division", "csi", "alternates", "alternate", "base bid", "add alternate", "deduct alternate",
      "unit price", "allowance", "contingency", "warranty", "maintenance", "service agreement",
    ],
  },
];

const MUST_KEEP_PHRASES = [
  "11 06 60", "11.06.60", "110660", "11 63 10", "11.63.10", "116310", "section 11", "division 11",
  "led display schedule", "display schedule", "schedule of displays", "av schedule", "exhibit b", "cost schedule",
  "bid form", "exhibit a", "thornton tomasetti", "tte", "division 26", "26 51", "sports lighting", "division 27",
  "27 41", "sound system",
];

const SIGNAL_KEYWORDS = [
  "schedule", "pricing", "bid form", "display", "led", "specification", "technical", "qty", "quantity", "pixel pitch",
  "resolution", "nits", "brightness", "cabinet", "module", "diode", "refresh rate", "viewing angle", "warranty",
  "spare parts", "maintenance", "structural", "steel", "weight", "lbs", "kg", "power", "voltage", "amps", "circuit",
  "data", "fiber", "cat6", "division 27", "division 26", "section 11", "active area", "dimensions",
];

const NOISE_KEYWORDS = [
  "indemnification", "insurance", "liability", "termination", "arbitration", "force majeure", "governing law", "jurisdiction",
  "severability", "waiver", "confidentiality", "intellectual property", "compliance", "equal opportunity", "harassment",
  "drug-free", "background check",
];

const HIGH_VALUE_BOOSTERS = [
  /\$[\d,]+/,
  /\d+['′]\s*[hHxX×]\s*\d+/,
  /\d+\s*mm\b/i,
  /\d+\s*nit/i,
  /\d+\s*sq/i,
  /\bled\b.*\bdisplay\b/i,
  /\bphase\s*\d/i,
  /\byear\s*\d/i,
];

const CATEGORY_PATTERNS: PatternBucket[] = [
  {
    name: "PRICING",
    patterns: [
      /\bpric(e|ing|ed)\b/i, /\bcost\b/i, /\btotal\b/i, /\bbudget\b/i, /\bbid\b/i, /\bquot(e|ation)\b/i, /\bfee\b/i,
      /\brate\b/i, /\bcompensation\b/i, /\ballowance\b/i, /\bestimate\b/i, /\bline\s*item/i, /\bunit\s*price/i,
      /\blump\s*sum/i, /\balternate\b/i, /\badd\s*on/i, /\bdeduct/i,
    ],
  },
  {
    name: "DISPLAY_SPECS",
    patterns: [
      /\bpixel\s*pitch\b/i, /\bresolution\b/i, /\bnit[s]?\b/i, /\bbrightness\b/i, /\bled\b/i, /\blcd\b/i,
      /\bdisplay\b/i, /\bscreen\b/i, /\bvideo\s*(wall|board)\b/i, /\bscoreboard\b/i, /\bribbon\s*board\b/i,
      /\bfascia\b/i, /\bmarquee\b/i, /\bdimension/i, /\bsq(uare)?\s*f(ee)?t\b/i, /\bfoot\b.*\bwide\b/i,
      /\bpower\s*consumption/i, /\bweight\b/i, /\bcabinet\b/i, /\bmodule\b/i, /\brefresh\s*rate/i,
      /\bviewing\s*(angle|distance)/i,
    ],
  },
  {
    name: "SCOPE",
    patterns: [
      /\bscope\s*(of\s*work)?\b/i, /\binstall(ation)?\b/i, /\bdemolition\b/i, /\bremov(e|al)\b/i, /\bphase\b/i,
      /\bmobiliz(e|ation)\b/i, /\bcommission/i, /\bintegrat/i, /\bsubcontract/i, /\bresponsib(le|ility)\b/i,
      /\bexclusion/i, /\bassumption/i, /\bdeliverable/i, /\bwork\s*plan/i, /\bgeneral\s*condition/i, /\bsite\s*prep/i,
    ],
  },
  {
    name: "SCHEDULE",
    patterns: [
      /\bschedule\b/i, /\btimeline\b/i, /\bmilestone\b/i, /\bdeadline\b/i, /\bcompletion\s*date/i,
      /\bnotice\s*to\s*proceed/i, /\bntp\b/i, /\bsubstantial\s*completion/i, /\bduration\b/i, /\bcalendar\s*day/i,
      /\bwork(ing)?\s*day/i, /\bgantt\b/i, /\bcritical\s*path/i, /\bliquidated\s*damage/i,
    ],
  },
  {
    name: "REQUIREMENTS",
    patterns: [
      /\brequirement/i, /\bqualification/i, /\bcertific(ate|ation)/i, /\bcompliance\b/i, /\bstandard\b/i, /\bcode\b/i,
      /\bpermit\b/i, /\binspection\b/i, /\bsubmittal/i, /\bform\b/i, /\bexhibit\b/i, /\battachment\b/i,
      /\bappendix\b/i, /\baddendum\b/i, /\bspecification/i, /\bminority\b/i, /\bmwbe\b/i, /\bdbe\b/i,
      /\bunion\b/i, /\bprevailing\s*wage/i, /\bdavis.bacon/i,
    ],
  },
  {
    name: "WARRANTY",
    patterns: [
      /\bwarranty\b/i, /\bwarranties\b/i, /\bguarantee\b/i, /\bmaintenance\b/i, /\bservice\s*level/i, /\bsla\b/i,
      /\bresponse\s*time/i, /\bspare\s*part/i, /\bpreventative/i, /\bpreventive/i, /\bannual\s*check/i, /\bsupport\b/i,
    ],
  },
  {
    name: "SOFTWARE",
    patterns: [
      /\bcms\b/i, /\bcontent\s*management/i, /\blivesync\b/i, /\bsoftware\b/i, /\bcontrol\s*system/i, /\bprocessor\b/i,
      /\bmedia\s*player/i, /\bnovastar\b/i, /\bcolorlight\b/i, /\bbrightwall\b/i, /\bscaling\b/i, /\bnetwork/i,
    ],
  },
  {
    name: "LEGAL",
    patterns: [
      /\bindemnif/i, /\bliabilit/i, /\binsurance\b/i, /\bbond(ing)?\b/i, /\bcontract\b/i,
      /\bterms?\s*(and|&)\s*condition/i, /\bdispute\b/i, /\barbitration\b/i, /\bgoverning\s*law/i, /\bjurisdiction\b/i,
      /\btermination\b/i, /\bforce\s*majeure/i, /\bconfidential/i, /\bnon.disclosure/i, /\bnda\b/i,
    ],
  },
];

const RISK_PATTERNS: PatternBucket[] = [
  {
    name: "Liquidated Damages",
    patterns: [/liquidated\s+damages/i, /\bLD\b/, /daily\s+penalty/i],
  },
  {
    name: "Performance Bond",
    patterns: [/performance\s+bond/i, /surety\s+bond/i],
  },
  {
    name: "Payment Terms",
    patterns: [/net\s+30/i, /net\s+45/i, /net\s+60/i, /payment\s+terms/i, /progress\s+payment/i],
  },
  {
    name: "Retainage",
    patterns: [/retainage/i, /retention/i, /holdback/i],
  },
  {
    name: "Change Order",
    patterns: [/change\s+order/i, /variation\s+order/i, /scope\s+change/i],
  },
  {
    name: "Force Majeure",
    patterns: [/force\s+majeure/i, /act\s+of\s+god/i],
  },
  {
    name: "Indemnification",
    patterns: [/indemnif/i, /hold\s+harmless/i],
  },
  {
    name: "Insurance",
    patterns: [/insurance/i, /certificate\s+of\s+insurance/i, /additional\s+insured/i],
  },
  {
    name: "Termination",
    patterns: [/termination\s+for\s+cause/i, /termination\s+for\s+convenience/i],
  },
  {
    name: "Dispute Resolution",
    patterns: [/arbitration/i, /mediation/i, /dispute\s+resolution/i],
  },
];

const CLIENT_PATTERNS = [
  /(?:prepared\s+for|submitted\s+to|owner|client|attention|attn)[:\s]+([A-Z][A-Za-z\s&.,'-]{2,60})/i,
];

const VENUE_PATTERNS = [
  /(?:venue|facility|stadium|arena|fieldhouse|center|centre|convention\s+center|amphitheater|coliseum|ballpark)[:\s]+([A-Z][A-Za-z\s&.,'-]{2,80})/i,
  /(?:at|for)\s+(?:the\s+)?([A-Z][A-Za-z\s&'-]{2,60}(?:Stadium|Arena|Fieldhouse|Center|Centre|Convention\s+Center|Amphitheater|Coliseum|Ballpark|Field|Park|Dome))/i,
];

const PROJECT_TITLE_PATTERNS = [
  /(?:project\s*(?:name|title)?|re|subject|rfp\s+(?:for|title))[:\s]+([A-Z][A-Za-z0-9\s&.,'-]{4,120})/i,
];

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.\-_/\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKeyword(keyword: string): string {
  return normalizeText(keyword);
}

function countOccurrences(text: string, keyword: string): number {
  let count = 0;
  let startIndex = 0;
  while (true) {
    const idx = text.indexOf(keyword, startIndex);
    if (idx === -1) break;
    count += 1;
    startIndex = idx + keyword.length;
  }
  return count;
}

function detectPatternHits(text: string, bucket: PatternBucket): number {
  let hit = 0;
  for (const pattern of bucket.patterns) {
    if (pattern.test(text)) hit += 1;
  }
  return hit;
}

function isDrawingCandidate(text: string): boolean {
  const lowerText = text.toLowerCase();
  return (
    text.trim().length < 350 &&
    (lowerText.includes("scale") ||
      lowerText.includes("detail") ||
      lowerText.includes("elevation") ||
      lowerText.includes("section") ||
      lowerText.includes("plan") ||
      lowerText.includes("drawing") ||
      lowerText.includes("dwg") ||
      /\bav-\d+/i.test(text) ||
      (lowerText.includes("sheet") && (lowerText.includes("of") || /\d+/.test(text))))
  );
}

function firstGroupMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function extractRfpMeta(rawText: string): RfpMeta {
  return {
    clientName: firstGroupMatch(rawText, CLIENT_PATTERNS),
    venueName: firstGroupMatch(rawText, VENUE_PATTERNS),
    projectTitle: firstGroupMatch(rawText, PROJECT_TITLE_PATTERNS),
  };
}

export function toChunkTitle(text: string, index: number): string {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);

  for (const line of lines.slice(0, 4)) {
    if (/^(?:SECTION|ARTICLE|PART|CHAPTER|DIVISION)\s+[\dIVXA-Z]/i.test(line)) return line;
    if (/^\d{1,2}(?:\.\d{1,2}){0,3}\s+[A-Z]/.test(line)) return line;
    if (/^[A-Z][A-Z\s&\-/]{8,}$/.test(line)) return line;
    if (/^(?:EXHIBIT|APPENDIX|ATTACHMENT|ADDENDUM)\s/i.test(line)) return line;
    if (line.length < 110) return line;
  }

  return `Section ${index + 1}`;
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
  const normalizedText = normalizeText(text);
  const rawLower = text.toLowerCase();

  let densityHits = 0;
  const matchedKeywords = new Set<string>();
  const reasons: string[] = [];

  for (const phrase of MUST_KEEP_PHRASES) {
    const hitCount = countOccurrences(normalizedText, normalizeKeyword(phrase));
    if (hitCount > 0) {
      densityHits += hitCount * 6;
      matchedKeywords.add(phrase);
      reasons.push(`must-keep: \"${phrase}\"`);
    }
  }

  for (const keyword of SIGNAL_KEYWORDS) {
    const hitCount = countOccurrences(normalizedText, normalizeKeyword(keyword));
    if (hitCount > 0) {
      densityHits += hitCount * 2;
      matchedKeywords.add(keyword);
    }
  }

  for (const keyword of NOISE_KEYWORDS) {
    const hitCount = countOccurrences(normalizedText, normalizeKeyword(keyword));
    if (hitCount > 0) {
      densityHits -= hitCount * 1.8;
      matchedKeywords.add(keyword);
      reasons.push(`noise: \"${keyword}\"`);
    }
  }

  const keywordDensityScore = densityHits > 0 ? densityHits / Math.sqrt(Math.max(normalizedText.length, 1)) : densityHits;

  const categoryHits = new Set<string>();
  let categoryScore = 0;

  for (const category of KEYWORD_CATEGORIES) {
    const hitCount = category.keywords.reduce((total, keyword) => {
      const count = countOccurrences(normalizedText, normalizeKeyword(keyword));
      if (count > 0) matchedKeywords.add(keyword);
      return total + count;
    }, 0);
    if (hitCount > 0) {
      categoryHits.add(category.name);
      categoryScore += Math.min(4, hitCount * 0.9);
    }
  }

  for (const bucket of CATEGORY_PATTERNS) {
    const patternHits = detectPatternHits(text, bucket);
    if (patternHits > 0) {
      categoryHits.add(bucket.name);
      categoryScore += Math.min(2.5, patternHits * 0.45);
    }
  }

  const riskHits = new Set<string>();
  let riskScore = 0;
  for (const risk of RISK_PATTERNS) {
    const hits = detectPatternHits(text, risk);
    if (hits > 0) {
      riskHits.add(risk.name);
      riskScore += Math.min(3, hits * 0.8);
    }
  }

  const boosterHits: string[] = [];
  let boosterScore = 0;
  for (const booster of HIGH_VALUE_BOOSTERS) {
    if (booster.test(text)) {
      boosterHits.push(booster.source);
      boosterScore += 0.7;
    }
  }

  if (/\bmandatory\b|\bmust\b/i.test(rawLower)) reasons.push("mandatory language");
  if (/\bdeadline\b|\bdue date\b|\bsubmission\b/i.test(rawLower)) reasons.push("submission/deadline language");

  const drawingCandidate = isDrawingCandidate(text);
  const drawingScore = drawingCandidate ? 1.4 : 0;

  const score = Number((keywordDensityScore + categoryScore + riskScore + boosterScore + drawingScore).toFixed(2));

  let label: RelevanceLabel = "irrelevant";
  const hasMustKeep = Array.from(matchedKeywords).some((item) => MUST_KEEP_PHRASES.includes(item));
  if (hasMustKeep || score >= 7) {
    label = "relevant";
  } else if (score >= 2.5) {
    label = "maybe";
  }

  return {
    label,
    score,
    reason: reasons.slice(0, 3).join(", ") || "keyword-density analysis",
    categoryHits: Array.from(categoryHits).slice(0, 6),
    riskHits: Array.from(riskHits).slice(0, 6),
    matchedKeywords: Array.from(matchedKeywords).slice(0, 10),
    boosterHits,
    drawingCandidate,
  };
}
