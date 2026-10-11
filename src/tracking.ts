import { HandLandmarker } from '@mediapipe/tasks-vision'
// WASM und Modell werden selbst ausgeliefert: keine Anfrage an Google-Server, das Kamerabild bleibt im Browser.
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import type { Point } from './features.ts'

export type Hand = { image: Point[]; world: Point[]; isLeft: boolean }

async function createLandmarker(delegate: 'GPU' | 'CPU') {
  return HandLandmarker.createFromOptions(
    { wasmLoaderPath, wasmBinaryPath },
    {
      baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}hand_landmarker.task`, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
    },
  )
}

export async function startCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: 'user' }, audio: false })
}

/**
 * Lädt die Handerkennung für ein Video-Element (Kamera oder Videodatei).
 * Die zurückgegebene Funktion wird pro neuem Bild aufgerufen (requestVideoFrameCallback).
 */
// ponytail: Erkennung läuft im Main-Thread; in einen Web Worker verschieben, falls die UI-FPS leiden.
export async function createDetector(video: HTMLVideoElement): Promise<() => Hand | null> {
  const landmarker = await createLandmarker('GPU').catch(() => createLandmarker('CPU'))
  return () => {
    const r = landmarker.detectForVideo(video, performance.now())
    return r.landmarks.length
      ? {
          image: r.landmarks[0],
          world: r.worldLandmarks[0],
          // MediaPipe nimmt ein gespiegeltes Selfie-Bild an; unser Kamerabild ist ungespiegelt, also umgekehrt.
          // Bei gespiegelten Videodateien kippt nur die Händigkeit; die normalisierten Features bleiben gleich.
          isLeft: r.handedness[0][0].categoryName === 'Right',
        }
      : null
  }
}
