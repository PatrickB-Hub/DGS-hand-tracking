# DGS-Fingeralphabet

Trainer für das Fingeralphabet der Deutschen Gebärdensprache (DGS), komplett im Browser. Die Webcam erkennt die
Handform, eine Schablone zeigt pro Finger, was stimmt und was nicht. Das Kamerabild verlässt den Browser nicht.

> Ergänzt einen DGS-Kurs, ersetzt ihn nicht.

```sh
npm install
npm run dev      # lokaler Dev-Server (Kamera braucht localhost oder HTTPS)
npm test         # Tests für Normalisierung und Klassifikator
npm run build    # Typecheck + Production-Build nach dist/
```

## Modi

- **Erkennen**: Buchstaben zeigen und halten, die Seite erkennt und buchstabiert mit.
- **Üben**: Buchstabe oder Wort vorgeben, die gestrichelte Geisterhand zeigt die Zielform, jeder Finger wird grün/rot.
  Fortschritt pro Buchstabe in `localStorage`.
- **Aufnehmen**: Landmark-Daten pro Person und Buchstabe aufnehmen, als JSON exportieren (→ `data/raw/`).

Alle Modi funktionieren auch mit einer Videodatei statt der Kamera („Videodatei laden“), z. B. um Referenzvideos
auszuwerten. Aufgenommen werden nur Frames mit ruhiger Hand: Bewegung vor dem Halten wird übersprungen, Bewegung danach beendet
den Durchgang (ebenso Pausieren oder Videoende). Beim Bau der Schablone werden zusätzlich die 25 % der Frames
verworfen, die am weitesten vom Mittel entfernt sind.

## Aufbau

| Datei               | Aufgabe                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| `src/tracking.ts`   | Kamera + MediaPipe HandLandmarker (WASM und Modell selbst gehostet)                   |
| `src/features.ts`   | Normalisierung: Verschiebung, Skalierung, Spiegelung für Linkshänder; Rotation bleibt |
| `src/classifier.ts` | Schablonen (Mittelwert + Toleranz pro Finger) und Nearest-Template-Erkennung          |
| `src/render.ts`     | Handskelett und Geisterhand auf dem Canvas                                            |
| `src/main.ts`       | UI, Modi, Persistenz                                                                  |

Schablone und Erkennung bauen auf denselben aufgenommenen Daten auf.

## Roadmap

1. **Kern** ✅ Tracking, Normalisierung, Aufnahme, Schablone, Erkennen/Üben, FPS-Anzeige.
2. **Referenzdaten**: Handformen mit einer verlässlichen DGS-Quelle abgleichen, eigene Aufnahmen; idealerweise einmal
   von einer DGS-kompetenten Person prüfen lassen. Freunde nehmen Daten auf.
3. **ML-Pipeline**: Python-Notebook (Normalisierung prüfen, Training, Leave-one-person-out-Evaluation,
   Konfusionsmatrix mit Begründung). Export eines kleinen Modells in den Browser, Vergleich mit der
   Nearest-Template-Baseline.
4. **Lernwerkzeug**: Buchstabier-Quiz, ausgebauter Lernfortschritt, Deployment auf eigener Subdomain.
5. **Phase 2: dynamische Gebärden**: J, Z, Ä, Ö, Ü, ß, SCH und später Wortgebärden. Brauchen Sequenzen statt
   Einzelbildern (z. B. Landmark-Zeitreihen mit einem kleinen GRU/1D-CNN).

## Bekannte Grenzen

- Nur statische Handformen; Buchstaben mit Bewegung sind ausgeklammert (siehe Phase 2).
- Die Mindesttoleranz der Schablone (`MIN_TOL`) ist ein Startwert und wird mit Daten mehrerer Personen kalibriert.
- Die Geisterhand ist eine 2D-Projektion der normalisierten 3D-Daten und bei stark gedrehter Hand nur eine Näherung.
