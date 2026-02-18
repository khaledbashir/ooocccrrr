import * as XLSX from "xlsx";
import { AncEstimateResult } from "@/lib/estimatorEngine";

const CURRENCY_FORMAT = "$#,##0.00";
const PERCENT_FORMAT = "0.00%";

function setSheetLayout(sheet: XLSX.WorkSheet, colWidths: number[], headerRow = 0) {
  sheet["!cols"] = colWidths.map((width) => ({ wch: width }));
  const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
  if (range) {
    sheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: headerRow, c: 0 },
        e: { r: headerRow, c: range.e.c },
      }),
    };
    sheet["!freeze"] = { xSplit: 0, ySplit: headerRow + 1 };
  }
}

function setColumnNumberFormat(sheet: XLSX.WorkSheet, columnIndex: number, format: string, startRow = 1) {
  const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
  if (!range) return;
  for (let row = startRow; row <= range.e.r; row += 1) {
    const cellAddress = XLSX.utils.encode_cell({ r: row, c: columnIndex });
    const cell = sheet[cellAddress];
    if (!cell || (cell.t !== "n" && cell.t !== "d")) continue;
    cell.z = format;
  }
}

function sheetFromAoa(rows: Array<Array<string | number>>) {
  return XLSX.utils.aoa_to_sheet(rows);
}

