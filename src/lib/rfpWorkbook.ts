export type WorkbookChunkInput = {
  id: string;
  title: string;
  text: string;
  label: "relevant" | "maybe" | "irrelevant";
  score: number;
  categoryHits: string[];
  riskHits: string[];
};

export type WorkbookMetaInput = {
  clientName: string | null;
  venueName: string | null;
  projectTitle: string | null;
};

export type WorkbookRequirement = {
  id: string;
  text: string;
  category: string;
  priority: "High" | "Medium";
  source: string;
};

export type WorkbookPricing = {
  id: string;
  item: string;
  amount: string;
  source: string;
};

export type WorkbookSchedule = {
  id: string;
  milestone: string;
  dueText: string;
  source: string;
};

export type WorkbookRisk = {
  id: string;
  risk: string;
  severity: "High" | "Medium";
  source: string;
};

export type WorkbookAssumption = {
  id: string;
  text: string;
  source: string;
};

export type StructuredWorkbook = {
  project: {
    projectTitle: string;
    clientName: string;
    venueName: string;
    generatedAt: string;
  };
  requirements: WorkbookRequirement[];
  pricing: WorkbookPricing[];
  schedule: WorkbookSchedule[];
  risks: WorkbookRisk[];
  assumptions: WorkbookAssumption[];
  sources: Array<{ id: string; title: string; score: number; label: string }>;
};

function cleanText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function splitLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => cleanText(line))
    .filter((line) => line.length >= 8);
}

function selectCategory(hits: string[]): string {
  if (hits.length === 0) return "General";
  return hits[0];
}

function toSourceLabel(chunk: WorkbookChunkInput): string {
  return `${chunk.title} (${chunk.id})`;
}

const REQUIREMENT_PATTERN = /\b(must|required|shall|submittal|compliance|deliverable|specification)\b/i;
const ASSUMPTION_PATTERN = /\b(assumption|excluded|not included|by others|owner provided|by owner)\b/i;
const SCHEDULE_PATTERN = /\b(deadline|due|completion|milestone|notice to proceed|ntp|calendar day|timeline)\b/i;
const RISK_PATTERN = /\b(liability|indemnif|bond|insurance|penalty|arbitration|retainage|liquidated damages)\b/i;
const DATE_PATTERN =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b20\d{2}\b/i;
const AMOUNT_PATTERN = /\$[\d,]+(?:\.\d{2})?/g;

function dedupeByText<T extends { text?: string; item?: string; milestone?: string; risk?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = cleanText(item.text || item.item || item.milestone || item.risk || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function buildStructuredWorkbook(
  chunks: WorkbookChunkInput[],
  meta: WorkbookMetaInput,
): StructuredWorkbook {
  const selected = chunks.filter((chunk) => chunk.label !== "irrelevant");
  const requirements: WorkbookRequirement[] = [];
  const pricing: WorkbookPricing[] = [];
  const schedule: WorkbookSchedule[] = [];
  const risks: WorkbookRisk[] = [];
  const assumptions: WorkbookAssumption[] = [];

  let reqIndex = 1;
  let priceIndex = 1;
  let schedIndex = 1;
  let riskIndex = 1;
  let assIndex = 1;

  for (const chunk of selected) {
    const lines = splitLines(chunk.text);
    const source = toSourceLabel(chunk);

    for (const line of lines) {
      if (REQUIREMENT_PATTERN.test(line)) {
        requirements.push({
          id: `REQ-${reqIndex++}`,
          text: line,
          category: selectCategory(chunk.categoryHits),
          priority: /\b(must|required|shall)\b/i.test(line) ? "High" : "Medium",
          source,
        });
      }

      const amounts = line.match(AMOUNT_PATTERN);
      if (amounts && amounts.length > 0) {
        for (const amount of amounts) {
          pricing.push({
            id: `PRC-${priceIndex++}`,
            item: line.slice(0, 120),
            amount,
            source,
          });
        }
      }

      if (SCHEDULE_PATTERN.test(line) || DATE_PATTERN.test(line)) {
        const dateMatch = line.match(DATE_PATTERN);
        schedule.push({
          id: `SCH-${schedIndex++}`,
          milestone: line.slice(0, 120),
          dueText: dateMatch ? dateMatch[0] : "TBD",
          source,
        });
      }

      if (chunk.riskHits.length > 0 || RISK_PATTERN.test(line)) {
        risks.push({
          id: `RSK-${riskIndex++}`,
          risk: line.slice(0, 140),
          severity: /\b(liquidated damages|termination|indemnif|penalty)\b/i.test(line) ? "High" : "Medium",
          source,
        });
      }

      if (ASSUMPTION_PATTERN.test(line)) {
        assumptions.push({
          id: `ASM-${assIndex++}`,
          text: line.slice(0, 140),
          source,
        });
      }
    }
  }

  const now = new Date();
  return {
    project: {
      projectTitle: meta.projectTitle || "RFP Project",
      clientName: meta.clientName || "Unknown Client",
      venueName: meta.venueName || "Unknown Venue",
      generatedAt: now.toISOString(),
    },
    requirements: dedupeByText(requirements).slice(0, 200),
    pricing: dedupeByText(pricing).slice(0, 200),
    schedule: dedupeByText(schedule).slice(0, 200),
    risks: dedupeByText(risks).slice(0, 200),
    assumptions: dedupeByText(assumptions).slice(0, 200),
    sources: selected.map((chunk) => ({
      id: chunk.id,
      title: chunk.title,
      score: chunk.score,
      label: chunk.label,
    })),
  };
}
