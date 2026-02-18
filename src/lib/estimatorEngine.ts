import { ANC_BUDGET_RATES, ANC_BUNDLE_RATES, ANC_VENDOR_RATES } from "@/lib/rateTables";

type PrefillProfile = "outdoor_marquee" | "center_hung" | "lobby_atrium" | "indoor_standard";

type DisplayClassification = {
  profile: PrefillProfile;
  label: string;
  product: string;
  vendorRatePerSqFt: number;
  structuralRatePerSqFt: number;
  isOutdoor: boolean;
  isScoreboardOrCenterHung: boolean;
};

export type AncEstimateInput = {
  rawText: string;
  projectTitle?: string | null;
  clientName?: string | null;
  venueName?: string | null;
};

export type AncEstimateLineItem = {
  id: string;
  group: "hardware" | "labor" | "bundles" | "flat_fees" | "pricing";
  label: string;
  formula: string;
  amount: number;
};

export type AncEstimateResult = {
  project: {
    projectTitle: string;
    clientName: string;
    venueName: string;
    generatedAt: string;
  };
  assumptions: string[];
  display: {
    profile: PrefillProfile;
    label: string;
    product: string;
    quantity: number;
    totalSqFt: number;
    vendorRatePerSqFt: number;
    structuralRatePerSqFt: number;
  };
  lineItems: AncEstimateLineItem[];
  totals: {
    totalCost: number;
    sellingPrice: number;
    taxRate: number;
    taxAmount: number;
    bondRate: number;
    bondAmount: number;
    bidFormSubtotal: number;
    grossMarginDollars: number;
    grossMarginPercent: number;
  };
};

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

function parseQuantity(text: string): number {
  const quantityMatch = text.match(/\b(\d+)\s*(?:displays|screens|units|boards)\b/i);
  if (quantityMatch) {
    const parsed = Number(quantityMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 1;
}

function parseSqFtFromText(text: string): number {
  const sqftMatches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft|sf)\b/gi)];
  const sqftValues = sqftMatches
    .map((m) => Number(m[1]))
    .filter((value) => Number.isFinite(value) && value > 1 && value < 200000);

  const dimensionMatches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:ft|')?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:ft|')?/gi)];
  const dimensionAreas = dimensionMatches
    .map((m) => Number(m[1]) * Number(m[2]))
    .filter((value) => Number.isFinite(value) && value > 1 && value < 200000);

  const candidates = [...sqftValues, ...dimensionAreas];
  if (candidates.length === 0) return 150;
  return Math.max(...candidates);
}

function parseRateFromKeyword(text: string, keyword: string): number {
  const regex = new RegExp(`${keyword}[^\\d]{0,20}(\\d+(?:\\.\\d+)?)\\s*%`, "i");
  const match = text.match(regex);
  if (!match) return 0;
  const rate = Number(match[1]);
  if (!Number.isFinite(rate) || rate < 0) return 0;
  return rate / 100;
}

