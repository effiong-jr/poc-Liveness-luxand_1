"use client";

import { useRef, useState, useCallback } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const API_TOKEN = process.env.NEXT_PUBLIC_LUXAND_API_TOKEN ?? "";

interface LivenessResult {
  result?: string;
  confidence?: number;
  message?: string;
  [key: string]: unknown;
}

function FaceGuideOverlay() {
  return (
    <div className="absolute inset-0 flex flex-col items-start justify-start pointer-events-none select-none">
      <p className="mt-4 ml-auto mr-auto rounded-full bg-black/50 px-4 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
        Position your face in the oval
      </p>
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 100 133"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <mask id="face-cutout">
            <rect width="100" height="133" fill="white" />
            <ellipse cx="50" cy="60" rx="38" ry="50" fill="black" />
          </mask>
        </defs>
        <rect width="100" height="133" fill="rgba(0,0,0,0.45)" mask="url(#face-cutout)" />
        <ellipse cx="50" cy="60" rx="38" ry="50" fill="none" stroke="white" strokeWidth="0.8" strokeDasharray="4 2" />
      </svg>
    </div>
  );
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// Lazy FaceLandmarker singleton (loads ~5 MB model once, cached for session)
let faceLandmarkerPromise: Promise<FaceLandmarker> | null = null;

function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    ).then(vision =>
      FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      })
    );
  }
  return faceLandmarkerPromise;
}

type ChallengeType = "blink" | "smile" | "raise_eyebrows";

interface ChallengeItem {
  type: ChallengeType;
  label: string;
  instruction: string;
}

const CHALLENGES: ChallengeItem[] = [
  { type: "blink",      label: "Blink",      instruction: "Blink both eyes" },
  { type: "smile",      label: "Smile",      instruction: "Give a big smile" },
  { type: "raise_eyebrows", label: "Raise eyebrows", instruction: "Raise your eyebrows" },
];

function isChallengeComplete(
  categories: { categoryName: string; score: number }[],
  type: ChallengeType
): boolean {
  const get = (name: string) =>
    categories.find((c) => c.categoryName === name)?.score ?? 0;
  switch (type) {
    case "blink":
      return get("eyeBlinkLeft") > 0.4 && get("eyeBlinkRight") > 0.4;
    case "smile":
      return get("mouthSmileLeft") > 0.4 && get("mouthSmileRight") > 0.4;
    case "raise_eyebrows":
      return get("browInnerUp") > 0.5;
  }
}

async function waitForNeutralFace(
  video: HTMLVideoElement,
  landmarker: FaceLandmarker,
  abortSignal: { aborted: boolean },
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !abortSignal.aborted) {
    const result = landmarker.detectForVideo(video, Date.now());
    const categories = result.faceBlendshapes?.[0]?.categories ?? [];
    const get = (name: string) =>
      categories.find((c) => c.categoryName === name)?.score ?? 1;
    if (
      get("eyeBlinkLeft") < 0.2 &&
      get("eyeBlinkRight") < 0.2 &&
      get("jawOpen") < 0.3 &&
      get("mouthSmileLeft") < 0.3 &&
      get("mouthSmileRight") < 0.3
    ) return;
    await delay(50);
  }
  // timeout or aborted — proceed anyway
}

async function waitForChallenge(
  video: HTMLVideoElement,
  landmarker: FaceLandmarker,
  type: ChallengeType,
  abortSignal: { aborted: boolean },
  timeoutMs = 10_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !abortSignal.aborted) {
    const result = landmarker.detectForVideo(video, Date.now());
    const categories = result.faceBlendshapes?.[0]?.categories ?? [];
    if (isChallengeComplete(categories, type)) return true;
    await delay(100);
  }
  return false;
}

