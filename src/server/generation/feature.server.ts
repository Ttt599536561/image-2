export function isCustomKeyModesEnabled(): boolean {
  return process.env.CUSTOM_KEY_MODES_ENABLED === "true";
}
