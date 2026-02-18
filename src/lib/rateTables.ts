export const ANC_VENDOR_RATES = {
  outdoor10mmMarquee: 105,
  outdoor4mmHighRes: 158,
  indoor25mmLobby: 200,
  indoor4mmStandard: 120,
} as const;

export const ANC_BUDGET_RATES = {
  installLaborPerSqFt: 290,
  electricalPerSqFt: 145,
  structuralWallPerSqFt: 30,
  structuralCeilingPerSqFt: 60,
  projectManagementFlat: 10500,
  engineeringStampedDrawingsFlat: 20000,
  marginTarget: 0.15,
  dutyMultiplier: 1.1,
  sparesMultiplier: 1.03,
} as const;

export const ANC_BUNDLE_RATES = {
  sendingCardPerDisplay: 450,
  sparePartsRate: 0.02,
  signalCableKitPer25SqFt: 15,
  upsBatteryBackup: 2500,
  backupVideoProcessor: 12000,
  outdoorWeatherproofPerSqFt: 12,
} as const;