function liveness(image: Blob, callback: (result: LivenessResult) => void) {
  const myHeaders = new Headers();
  myHeaders.append("token", API_TOKEN);

  const formdata = new FormData();
  formdata.append("photo", image, "file");

  const requestOptions: RequestInit = {
    method: "POST",
    headers: myHeaders,
    body: formdata,
    redirect: "follow",
  };

  fetch("https://api.luxand.cloud/photo/liveness", requestOptions)
    .then((response) => response.json())
    .then((result) => callback(result))
    .catch((error) => console.log("error", error));
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });

  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LivenessResult | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [activeChallenge, setActiveChallenge] = useState<ChallengeItem | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 480 },
          height: { ideal: 640 },
          facingMode: "user",
          frameRate: { ideal: 30 },
        },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setStreaming(true);
      }
    } catch (err) {
      console.error("Camera access denied:", err);
    }
  }, []);

  const stopCamera = useCallback(() => {
    abortRef.current.aborted = true;
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach((t) => t.stop());
      videoRef.current.srcObject = null;
      setStreaming(false);
    }
  }, []);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    setResult(null);
    setChallengeError(null);
    setLoading(true);

    // Step 1 — pick a random challenge and display it
    const challengeItem = CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)];
    setActiveChallenge(challengeItem);

    // Step 2 — load MediaPipe model (cached after first call)
    const landmarker = await getFaceLandmarker();

    // Step 3 — wait for user to complete the challenge (10s timeout)
    abortRef.current = { aborted: false };
    const passed = await waitForChallenge(video, landmarker, challengeItem.type, abortRef.current);
    setActiveChallenge(null);

    if (!passed) {
      setChallengeError(
        abortRef.current.aborted
          ? "Cancelled."
          : "Challenge timed out — please try again."
      );
      setLoading(false);
      return;
    }

    // Step 4 — quality gate: wait for neutral face before capturing
    await waitForNeutralFace(video, landmarker, abortRef.current);

    // Step 5 — capture the frame with eyes open
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg");
    setCapturedImage(dataUrl);
    console.log("Captured image (data URL):", dataUrl); // placeholder for DB save

    // Step 6 — send to Luxand passive liveness for second-layer validation
    canvas.toBlob((blob) => {
      if (!blob) { setLoading(false); return; }
      console.log("Sending image to Luxand liveness API...");
      liveness(blob, (apiResult) => {
        console.log("Luxand liveness response:", apiResult);
        setResult(apiResult);
        setLoading(false);
      });
    }, "image/jpeg");
  }, []);

  const reset = useCallback(() => {
    abortRef.current.aborted = true;
    setResult(null);
    setCapturedImage(null);
    setActiveChallenge(null);
    setChallengeError(null);
  }, []);

  const isReal = result?.result === "real";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-8 dark:bg-zinc-900">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-zinc-800 dark:text-zinc-100">
            Liveness Check Demo
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Powered by Luxand.cloud
          </p>
        </div>

        {/* Video / captured image */}
        <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-black dark:border-zinc-700 aspect-[3/4] w-full max-w-sm mx-auto">
          {capturedImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={capturedImage}
              alt="Captured frame"
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              muted
              playsInline
            />
          )}
          {streaming && <FaceGuideOverlay />}
        </div>

        {/* Hidden canvas used for capture */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Controls */}
        <div className="flex gap-3">
          {!streaming && !capturedImage && (
            <button
              onClick={startCamera}
              className="flex-1 rounded-lg bg-zinc-800 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Start Camera
            </button>
          )}

          {streaming && !capturedImage && (
            <>
              <button
                onClick={capture}
                disabled={loading}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Capture &amp; Check
              </button>
              <button
                onClick={stopCamera}
                className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Stop
              </button>
            </>
          )}

          {capturedImage && (
            <button
              onClick={() => {
                reset();
                startCamera();
              }}
              className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Retake
            </button>
          )}
        </div>

        {/* Active challenge instruction */}
        {activeChallenge && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-center dark:border-blue-800 dark:bg-blue-950">
            <p className="text-xs font-medium uppercase tracking-wide text-blue-500 dark:text-blue-400">
              Liveness Challenge
            </p>
            <p className="mt-1 text-lg font-semibold text-blue-800 dark:text-blue-200">
              {activeChallenge.instruction}
            </p>
          </div>
        )}

        {/* Challenge error */}
        {challengeError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
              {challengeError}
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
            {activeChallenge ? "Waiting for challenge…" : "Verifying live camera feed…"}
          </p>
        )}

        {/* Result */}
        {result && !loading && (
          <div
            className={`rounded-xl border p-4 ${
              isReal
                ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950"
                : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"
            }`}
          >
            <p
              className={`text-sm font-semibold ${
                isReal
                  ? "text-green-700 dark:text-green-300"
                  : "text-red-700 dark:text-red-300"
              }`}
            >
              {isReal ? "LIVE — Real person detected" : "FAILED — Spoof or no face detected"}
            </p>

            {result.confidence !== undefined && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Confidence: {(result.confidence * 100).toFixed(1)}%
              </p>
            )}

            <pre className="mt-3 overflow-auto rounded-lg bg-zinc-900 p-3 text-xs text-zinc-100">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
