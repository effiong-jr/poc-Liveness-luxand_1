"use client";

import { useRef, useState, useCallback } from "react";

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
            <ellipse cx="50" cy="60" rx="32" ry="42" fill="black" />
          </mask>
        </defs>
        <rect width="100" height="133" fill="rgba(0,0,0,0.45)" mask="url(#face-cutout)" />
        <ellipse cx="50" cy="60" rx="32" ry="42" fill="none" stroke="white" strokeWidth="0.8" strokeDasharray="4 2" />
      </svg>
    </div>
  )
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

  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LivenessResult | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

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
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach((t) => t.stop());
      videoRef.current.srcObject = null;
      setStreaming(false);
    }
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL("image/jpeg");
    setCapturedImage(dataUrl);
    setResult(null);
    setLoading(true);

    canvas.toBlob((blob) => {
      if (!blob) {
        console.error("Failed to capture image blob");
        setLoading(false);
        return;
      }

      console.log("Sending image to Luxand liveness API...");

      liveness(blob, (apiResult) => {
        console.log("Luxand liveness response:", apiResult);
        setResult(apiResult);
        setLoading(false);
      });
    }, "image/jpeg");
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setCapturedImage(null);
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
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500"
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

        {/* Loading */}
        {loading && (
          <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
            Checking liveness...
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
