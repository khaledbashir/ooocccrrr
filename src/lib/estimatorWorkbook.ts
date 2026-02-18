import * as XLSX from "xlsx";
import { AncEstimateResult } from "@/lib/estimatorEngine";

function money(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildEstimatorWorkbook(result: AncEstimateResult) {
  const workbook = XLSX.utils.book_new();

  const appendSheet = (name: string, headers: string[], rows: Array<Array<string | number>>) => {
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  };

  appendSheet("Summary", ["Field", "Value"], [
    ["Project Title", result.project.projectTitle],
    ["Client", result.project.clientName],
    ["Venue", result.project.venueName],
    ["Generated At", result.project.generatedAt],
    ["Display Profile", result.display.label],
    ["Product", result.display.product],
    ["Quantity", result.display.quantity],
    ["Total SqFt", result.display.totalSqFt],
    ["Total Cost", money(result.totals.totalCost)],
    ["Selling Price", money(result.totals.sellingPrice)],
    ["Gross Margin $", money(result.totals.grossMarginDollars)],
    ["Gross Margin %", `${result.totals.grossMarginPercent.toFixed(2)}%`],
  ]);

  appendSheet(
    "Assumptions",
    ["Assumption"],
    result.assumptions.map((line) => [line]),
  );

  appendSheet(
    "Line Items",
    ["ID", "Group", "Item", "Formula", "Amount"],
    result.lineItems.map((item) => [item.id, item.group, item.label, item.formula, item.amount]),
  );

  appendSheet(
    "Hardware",
    ["Item", "Amount"],
    result.lineItems
      .filter((item) => item.group === "hardware")
      .map((item) => [item.label, item.amount]),
  );

  appendSheet(
    "Labor",
    ["Item", "Amount"],
    result.lineItems
      .filter((item) => item.group === "labor")
      .map((item) => [item.label, item.amount]),
  );

  appendSheet(
    "Bundles",
    ["Item", "Amount"],
    result.lineItems
      .filter((item) => item.group === "bundles")
      .map((item) => [item.label, item.amount]),
  );

  appendSheet(
    "Flat Fees",
    ["Item", "Amount"],
    result.lineItems
      .filter((item) => item.group === "flat_fees")
      .map((item) => [item.label, item.amount]),
  );

  appendSheet("Pricing", ["Metric", "Value"], [
    ["Total Cost", result.totals.totalCost],
    ["Selling Price", result.totals.sellingPrice],
    ["Gross Margin $", result.totals.grossMarginDollars],
    ["Gross Margin %", result.totals.grossMarginPercent],
  ]);

  appendSheet("Source Citations", ["Source", "Value"], [
    ["Vendor Rate Card: Outdoor 10mm", 105],
    ["Vendor Rate Card: Outdoor 4mm", 158],
    ["Vendor Rate Card: Indoor 2.5mm", 200],
    ["Vendor Rate Card: Indoor 4mm", 120],
    ["Budget Rate: Install Labor", 290],
    ["Budget Rate: Electrical", 145],
    ["Budget Flat: Project Management", 10500],
    ["Budget Flat: Engineering Stamped Drawings", 20000],
  ]);

  return workbook;
}

