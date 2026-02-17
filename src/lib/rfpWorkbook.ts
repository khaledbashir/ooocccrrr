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
  citation: string;
};

export type WorkbookPricing = {
  id: string;
  item: string;
  amount: string;
  source: string;
  citation: string;
};

export type WorkbookSchedule = {
  id: string;
  milestone: string;
  dueText: string;
  source: string;
  citation: string;
};

export type WorkbookRisk = {
  id: string;
  risk: string;
  severity: "High" | "Medium";
  source: string;
  citation: string;
};

export type WorkbookAssumption = {
  id: string;
  text: string;
  source: string;
  citation: string;
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

export type WorkbookSheetRow = Record<string, unknown>;

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
  return chunk.title;
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
    const citation = chunk.id;

    for (const line of lines) {
      if (REQUIREMENT_PATTERN.test(line)) {
        requirements.push({
          id: `REQ-${reqIndex++}`,
          text: line,
          category: selectCategory(chunk.categoryHits),
          priority: /\b(must|required|shall)\b/i.test(line) ? "High" : "Medium",
          source,
          citation,
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
            citation,
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
          citation,
        });
      }

      if (chunk.riskHits.length > 0 || RISK_PATTERN.test(line)) {
        risks.push({
          id: `RSK-${riskIndex++}`,
          risk: line.slice(0, 140),
          severity: /\b(liquidated damages|termination|indemnif|penalty)\b/i.test(line) ? "High" : "Medium",
          source,
          citation,
        });
      }

      if (ASSUMPTION_PATTERN.test(line)) {
        assumptions.push({
          id: `ASM-${assIndex++}`,
          text: line.slice(0, 140),
          source,
          citation,
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

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return fallback;
}

function inferCitationFromSource(source: string): string {
  const match = source.match(/\((chunk-\d+)\)/i);
  return match?.[1] || "";
}

function rowsToMap(rows: WorkbookSheetRow[], keyField: string, valueField: string) {
  const map = new Map<string, string>();
  for (const row of rows) {
    const key = asString(row[keyField]);
    const value = asString(row[valueField]);
    if (key) map.set(key, value);
  }
  return map;
}

export function parseStructuredWorkbookFromSheets(
  sheets: Record<string, WorkbookSheetRow[]>,
): StructuredWorkbook | null {
  const projectRows = sheets.Project || [];
  const projectMap = rowsToMap(projectRows, "Field", "Value");
  const projectTitle = projectMap.get("Project Title") || "Imported RFP Project";
  const clientName = projectMap.get("Client") || "Unknown Client";
  const venueName = projectMap.get("Venue") || "Unknown Venue";
  const generatedAt = projectMap.get("Generated At") || new Date().toISOString();

  const requirements = (sheets.Requirements || []).map((row, index) => ({
    id: asString(row.ID, `REQ-${index + 1}`),
    text: asString(row.Requirement),
    category: asString(row.Category, "General"),
    priority: (asString(row.Priority, "Medium") === "High" ? "High" : "Medium") as "High" | "Medium",
    source: asString(row.Source),
    citation: asString(row.Citation) || inferCitationFromSource(asString(row.Source)),
  })).filter((row) => row.text);

  const pricing = (sheets.Pricing || []).map((row, index) => ({
    id: asString(row.ID, `PRC-${index + 1}`),
    item: asString(row.Item),
    amount: asString(row.Amount),
    source: asString(row.Source),
    citation: asString(row.Citation) || inferCitationFromSource(asString(row.Source)),
  })).filter((row) => row.item);

  const schedule = (sheets.Schedule || []).map((row, index) => ({
    id: asString(row.ID, `SCH-${index + 1}`),
    milestone: asString(row.Milestone),
    dueText: asString(row.Due, "TBD"),
    source: asString(row.Source),
    citation: asString(row.Citation) || inferCitationFromSource(asString(row.Source)),
  })).filter((row) => row.milestone);

  const risks = (sheets.Risks || []).map((row, index) => ({
    id: asString(row.ID, `RSK-${index + 1}`),
    risk: asString(row.Risk),
    severity: (asString(row.Severity, "Medium") === "High" ? "High" : "Medium") as "High" | "Medium",
    source: asString(row.Source),
    citation: asString(row.Citation) || inferCitationFromSource(asString(row.Source)),
  })).filter((row) => row.risk);

  const assumptions = (sheets.Assumptions || []).map((row, index) => ({
    id: asString(row.ID, `ASM-${index + 1}`),
    text: asString(row.Assumption),
    source: asString(row.Source),
    citation: asString(row.Citation) || inferCitationFromSource(asString(row.Source)),
  })).filter((row) => row.text);

  const sources = (sheets.Sources || []).map((row) => ({
    id: asString(row["Chunk ID"]),
    title: asString(row.Title),
    score: Number(asString(row.Score, "0")) || 0,
    label: asString(row.Label, "maybe"),
  })).filter((row) => row.id || row.title);

  if (
    requirements.length === 0 &&
    pricing.length === 0 &&
    schedule.length === 0 &&
    risks.length === 0 &&
    assumptions.length === 0
  ) {
    return null;
  }

  return {
    project: { projectTitle, clientName, venueName, generatedAt },
    requirements,
    pricing,
    schedule,
    risks,
    assumptions,
    sources,
  };
}

export function structuredWorkbookToMarkdown(model: StructuredWorkbook): string {
  const sections: string[] = [];

  sections.push(
    `# ${model.project.projectTitle}\n\n` +
      `- Client: ${model.project.clientName}\n` +
      `- Venue: ${model.project.venueName}\n` +
      `- Generated: ${model.project.generatedAt}`,
  );

  if (model.requirements.length > 0) {
    sections.push(
      "## Requirements\n\n" +
        model.requirements
          .slice(0, 80)
          .map((item) => `- [${item.priority}] ${item.text} (${item.category}) [${item.citation || item.source}]`)
          .join("\n"),
    );
  }

  if (model.pricing.length > 0) {
    sections.push(
      "## Pricing\n\n| Item | Amount |\n|---|---|\n" +
        model.pricing
          .slice(0, 80)
          .map((item) => `| ${item.item.replace(/\|/g, "\\|")} | ${item.amount} |`)
          .join("\n"),
    );
  }

  if (model.schedule.length > 0) {
    sections.push(
      "## Schedule\n\n" +
        model.schedule
          .slice(0, 80)
          .map((item) => `- ${item.milestone} (Due: ${item.dueText}) [${item.citation || item.source}]`)
          .join("\n"),
    );
  }

  if (model.risks.length > 0) {
    sections.push(
      "## Risks\n\n" +
        model.risks
          .slice(0, 80)
          .map((item) => `- [${item.severity}] ${item.risk} [${item.citation || item.source}]`)
          .join("\n"),
    );
  }

  if (model.assumptions.length > 0) {
    sections.push(
      "## Assumptions\n\n" +
        model.assumptions
          .slice(0, 80)
          .map((item) => `- ${item.text} [${item.citation || item.source}]`)
          .join("\n"),
    );
  }

  return sections.join("\n\n");
}
