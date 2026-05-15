// Stubbed for v2 battle-sim port. The full save/load helpers aren't
// needed during combat. Keep only the type stub `state.ts` imports.
export interface LastSceneSnapshot {
  scene: string;
  data?: Record<string, unknown>;
}
