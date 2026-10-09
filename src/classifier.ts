import { FINGERS, fingerDistance } from './features.ts'

// Statische Buchstaben. J, Z, Ä, Ö, Ü, ß und SCH enthalten Bewegung -> Phase 2 (siehe README).
export const LETTERS = 'ABCDEFGHIKLMNOPQRSTUVWXY'.split('')

export type Sample = { letter: string; person: string; features: number[] }
export type Template = { mean: number[]; tol: number[] }

// ponytail: feste Mindesttoleranz (Einheit: Handgelenk->Mittelfinger-Grundgelenk = 1).
// Mit Daten mehrerer Personen per Leave-one-person-out nachjustieren.
export const MIN_TOL = 0.2

/** Schablone pro Buchstabe: Mittelwert der Samples plus Toleranz pro Finger aus deren Streuung. */
export function buildTemplates(samples: Sample[]): Map<string, Template> {
  const groups = Map.groupBy(samples, (s) => s.letter)
  const templates = new Map<string, Template>()
  for (const [letter, group] of groups) {
    const mean = group[0].features.map((_, i) => group.reduce((sum, s) => sum + s.features[i], 0) / group.length)
    const tol = FINGERS.map((_, f) => {
      const spread = group.reduce((sum, s) => sum + fingerDistance(s.features, mean, f), 0) / group.length
      return Math.max(MIN_TOL, 2 * spread)
    })
    templates.set(letter, { mean, tol })
  }
  return templates
}

/** Pro Finger: liegt er innerhalb der Toleranz der Schablone? */
export function fingerCheck(features: number[], t: Template): boolean[] {
  return FINGERS.map((_, f) => fingerDistance(features, t.mean, f) <= t.tol[f])
}

/** Nächste Schablone (Summe der Fingerabstände). Erst mit fingerCheck wird daraus ein „erkannt“. */
export function classify(features: number[], templates: Map<string, Template>): string | null {
  let best: string | null = null
  let bestDist = Infinity
  for (const [letter, t] of templates) {
    const d = FINGERS.reduce((sum, _, f) => sum + fingerDistance(features, t.mean, f), 0)
    if (d < bestDist) [best, bestDist] = [letter, d]
  }
  return best
}