export function buildEstimatorWorkbook(result: AncEstimateResult) {
  const workbook = XLSX.utils.book_new();

  const summaryRows: Array<Array<string | number>> = [
    ["ANC Estimator Dashboard", "", "", ""],
    ["Project", result.project.projectTitle, "Generated", result.project.generatedAt],
    ["Client", result.project.clientName, "Venue", result.project.venueName],
    ["Display Profile", result.display.label, "Product", result.display.product],
    ["Quantity", result.display.quantity, "Total SqFt", result.display.totalSqFt],
    ["", "", "", ""],
    ["Financial KPI", "Value", "Financial KPI", "Value"],
    ["Total Cost", result.totals.totalCost, "Selling Price", result.totals.sellingPrice],
    ["Gross Margin $", result.totals.grossMarginDollars, "Gross Margin %", result.totals.grossMarginPercent / 100],
    ["Tax Rate", result.totals.taxRate, "Tax Amount", result.totals.taxAmount],
    ["Bond Rate", result.totals.bondRate, "Bond Amount", result.totals.bondAmount],
    ["Bid Form Subtotal", result.totals.bidFormSubtotal, "Alternate Adjustments", result.totals.alternateAdjustmentTotal],
    ["Adjusted Bid Subtotal", result.totals.adjustedBidFormSubtotal, "", ""],
  ];
  const summarySheet = sheetFromAoa(summaryRows);
  summarySheet["!merges"] = [
    XLSX.utils.decode_range("A1:D1"),
  ];
  setSheetLayout(summarySheet, [26, 26, 20, 30], 6);
  setColumnNumberFormat(summarySheet, 1, CURRENCY_FORMAT, 7);
  setColumnNumberFormat(summarySheet, 3, CURRENCY_FORMAT, 7);
  const gmPct = summarySheet["D9"];
  if (gmPct) gmPct.z = PERCENT_FORMAT;
  const taxRate = summarySheet["B10"];
  if (taxRate) taxRate.z = PERCENT_FORMAT;
  const bondRate = summarySheet["B11"];
  if (bondRate) bondRate.z = PERCENT_FORMAT;
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary Dashboard");

  const takeoffRows: Array<Array<string | number>> = [
    ["Display", "Location", "Qty", "SqFt", "Profile", "Product"],
    ...result.displayBreakdown.map((item) => [
      item.name,
      item.location,
      item.quantity,
      item.sqFt,
      item.profile,
      item.product,
    ]),
  ];
  const takeoffSheet = sheetFromAoa(takeoffRows);
  setSheetLayout(takeoffSheet, [34, 20, 8, 10, 18, 32]);
  XLSX.utils.book_append_sheet(workbook, takeoffSheet, "Display Takeoff");

  const costRows: Array<Array<string | number>> = [
    ["ID", "Group", "Item", "Formula", "Amount"],
    ...result.lineItems.map((item) => [item.id, item.group, item.label, item.formula, item.amount]),
  ];
  const costSheet = sheetFromAoa(costRows);
  setSheetLayout(costSheet, [12, 14, 38, 44, 16]);
  setColumnNumberFormat(costSheet, 4, CURRENCY_FORMAT);
  XLSX.utils.book_append_sheet(workbook, costSheet, "Cost Build");

  const marginRows: Array<Array<string | number>> = [
    ["Line", "Cost", "Selling Price", "Margin $", "Margin %"],
    [
      "Project Totals",
      result.totals.totalCost,
      result.totals.sellingPrice,
      result.totals.grossMarginDollars,
      result.totals.grossMarginPercent / 100,
    ],
    ["Tax", 0, result.totals.taxAmount, result.totals.taxAmount, 0],
    ["Bond", 0, result.totals.bondAmount, result.totals.bondAmount, 0],
    ["Bid Form Subtotal", result.totals.totalCost, result.totals.bidFormSubtotal, result.totals.bidFormSubtotal - result.totals.totalCost, (result.totals.bidFormSubtotal - result.totals.totalCost) / result.totals.bidFormSubtotal],
  ];
  const marginSheet = sheetFromAoa(marginRows);
  setSheetLayout(marginSheet, [30, 16, 16, 16, 12]);
  setColumnNumberFormat(marginSheet, 1, CURRENCY_FORMAT);
  setColumnNumberFormat(marginSheet, 2, CURRENCY_FORMAT);
  setColumnNumberFormat(marginSheet, 3, CURRENCY_FORMAT);
  setColumnNumberFormat(marginSheet, 4, PERCENT_FORMAT);
  XLSX.utils.book_append_sheet(workbook, marginSheet, "Margin Analysis");

  const bidRows: Array<Array<string | number>> = [
    ["Bid Form Item", "Amount"],
    ["Selling Price", result.totals.sellingPrice],
    [`Tax (${(result.totals.taxRate * 100).toFixed(2)}%)`, result.totals.taxAmount],
    [`Bond (${(result.totals.bondRate * 100).toFixed(2)}%)`, result.totals.bondAmount],
    ["SUB TOTAL (BID FORM)", result.totals.bidFormSubtotal],
    ["Alternate Adjustments", result.totals.alternateAdjustmentTotal],
    ["ADJUSTED SUB TOTAL", result.totals.adjustedBidFormSubtotal],
  ];
  const bidSheet = sheetFromAoa(bidRows);
  setSheetLayout(bidSheet, [34, 18]);
  setColumnNumberFormat(bidSheet, 1, CURRENCY_FORMAT);
  XLSX.utils.book_append_sheet(workbook, bidSheet, "Bid Form");

  const bidByDisplayRows: Array<Array<string | number>> = [
    ["Display / Scope", "Cost", "Selling Price", "Margin $", "Margin %"],
    ...result.displayBreakdown.map((item) => [
      `${item.name} (${item.sqFt} SqFt)`,
      item.totalCost,
      item.sellingPrice,
      item.marginDollars,
      item.marginPercent / 100,
    ]),
    ["Tax", 0, result.totals.taxAmount, result.totals.taxAmount, 0],
    ["Bond", 0, result.totals.bondAmount, result.totals.bondAmount, 0],
    ["Bid Form Subtotal", result.totals.totalCost, result.totals.bidFormSubtotal, result.totals.bidFormSubtotal - result.totals.totalCost, (result.totals.bidFormSubtotal - result.totals.totalCost) / Math.max(result.totals.bidFormSubtotal, 1)],
  ];
  if (result.alternates.length > 0) {
    for (const alternate of result.alternates) {
      bidByDisplayRows.push([`Alternate: ${alternate.label}`, 0, alternate.amount, alternate.amount, 0]);
    }
    bidByDisplayRows.push(["Adjusted Bid Subtotal", result.totals.totalCost, result.totals.adjustedBidFormSubtotal, result.totals.adjustedBidFormSubtotal - result.totals.totalCost, (result.totals.adjustedBidFormSubtotal - result.totals.totalCost) / Math.max(result.totals.adjustedBidFormSubtotal, 1)]);
  }
  const bidByDisplaySheet = sheetFromAoa(bidByDisplayRows);
  setSheetLayout(bidByDisplaySheet, [38, 16, 16, 16, 12]);
  setColumnNumberFormat(bidByDisplaySheet, 1, CURRENCY_FORMAT);
  setColumnNumberFormat(bidByDisplaySheet, 2, CURRENCY_FORMAT);
  setColumnNumberFormat(bidByDisplaySheet, 3, CURRENCY_FORMAT);
  setColumnNumberFormat(bidByDisplaySheet, 4, PERCENT_FORMAT);
  XLSX.utils.book_append_sheet(workbook, bidByDisplaySheet, "Bid Form By Display");

  const alternateRows: Array<Array<string | number>> = [
    ["Alternate", "Adjustment Amount"],
    ...result.alternates.map((item) => [item.label, item.amount]),
    ["Total Alternate Adjustment", result.totals.alternateAdjustmentTotal],
  ];
  const alternateSheet = sheetFromAoa(alternateRows);
  setSheetLayout(alternateSheet, [48, 18]);
  setColumnNumberFormat(alternateSheet, 1, CURRENCY_FORMAT);
  XLSX.utils.book_append_sheet(workbook, alternateSheet, "Alternates");

  const assumptionsRows: Array<Array<string | number>> = [
    ["Assumption / QA Check", "Status", "Estimator Notes"],
    ...result.assumptions.map((assumption) => [assumption, "Review", ""]),
    ["Verify dimensions against drawing details", "Required", ""],
    ["Confirm tax and bond rates with bid form", "Required", ""],
    ["Confirm alternates and deducts", "Required", ""],
    ["Confirm freight and logistics scope", "Required", ""],
  ];
  const assumptionsSheet = sheetFromAoa(assumptionsRows);
  setSheetLayout(assumptionsSheet, [56, 16, 34]);
  XLSX.utils.book_append_sheet(workbook, assumptionsSheet, "Assumptions_QA");

  const ratesRows: Array<Array<string | number>> = [
    ["Rate Type", "Value", "Source"],
    ["Outdoor 10mm (Marquee)", 105, "Yaham Rate Card"],
    ["Outdoor 4mm (High Res)", 158, "Yaham Rate Card"],
    ["Indoor 2.5mm (Lobby)", 200, "Yaham Rate Card"],
    ["Indoor 4mm (Standard)", 120, "Yaham Rate Card"],
    ["Install Labor / SqFt", 290, "Budget Rate"],
    ["Electrical / SqFt", 145, "Budget Rate"],
    ["Structural Wall / SqFt", 30, "Budget Rate"],
    ["Structural Ceiling / SqFt", 60, "Budget Rate"],
    ["Project Management", 10500, "Budget Rate"],
    ["Engineering Stamped Drawings", 20000, "Budget Rate"],
    ["Margin Target", 0.15, "ANC Logic"],
  ];
  const ratesSheet = sheetFromAoa(ratesRows);
  setSheetLayout(ratesSheet, [34, 16, 26]);
  setColumnNumberFormat(ratesSheet, 1, CURRENCY_FORMAT);
  const marginTargetCell = ratesSheet["B12"];
  if (marginTargetCell) marginTargetCell.z = PERCENT_FORMAT;
  XLSX.utils.book_append_sheet(workbook, ratesSheet, "Rate Card");

  const bundleRows: Array<Array<string | number>> = [
    ["Trigger", "Bundle Item", "Rule", "Applied Amount"],
    ["All displays", "Sending Card", "$450 per display", result.lineItems.find((item) => item.id === "BUNDLE-SEND")?.amount || 0],
    ["All displays", "Spare Parts", "2% of LED hardware", result.lineItems.find((item) => item.id === "BUNDLE-SPARES")?.amount || 0],
    ["All displays", "Signal Cable Kit", "$15 * (SqFt / 25)", result.lineItems.find((item) => item.id === "BUNDLE-CABLE")?.amount || 0],
    ["Scoreboard / Center Hung", "UPS Battery Backup", "$2,500", result.lineItems.find((item) => item.id === "BUNDLE-UPS")?.amount || 0],
    ["Display > 300 SqFt", "Backup Video Processor", "$12,000", result.lineItems.find((item) => item.id === "BUNDLE-PROC")?.amount || 0],
    ["Outdoor", "Weatherproof Surcharge", "$12 / SqFt", result.lineItems.find((item) => item.id === "BUNDLE-WEATHER")?.amount || 0],
  ];
  const bundleSheet = sheetFromAoa(bundleRows);
  setSheetLayout(bundleSheet, [28, 28, 28, 18]);
  setColumnNumberFormat(bundleSheet, 3, CURRENCY_FORMAT);
  XLSX.utils.book_append_sheet(workbook, bundleSheet, "Bundle Logic");

  const sourceRows: Array<Array<string | number>> = [
    ["Source", "Why it matters"],
    ["Margin_Analysis sheet pattern", "Estimator expects Cost/Sell/Margin view and bid subtotal"],
    ["LED_Cost_Sheet structure", "Estimator expects quantity, sq ft, vendor, service, shipping, and margin columns"],
    ["Jacksonville spec sheet PDF", "Estimator needs structured performance standard inputs and drawing-linked checks"],
  ];
  const sourceSheet = sheetFromAoa(sourceRows);
  setSheetLayout(sourceSheet, [36, 72]);
  XLSX.utils.book_append_sheet(workbook, sourceSheet, "Source Log");

  return workbook;
}