function classifyDisplay(rawText: string): DisplayClassification {
  const lower = normalizeText(rawText);
  const isOutdoorMarquee = lower.includes("outdoor marquee");
  const isCenterHung = lower.includes("center hung") || lower.includes("scoreboard");
  const isLobby = lower.includes("lobby") || lower.includes("atrium");

  if (isOutdoorMarquee) {
    return {
      profile: "outdoor_marquee",
      label: "Outdoor Marquee",
      product: "Yaham R10 (10mm), 6500 Nits, Rear Service",
      vendorRatePerSqFt: ANC_VENDOR_RATES.outdoor10mmMarquee,
      structuralRatePerSqFt: ANC_BUDGET_RATES.structuralWallPerSqFt,
      isOutdoor: true,
      isScoreboardOrCenterHung: false,
    };
  }

  if (isCenterHung) {
    return {
      profile: "center_hung",
      label: "Center Hung / Scoreboard",
      product: "Yaham R6 or LG 6mm (budgeted at Indoor 4mm dealer-net rate)",
      vendorRatePerSqFt: ANC_VENDOR_RATES.indoor4mmStandard,
      structuralRatePerSqFt: ANC_BUDGET_RATES.structuralCeilingPerSqFt,
      isOutdoor: false,
      isScoreboardOrCenterHung: true,
    };
  }

  if (isLobby) {
    return {
      profile: "lobby_atrium",
      label: "Lobby / Atrium",
      product: "Yaham C2.5 or LG 2.5mm",
      vendorRatePerSqFt: ANC_VENDOR_RATES.indoor25mmLobby,
      structuralRatePerSqFt: ANC_BUDGET_RATES.structuralWallPerSqFt,
      isOutdoor: false,
      isScoreboardOrCenterHung: false,
    };
  }

  return {
    profile: "indoor_standard",
    label: "Indoor Standard",
    product: "Yaham C4 (assumed standard indoor profile)",
    vendorRatePerSqFt: ANC_VENDOR_RATES.indoor4mmStandard,
    structuralRatePerSqFt: ANC_BUDGET_RATES.structuralWallPerSqFt,
    isOutdoor: false,
    isScoreboardOrCenterHung: false,
  };
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export function runAncEstimator(input: AncEstimateInput): AncEstimateResult {
  const rawText = input.rawText || "";
  const classification = classifyDisplay(rawText);
  const quantity = parseQuantity(rawText);
  const sqftPerDisplay = parseSqFtFromText(rawText);
  const totalSqFt = sqftPerDisplay * quantity;

  const vendorRate = classification.vendorRatePerSqFt;
  const ledHardwareCostPerSqFt = vendorRate * ANC_BUDGET_RATES.dutyMultiplier * ANC_BUDGET_RATES.sparesMultiplier;
  const hardware = ledHardwareCostPerSqFt * totalSqFt;
  const installLabor = ANC_BUDGET_RATES.installLaborPerSqFt * totalSqFt;
  const electrical = ANC_BUDGET_RATES.electricalPerSqFt * totalSqFt;
  const structural = classification.structuralRatePerSqFt * totalSqFt;

  const sendingCard = ANC_BUNDLE_RATES.sendingCardPerDisplay * quantity;
  const spareParts = hardware * ANC_BUNDLE_RATES.sparePartsRate;
  const signalCableKit = ANC_BUNDLE_RATES.signalCableKitPer25SqFt * (totalSqFt / 25);
  const upsBackup = classification.isScoreboardOrCenterHung ? ANC_BUNDLE_RATES.upsBatteryBackup : 0;
  const backupProcessor = totalSqFt > 300 ? ANC_BUNDLE_RATES.backupVideoProcessor : 0;
  const weatherproof = classification.isOutdoor ? ANC_BUNDLE_RATES.outdoorWeatherproofPerSqFt * totalSqFt : 0;

  const projectManagement = ANC_BUDGET_RATES.projectManagementFlat;
  const stampedDrawings = ANC_BUDGET_RATES.engineeringStampedDrawingsFlat;

  const totalCost =
    hardware +
    installLabor +
    electrical +
    structural +
    sendingCard +
    spareParts +
    signalCableKit +
    upsBackup +
    backupProcessor +
    weatherproof +
    projectManagement +
    stampedDrawings;

  const sellingPrice = totalCost / (1 - ANC_BUDGET_RATES.marginTarget);
  const taxRate = parseRateFromKeyword(rawText, "tax");
  const bondRate = parseRateFromKeyword(rawText, "bond");
  const taxAmount = sellingPrice * taxRate;
  const bondAmount = sellingPrice * bondRate;
  const bidFormSubtotal = sellingPrice + taxAmount + bondAmount;
  const grossMarginDollars = sellingPrice - totalCost;

  const assumptions = [
    `Profile selected: ${classification.label}`,
    `Product assumption: ${classification.product}`,
    `Quantity: ${quantity}`,
    `Area assumption: ${money(totalSqFt)} sq ft total`,
    `Hardware formula: (Vendor * 1.10 duty * 1.03 spares) * SqFt`,
    `Margin target: ${(ANC_BUDGET_RATES.marginTarget * 100).toFixed(0)}%`,
  ];

  const lineItems: AncEstimateLineItem[] = [
    {
      id: "HW-LED",
      group: "hardware",
      label: "LED Hardware",
      formula: `(${vendorRate} * 1.10 * 1.03) * ${money(totalSqFt)}`,
      amount: money(hardware),
    },
    {
      id: "LAB-INSTALL",
      group: "labor",
      label: "Install Labor",
      formula: `${ANC_BUDGET_RATES.installLaborPerSqFt} * ${money(totalSqFt)}`,
      amount: money(installLabor),
    },
    {
      id: "ELEC",
      group: "labor",
      label: "Electrical",
      formula: `${ANC_BUDGET_RATES.electricalPerSqFt} * ${money(totalSqFt)}`,
      amount: money(electrical),
    },
    {
      id: "STRUCT",
      group: "labor",
      label: "Structural",
      formula: `${classification.structuralRatePerSqFt} * ${money(totalSqFt)}`,
      amount: money(structural),
    },
    {
      id: "BUNDLE-SEND",
      group: "bundles",
      label: "Sending Card",
      formula: `${ANC_BUNDLE_RATES.sendingCardPerDisplay} * ${quantity}`,
      amount: money(sendingCard),
    },
    {
      id: "BUNDLE-SPARES",
      group: "bundles",
      label: "Spare Parts Package (2%)",
      formula: `${money(hardware)} * 0.02`,
      amount: money(spareParts),
    },
    {
      id: "BUNDLE-CABLE",
      group: "bundles",
      label: "Signal Cable Kit",
      formula: `${ANC_BUNDLE_RATES.signalCableKitPer25SqFt} * (${money(totalSqFt)} / 25)`,
      amount: money(signalCableKit),
    },
    {
      id: "BUNDLE-UPS",
      group: "bundles",
      label: "UPS Battery Backup",
      formula: classification.isScoreboardOrCenterHung ? "Scoreboard/Center Hung trigger" : "Not triggered",
      amount: money(upsBackup),
    },
    {
      id: "BUNDLE-PROC",
      group: "bundles",
      label: "Backup Video Processor",
      formula: totalSqFt > 300 ? "Display > 300 sq ft trigger" : "Not triggered",
      amount: money(backupProcessor),
    },
    {
      id: "BUNDLE-WEATHER",
      group: "bundles",
      label: "Weatherproof Enclosure Surcharge",
      formula: classification.isOutdoor ? `${ANC_BUNDLE_RATES.outdoorWeatherproofPerSqFt} * ${money(totalSqFt)}` : "Not triggered",
      amount: money(weatherproof),
    },
    {
      id: "FEE-PM",
      group: "flat_fees",
      label: "Project Management",
      formula: "Flat Fee",
      amount: money(projectManagement),
    },
    {
      id: "FEE-ENG",
      group: "flat_fees",
      label: "Engineering Stamped Drawings",
      formula: "Flat Allowance",
      amount: money(stampedDrawings),
    },
    {
      id: "PRICE-TOTAL",
      group: "pricing",
      label: "Total Cost",
      formula: "Sum of all internal costs",
      amount: money(totalCost),
    },
    {
      id: "PRICE-SELL",
      group: "pricing",
      label: "Selling Price",
      formula: `${money(totalCost)} / (1 - 0.15)`,
      amount: money(sellingPrice),
    },
    {
      id: "PRICE-TAX",
      group: "pricing",
      label: "Tax",
      formula: `${money(sellingPrice)} * ${taxRate.toFixed(4)}`,
      amount: money(taxAmount),
    },
    {
      id: "PRICE-BOND",
      group: "pricing",
      label: "Bond",
      formula: `${money(sellingPrice)} * ${bondRate.toFixed(4)}`,
      amount: money(bondAmount),
    },
    {
      id: "PRICE-BID",
      group: "pricing",
      label: "Bid Form Subtotal",
      formula: `Selling Price + Tax + Bond`,
      amount: money(bidFormSubtotal),
    },
  ];

  return {
    project: {
      projectTitle: (input.projectTitle || "ANC Estimate").trim(),
      clientName: (input.clientName || "Unknown Client").trim(),
      venueName: (input.venueName || "Unknown Venue").trim(),
      generatedAt: new Date().toISOString(),
    },
    assumptions,
    display: {
      profile: classification.profile,
      label: classification.label,
      product: classification.product,
      quantity,
      totalSqFt: money(totalSqFt),
      vendorRatePerSqFt: vendorRate,
      structuralRatePerSqFt: classification.structuralRatePerSqFt,
    },
    lineItems,
    totals: {
      totalCost: money(totalCost),
      sellingPrice: money(sellingPrice),
      taxRate: Number(taxRate.toFixed(6)),
      taxAmount: money(taxAmount),
      bondRate: Number(bondRate.toFixed(6)),
      bondAmount: money(bondAmount),
      bidFormSubtotal: money(bidFormSubtotal),
      grossMarginDollars: money(grossMarginDollars),
      grossMarginPercent: money((grossMarginDollars / sellingPrice) * 100),
    },
  };
}

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ancEstimateToReportText(result: AncEstimateResult): string {
  const lines: string[] = [];
  lines.push(`# ${result.project.projectTitle}`);
  lines.push(`Client: ${result.project.clientName}`);
  lines.push(`Venue: ${result.project.venueName}`);
  lines.push(`Generated: ${result.project.generatedAt}`);
  lines.push("");
  lines.push("Display Assumptions");
  lines.push(`- Profile: ${result.display.label}`);
  lines.push(`- Product: ${result.display.product}`);
  lines.push(`- Quantity: ${result.display.quantity}`);
  lines.push(`- Total SqFt: ${result.display.totalSqFt}`);
  lines.push("");
  lines.push("Line Items");
  for (const item of result.lineItems) {
    lines.push(`- ${item.label}: ${formatMoney(item.amount)} (${item.formula})`);
  }
  lines.push("");
  lines.push("Totals");
  lines.push(`- Total Cost: ${formatMoney(result.totals.totalCost)}`);
  lines.push(`- Selling Price: ${formatMoney(result.totals.sellingPrice)}`);
  lines.push(`- Tax (${(result.totals.taxRate * 100).toFixed(2)}%): ${formatMoney(result.totals.taxAmount)}`);
  lines.push(`- Bond (${(result.totals.bondRate * 100).toFixed(2)}%): ${formatMoney(result.totals.bondAmount)}`);
  lines.push(`- Bid Form Subtotal: ${formatMoney(result.totals.bidFormSubtotal)}`);
  lines.push(`- Gross Margin: ${formatMoney(result.totals.grossMarginDollars)} (${result.totals.grossMarginPercent.toFixed(2)}%)`);
  lines.push("");
  lines.push("Assumptions");
  for (const assumption of result.assumptions) {
    lines.push(`- ${assumption}`);
  }
  return lines.join("\n");
}
