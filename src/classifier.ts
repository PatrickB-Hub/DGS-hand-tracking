import { FINGERS, fingerDistance, handDistance } from './features.ts'

// Statische Buchstaben. J, Z, Ä, Ö, Ü, ß und SCH enthalten Bewegung -> Phase 2 (siehe README).
export const LETTERS = 'ABCDEFGHIKLMNOPQRSTUVWXY'.split('')

export type Sample = { letter: string; person: string; features: number[] }
export type Template = { mean: number[]; tol: number[] }

// ponytail: feste Mindesttoleranz (Einheit: Handgelenk->Mittelfinger-Grundgelenk = 1).
// Mit Daten mehrerer Personen per Leave-one-person-out nachjustieren.
export const MIN_TOL = 0.2

// Anteil der Samples, die in die Schablone eingehen. Der Rest (am weitesten vom Mittel entfernt) sind meist
// Übergänge in die Handform hinein oder aus ihr heraus und würden Mittelwert und Toleranz verwässern.
export const KEEP = 0.75

const mean = (fs: number[][]) => fs[0].map((_, i) => fs.reduce((sum, f) => sum + f[i], 0) / fs.length)

/** Schablone pro Buchstabe: robuster Mittelwert der Samples plus Toleranz pro Finger aus deren Streuung. */
export function buildTemplates(samples: Sample[]): Map<string, Template> {
  const templates = new Map<string, Template>()
  for (const [letter, group] of Map.groupBy(samples, (s) => s.letter)) {
    let core = group.map((s) => s.features)
    let m = mean(core)
    for (let i = 0; i < 3; i++) {
      // iterativ, weil Ausreißer im ersten Durchgang auch das Mittel verschieben
      core = group
        .map((s) => s.features)
        .sort((a, b) => handDistance(a, m) - handDistance(b, m))
        .slice(0, Math.max(1, Math.floor(group.length * KEEP)))
      m = mean(core)
    }
    const tol = FINGERS.map((_, f) => {
      const spread = core.reduce((sum, c) => sum + fingerDistance(c, m, f), 0) / core.length
      return Math.max(MIN_TOL, 2 * spread)
    })
    templates.set(letter, { mean: m, tol })
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
    const d = handDistance(features, t.mean)
    if (d < bestDist) [best, bestDist] = [letter, d]
  }
  return best
}
