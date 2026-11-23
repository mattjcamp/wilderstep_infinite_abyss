/**
 * Shared "touch UI is on" flag. Set by the /play host's `useTouchUi`
 * hook; read by Phaser scenes (CombatScene) that can't use React
 * hooks. False by default, so desktop behaviour is unchanged unless
 * the touch UI is active (touch device, or `?touch=1`).
 */
let active = false;

export function setTouchUiActive(on: boolean): void {
  active = on;
}

export function isTouchUiActive(): boolean {
  return active;
}
