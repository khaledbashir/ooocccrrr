export type StructuredDisplay = {
  id: string;
  name: string;
  location: string;
  widthFt: number;
  heightFt: number;
  sqFt: number;
  pitchMm: number | null;
  quantity: number;
  isOutdoor: boolean;
};

function clean(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function toNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferOutdoor(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("outdoor") || lower.includes("marquee");
}

function inferLocation(text: string): string {
  const parts = text.split(",");
  if (parts.length >= 2) return clean(parts[1]);
  if (text.toLowerCase().includes("lobby")) return "Lobby";
  if (text.toLowerCase().includes("concourse")) return "Concourse";
  if (text.toLowerCase().includes("bowl")) return "In-Bowl";
  return "Unspecified";
}

export function extractStructuredDisplays(rawText: string): StructuredDisplay[] {
  const lines = rawText
    .split(/\n+/)
    .map((line) => clean(line))
    .filter((line) => line.length >= 8);

  const displays: StructuredDisplay[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const dimensionMatch = line.match(/(\d+(?:\.\d+)?)\s*(?:ft|')?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:ft|')?/i);
    if (!dimensionMatch) continue;

    const width = toNumber(dimensionMatch[2]);
    const height = toNumber(dimensionMatch[1]);
    if (!width || !height) continue;

    const pitchMatch = line.match(/(\d+(?:\.\d+)?)\s*mm/i);
    const qtyMatch = line.match(/\(qty\.?\s*(\d+)\)|\bqty\.?\s*(\d+)\b|\b(\d+)\s*(?:displays|screens|units)\b/i);
    const quantity = Number(qtyMatch?.[1] || qtyMatch?.[2] || qtyMatch?.[3] || "1");
    const pitchMm = pitchMatch ? toNumber(pitchMatch[1]) : null;

    const name = clean(
      line
        .replace(dimensionMatch[0], "")
        .replace(/-\s*\d+(?:\.\d+)?\s*mm/i, "")
        .replace(/\(qty\.?\s*\d+\)/i, "")
        .replace(/\bqty\.?\s*\d+\b/i, "")
        .replace(/,+/g, ",")
        .replace(/^-+|-+$/g, ""),
    ) || `Display ${displays.length + 1}`;

    const idKey = `${name.toLowerCase()}|${height}|${width}|${quantity}`;
    if (seen.has(idKey)) continue;
    seen.add(idKey);

    const sqFt = Math.round(height * width * 100) / 100;
    displays.push({
      id: `display-${displays.length + 1}`,
      name,
      location: inferLocation(line),
      widthFt: width,
      heightFt: height,
      sqFt,
      pitchMm,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      isOutdoor: inferOutdoor(line),
    });
  }

  return displays;
}

