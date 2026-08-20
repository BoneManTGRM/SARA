/** Repair yield per energy. Yield is constraint hold rate; energy is tokens (or 1 for local). */
export function rye(yieldScore: number, energy: number): number {
  const y = Math.max(0, Math.min(1, yieldScore));
  const e = Math.max(energy, 1);
  return y / e;
}

export function formatRye(value: number, energy: number): string {
  if (energy <= 1) return value.toFixed(2);
  return (value * 1000).toFixed(2);
}
