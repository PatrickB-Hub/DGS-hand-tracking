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

/** Startet Kamera und Handerkennung. Liefert eine Funktion, die pro Frame die aktuelle Hand zurückgibt. */
// ponytail: Erkennung läuft im Main-Thread; in einen Web Worker verschieben, falls die UI-FPS leiden.
export async function startTracking(video: HTMLVideoElement): Promise<() => Hand | null> {
  video.srcObject = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, facingMode: 'user' },
    audio: false,
  })
  await video.play()
  const landmarker = await createLandmarker('GPU').catch(() => createLandmarker('CPU'))

  // Wird pro neuem Kamerabild aufgerufen (requestVideoFrameCallback), daher immer frische Daten.
  return () => {
    const r = landmarker.detectForVideo(video, performance.now())
    return r.landmarks.length
      ? {
          image: r.landmarks[0],
          world: r.worldLandmarks[0],
          // MediaPipe nimmt ein gespiegeltes Selfie-Bild an; unser Kamerabild ist ungespiegelt, also umgekehrt.
          isLeft: r.handedness[0][0].categoryName === 'Right',
        }
      : null
  }
}
