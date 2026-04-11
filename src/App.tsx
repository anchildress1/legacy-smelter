import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { Howl } from 'howler';
import {
  db,
  doc,
  getDoc,
} from './firebase';
import {
  analyzeLegacyTech,
  AnalysisError,
  type AnalysisErrorCategory,
  type SmeltAnalysis,
} from './services/geminiService';
import { SmeltLog } from './types';
import type { SmelterCanvasHandle } from './components/SmelterCanvas';
import { IncidentReportOverlay } from './components/IncidentReportOverlay';
import { IncidentLogCard } from './components/IncidentLogCard';
import { getLogShareLinks, buildShareLinks, buildIncidentUrl } from './lib/utils';
import { Camera, Upload, X, Flame, RotateCcw, ArrowRight } from 'lucide-react';
import { DecommissionIndex } from './components/DecommissionIndex';
import { SiteFooter } from './components/SiteFooter';
import { DataHealthIndicator } from './components/DataHealthIndicator';
import { SeverityBadge } from './components/SeverityBadge';
import { shouldAutoOpenPostmortem } from './lib/postmortemAutoOpen';
import { parseSmeltLog } from './lib/smeltLogSchema';
import {
  useGlobalStats,
} from './hooks/useGlobalStats';
import {
  useRecentIncidentLogs,
  DEFAULT_QUEUE_SCHEMA_ISSUE_PREFIX,
} from './hooks/useRecentIncidentLogs';

// Audio
const flyInSound = new Howl({ src: ['/assets/audio/sfx-fly-in.wav'], loop: false, volume: 0.5 });
const fireSound = new Howl({ src: ['/assets/audio/sfx-smelt.wav'], loop: false, volume: 0.6 });
const purrSound = new Howl({ src: ['/assets/audio/sfx-purr.wav'], loop: false, volume: 0.4 });
const CANVAS_READY_TIMEOUT_MS = 8_000;
const QUEUE_SCHEMA_ISSUE_PREFIX = DEFAULT_QUEUE_SCHEMA_ISSUE_PREFIX;

// User-visible copy for the analyze-path error categories. Kept alongside
// the category definitions so a category added to `AnalysisError` that
// forgets a message here would be surfaced as the catch-all "unknown"
// branch rather than a silent `undefined`. Each message is phrased as
// an institutional incident-report line because the rest of the UI uses
// the same voice — a plain "Something went wrong" would clash.
const ANALYZE_ISSUE_COPY: Record<AnalysisErrorCategory, string> = {
  auth:
    'ANALYSIS FAILED. AUTHENTICATION LAPSE. REFRESH AND RETRY.',
  rate_limited:
    'ANALYSIS FAILED. RATE LIMIT ENGAGED. WAIT BEFORE RETRYING.',
  server_busy:
    'ANALYSIS FAILED. FURNACE AT CAPACITY. RETRY SHORTLY.',
  payload:
    'ANALYSIS FAILED. ARTIFACT REJECTED BY INTAKE. TRY A DIFFERENT IMAGE.',
  analysis:
    'ANALYSIS FAILED. INCIDENT ENGINE UNAVAILABLE. RETRY SHORTLY.',
  unknown:
    'ANALYSIS FAILED. UNKNOWN FAULT. RETRY SHORTLY.',
};

const ANALYZE_ISSUE_FILE_READ =
  'ANALYSIS FAILED. ARTIFACT COULD NOT BE READ. TRY ANOTHER FILE.';
const SmelterCanvas = lazy(async () => {
  const module = await import('./components/SmelterCanvas');
  return { default: module.SmelterCanvas };
});

interface AppProps {
  readonly onNavigateManifest: () => void;
  readonly deepLinkId?: string | null;
}

interface CanvasReadyWaiter {
  resolve: (handle: SmelterCanvasHandle) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export default function App({ onNavigateManifest, deepLinkId }: Readonly<AppProps>) {
  const { globalStats, statsIssue } = useGlobalStats({ source: 'App' });
  const { recentLogs, queueIssue, loaded: recentLogsLoaded } = useRecentIncidentLogs({
    limitCount: 3,
    source: 'App',
    schemaIssuePrefix: QUEUE_SCHEMA_ISSUE_PREFIX,
  });
  const [selectedRecentLog, setSelectedRecentLog] = useState<SmeltLog | null>(null);
  // Deep-link targets are staged here until the top-3 subscription
  // has delivered its first snapshot. Otherwise the overlay could open
  // with `showP0Badge=false` during the cold-load window and then flash
  // to `true` the moment `recentLogs` populates — misleading the user
  // about the incident's priority for one render. The staging effect
  // below transfers the pending log into `selectedRecentLog` once
  // `recentLogsLoaded` flips true. On Firestore error the hook still
  // sets `loaded` to true, so this gating cannot hang.
  const [pendingDeepLinkLog, setPendingDeepLinkLog] = useState<SmeltLog | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeIssue, setAnalyzeIssue] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [analysis, setAnalysis] = useState<SmeltAnalysis | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<SmelterCanvasHandle | null>(null);
  const canvasReadyWaitersRef = useRef<CanvasReadyWaiter[]>([]);
  const activeRequestIdRef = useRef(0);
  const analysisRef = useRef<SmeltAnalysis | null>(null);
  const postmortemAutoOpenedRef = useRef(false);
  const cameraAttachTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCameraStreamRef = useRef<MediaStream | null>(null);

  const rejectCanvasWaiters = useCallback((reason: string) => {
    const waiters = canvasReadyWaitersRef.current;
    canvasReadyWaitersRef.current = [];
    for (const waiter of waiters) {
      clearTimeout(waiter.timeoutId);
      waiter.reject(new Error(reason));
    }
  }, []);

  const setCanvasHandle = useCallback((handle: SmelterCanvasHandle | null) => {
    canvasRef.current = handle;
    if (!handle) return;
    const waiters = canvasReadyWaitersRef.current;
    canvasReadyWaitersRef.current = [];
    for (const waiter of waiters) {
      clearTimeout(waiter.timeoutId);
      waiter.resolve(handle);
    }
  }, []);

  // Extracted so the setTimeout call in `waitForCanvasHandle` stays flat
  // (S2004: no more than 4 nested function literals). `setTimeout(fn, ms,
  // ...args)` passes the waiter through directly instead of closing over
  // it in an inner arrow.
  const onCanvasReadyTimeout = useCallback((waiter: CanvasReadyWaiter) => {
    canvasReadyWaitersRef.current = canvasReadyWaitersRef.current.filter((entry) => entry !== waiter);
    waiter.reject(new Error('Smelter canvas did not initialize in time.'));
  }, []);

  const waitForCanvasHandle = useCallback((): Promise<SmelterCanvasHandle> => {
    if (canvasRef.current) return Promise.resolve(canvasRef.current);
    return new Promise<SmelterCanvasHandle>((resolve, reject) => {
      const waiter: CanvasReadyWaiter = {
        resolve,
        reject,
        // Populated immediately below; we need the waiter reference inside
        // the timeout callback, so the id can't be assigned until after
        // the object literal exists.
        timeoutId: 0 as unknown as ReturnType<typeof setTimeout>,
      };
      waiter.timeoutId = setTimeout(onCanvasReadyTimeout, CANVAS_READY_TIMEOUT_MS, waiter);
      canvasReadyWaitersRef.current.push(waiter);
    });
  }, [onCanvasReadyTimeout]);

  const releaseCameraResources = () => {
    if (cameraAttachTimerRef.current !== null) {
      clearTimeout(cameraAttachTimerRef.current);
      cameraAttachTimerRef.current = null;
    }
    if (pendingCameraStreamRef.current) {
      pendingCameraStreamRef.current.getTracks().forEach((t) => t.stop());
      pendingCameraStreamRef.current = null;
    }
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
  };

  // Release camera hardware if component unmounts mid-flow
  useEffect(() => {
    return () => {
      releaseCameraResources();
      rejectCanvasWaiters('Smelter view unmounted before canvas was ready.');
    };
  }, [rejectCanvasWaiters]);

  // Deep link: fetch incident by Firestore doc ID and stage it for the
  // overlay. Actually opening the overlay is deferred to the staging
  // effect below so the P0 badge derivation has a populated top-3 set
  // to check against. The URL is already cleared by Root — deepLinkId
  // is a one-shot value.
  useEffect(() => {
    if (!deepLinkId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'incident_logs', deepLinkId));
        if (cancelled) return;
        if (!snap.exists()) {
          console.error('[App] Deep link incident not found:', deepLinkId);
          return;
        }
        const parsedLog = parseSmeltLog(snap.id, snap.data());
        setPendingDeepLinkLog(parsedLog);
      } catch (err) {
        if (!cancelled) {
          console.error('[App] Deep link fetch/parsing failed:', err);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [deepLinkId]);

  // Staging effect: a pending deep-link log waits here until the top-3
  // subscription has delivered its first snapshot, then transfers into
  // `selectedRecentLog` to open the overlay. This runs exactly once per
  // pending log because it clears `pendingDeepLinkLog` on transfer.
  // Reading `recentLogsLoaded` guarantees the P0 derivation below sees
  // a populated Set on first render, avoiding a false→true badge flash.
  useEffect(() => {
    if (!pendingDeepLinkLog || !recentLogsLoaded) return;
    setSelectedRecentLog(pendingDeepLinkLog);
    setPendingDeepLinkLog(null);
  }, [pendingDeepLinkLog, recentLogsLoaded]);

  const startCamera = async () => {
    try {
      releaseCameraResources();
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      pendingCameraStreamRef.current = stream;
      setIsCameraActive(true);
      cameraAttachTimerRef.current = setTimeout(() => {
        cameraAttachTimerRef.current = null;
        if (!videoRef.current || pendingCameraStreamRef.current !== stream) return;
        videoRef.current.srcObject = stream;
        pendingCameraStreamRef.current = null;
        // `.play()` returns a promise that rejects when autoplay is
        // interrupted (e.g. stopCamera() nuked srcObject before playback
        // resolved). Surface it as a diagnostic instead of dropping the
        // rejection on the floor — silent failures here look like a
        // frozen camera preview.
        videoRef.current.play().catch((playErr: unknown) => {
          console.error('[App] Camera play() failed:', playErr);
        });
      }, 100);
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        console.error('[App] Camera permission denied; opening file picker as fallback.');
        cameraInputRef.current?.click();
      } else {
        console.error(`[App] Camera unavailable (${name || 'unknown'}):`, err);
      }
    }
  };

  const stopCamera = () => {
    releaseCameraResources();
    setIsCameraActive(false);
  };

  const captureImage = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        const base64 = canvas.toDataURL('image/jpeg');
        stopCamera();
        processImage(base64, 'image/jpeg');
      } else {
        console.error('[App] captureImage: failed to get 2D canvas context');
        stopCamera();
      }
    } else {
      console.error('[App] captureImage: videoRef not available');
      stopCamera();
    }
  };

  const processImage = async (base64: string, mimeType: string) => {
    const requestId = ++activeRequestIdRef.current;

    if (import.meta.env.DEV) console.log("Processing image...", mimeType);
    resetToIdle();
    setSelectedRecentLog(null);
    setAnalyzeIssue(null);
    setIsAnalyzing(true);
    flyInSound.stop();
    fireSound.stop();
    purrSound.stop();

    const base64Data = base64.split(',')[1];
    let result: SmeltAnalysis;
    try {
      result = await analyzeLegacyTech(base64Data, mimeType);
    } catch (error) {
      if (requestId !== activeRequestIdRef.current) return;
      console.error("Gemini analysis failed", error);
      // Surface the failure through the shared DataHealthIndicator
      // channel so the user sees a category-appropriate message
      // instead of a silent bounce back to idle. `AnalysisError`
      // carries an HTTP-status-derived category; anything else is
      // treated as unknown (network error, parser failure, etc.).
      const category =
        error instanceof AnalysisError ? error.category : 'unknown';
      setAnalyzeIssue(ANALYZE_ISSUE_COPY[category]);
      setIsAnalyzing(false);
      return;
    }

    if (requestId !== activeRequestIdRef.current) return;
    if (import.meta.env.DEV) console.log("Analysis complete:", result);
    setAnalysis(result);
    analysisRef.current = result;
    setIsAnalyzing(false);

    try {
      const canvasHandle = await waitForCanvasHandle();
      if (requestId !== activeRequestIdRef.current) return;
      await canvasHandle.loadAndSmelt(base64, result.subjectBox, result.dominantColors);
    } catch (error) {
      if (requestId !== activeRequestIdRef.current) return;
      console.error('[App] Canvas rendering failed:', error);
      // The server already persisted the incident. Preserve `analysis` so the
      // user can still open the postmortem (with its share links and live
      // counts) even though the animation is broken. Otherwise they lose all
      // access to data they already paid for with their upload.
      setIsComplete(true);
      setShowReport(true);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    // Clear any stale analyze-issue so an old failure message does not
    // cling to the screen once the user picks a fresh file.
    setAnalyzeIssue(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      processImage(base64, file.type);
    };
    reader.onerror = () => {
      console.error('[App] FileReader failed:', reader.error);
      // Surface the failure so the user gets a recovery path. Without
      // this, the file picker closes with no visible signal and the
      // user has no idea why "Process Artifact" did nothing.
      setAnalyzeIssue(ANALYZE_ISSUE_FILE_READ);
    };
    reader.readAsDataURL(file);
  };

  const handleSmeltComplete = () => {
    if (import.meta.env.DEV) console.log("Smelt complete");
    fireSound.stop();
    purrSound.play();
    setIsPlaying(false);
    if (!analysisRef.current) return;
    setIsComplete(true);
    // Only auto-open the postmortem the first time. On replay, the user
    // already dismissed it once — don't force it back open.
    // Respect reduced motion and explicit user opt-out preferences.
    // Reads are guarded inside shouldAutoOpenPostmortem() so restricted
    // runtimes cannot throw during smelt completion.
    if (!postmortemAutoOpenedRef.current) {
      postmortemAutoOpenedRef.current = true;
      if (shouldAutoOpenPostmortem()) {
        setShowReport(true);
      }
    }
  };

  const resetToIdle = () => {
    setIsComplete(false);
    setShowReport(false);
    setAnalysis(null);
    analysisRef.current = null;
    postmortemAutoOpenedRef.current = false;
    setIsPlaying(false);
  };

  // Dismiss the post-smelt REPLAY/VIEW overlay synchronously *before* the
  // file picker or camera opens. Without this, the overlay sits on top of
  // the canvas through the entire picker session and stays visible if the
  // user cancels the picker — `resetToIdle` only runs once a file actually
  // arrives in `processImage`. The newly-archived incident is still in the
  // P0 feed, so the user can still re-open the postmortem from there.
  const handleProcessArtifactClick = () => {
    resetToIdle();
    fileInputRef.current?.click();
  };

  const handleDeployScannerClick = () => {
    resetToIdle();
    startCamera().catch((err: unknown) => {
      console.error('[App] startCamera failed:', err);
    });
  };

  const handleReplay = () => {
    purrSound.stop();
    setShowReport(false);
    setIsPlaying(true);
    canvasRef.current?.replay();
  };

  const reportShareLinks = analysis
    ? buildShareLinks(
        `${analysis.shareQuote}\n\n${analysis.incidentFeedSummary}`,
        analysis.ogHeadline,
        buildIncidentUrl(analysis.incidentId)
      )
    : [];
  const activeIssues = [statsIssue, queueIssue].filter(
    (message): message is string => !!message,
  );
  // Single derivation for "is this incident in the live top-3 set?".
  // Guards against falsy ids on both sides (Firestore doc ids are
  // non-empty but a malformed analysis payload could carry an empty
  // `incidentId`). A falsy id can never be P0 — returns false rather
  // than matching the first falsy-id log in `recentLogs`.
  const isInTopPriority = (id: string | null | undefined): boolean => {
    if (!id) return false;
    return recentLogs.some((log) => log.id === id);
  };

  return (
    <div className="min-h-screen flex flex-col bg-concrete text-ash-white font-sans">
      <header className="border-b border-concrete-border bg-concrete-mid sticky top-0 z-50">
        <div className="max-w-7xl mx-auto w-full flex items-center justify-between gap-x-3 sm:gap-x-4 px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <h1 className="text-base sm:text-2xl font-black font-mono tracking-tighter uppercase whitespace-nowrap">
              LEGACY <span className="text-hazard-amber">SMELTER</span>
            </h1>
            {/* Tagline is visible at every breakpoint — the mobile
                screenshot previously hid it via `hidden sm:flex`, which
                dropped the product's voice from the mobile header. The
                `min-w-0` + `truncate` on the paragraph guards against
                overflow on ≤320px viewports where the right-side nav
                pinches the title column. */}
            <div
              data-testid="site-tagline"
              className="flex items-center gap-1.5 mt-0.5 min-w-0"
            >
              <div className="w-2 h-2 rounded-full bg-coolant-green animate-pulse shrink-0" />
              <p className="text-stone-gray font-mono text-[9px] sm:text-[10px] uppercase tracking-wide sm:tracking-widest truncate min-w-0">
                If a bug exists, apply Hotfix.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <DataHealthIndicator issues={activeIssues} />
            <DecommissionIndex totalPixels={globalStats.total_pixels_melted} />
            <button onClick={onNavigateManifest} className="nav-btn" aria-label="All incidents">
              {/* On mobile the label is dropped entirely — "ALL" alone
                  reads as nonsense, and the tagline + Decommission Index
                  already eat the available header width. The arrow icon
                  carries the affordance and the aria-label keeps screen
                  readers on the full name. */}
              <span className="hidden sm:inline">ALL INCIDENTS</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 sm:px-6 max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* Left Column: Smelter Area */}
          <div className="lg:col-span-7 space-y-4">
            {/* Controls — Process/Deploy buttons sit side-by-side at
                every breakpoint. They previously stacked (`flex-col`)
                on mobile, which ate vertical rhythm and pushed the
                smelter canvas below the fold. Mobile variant uses
                tighter padding, a smaller text size, and a trimmed gap
                so both buttons fit comfortably inside a 375px-wide
                content column without truncating either label. */}
            <div data-testid="smelter-controls" className="flex flex-row gap-2 sm:gap-3">
              <button
                onClick={handleProcessArtifactClick}
                className="modern-button flex-1 flex items-center justify-center gap-2 sm:gap-3 px-3 sm:px-5 py-2.5 sm:py-3"
              >
                <Upload size={18} className="shrink-0" />
                <span className="text-[11px] sm:text-sm font-black uppercase tracking-wider sm:tracking-[0.16em]">
                  Process Artifact
                </span>
              </button>
              <button
                onClick={handleDeployScannerClick}
                className="modern-button flex-1 flex items-center justify-center gap-2 sm:gap-3 bg-concrete-mid px-3 sm:px-5 py-2.5 sm:py-3 text-ash-white border border-concrete-border hover:brightness-110"
              >
                <Camera size={18} className="shrink-0" />
                <span className="text-[11px] sm:text-sm font-black uppercase tracking-wider sm:tracking-[0.16em]">
                  Deploy Scanner
                </span>
              </button>
            </div>

            {/* Hidden file inputs */}
            <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="image/*" />
            <input type="file" ref={cameraInputRef} onChange={handleFileSelect} className="hidden" accept="image/*" capture="environment" />

            {/* Animation Window */}
            <div className="modern-card aspect-video relative overflow-hidden">
              {/* Camera overlay */}
              {isCameraActive && (
                <div className="absolute inset-0 bg-black z-30">
                  <video ref={videoRef} playsInline muted className="w-full h-full object-cover" aria-label="Camera preview">
                    <track kind="captions" />
                  </video>
                  <button
                    onClick={stopCamera}
                    className="absolute top-4 right-4 w-10 h-10 bg-concrete-mid/80 rounded-full flex items-center justify-center text-stone-gray hover:text-ash-white z-50"
                    aria-label="Close camera capture"
                  >
                    <X size={20} />
                  </button>
                  <div className="absolute bottom-6 left-0 w-full flex justify-center z-50">
                    <button
                      onClick={captureImage}
                      className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center bg-white/20 hover:bg-white/40 backdrop-blur-sm transition-all"
                      aria-label="Capture photo"
                    >
                      <div className="w-12 h-12 bg-white rounded-full" />
                    </button>
                  </div>
                </div>
              )}

              {/* PixiJS Canvas — always mounted so idle animation runs immediately */}
              <Suspense fallback={
                <div className="absolute inset-0 flex items-center justify-center bg-concrete/70">
                  <div className="w-10 h-10 border-4 border-hazard-amber border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                </div>
              }>
                <SmelterCanvas
                  ref={setCanvasHandle}
                  onComplete={handleSmeltComplete}
                  onFlyInStart={() => flyInSound.play()}
                  onFireStart={() => { flyInSound.stop(); fireSound.play(); }}
                  onRenderFailure={(err) => {
                    console.error('[App] SmelterCanvas render failure:', err);
                    if (analysisRef.current) {
                      setIsComplete(true);
                      setShowReport(true);
                    }
                  }}
                />
              </Suspense>


              {/* Analyzing overlay — shown while /api/analyze is in flight */}
              {isAnalyzing && (
                <div className="absolute inset-0 bg-concrete/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-40">
                  <div className="w-12 h-12 border-4 border-hazard-amber border-t-transparent rounded-full animate-spin mb-4" aria-hidden="true" />
                  <output className="text-hazard-amber font-mono text-xs uppercase animate-pulse">
                    HOTFIX PROCESSING
                  </output>
                </div>
              )}

              {/* Post-smelt controls — replay + view report */}
              {isComplete && !isPlaying && (
                <div className="absolute inset-0 z-40 bg-concrete/70 backdrop-blur-sm flex items-center justify-center gap-3">
                  <button
                    onClick={handleReplay}
                    className="modern-button flex items-center gap-2 text-sm bg-concrete/80 text-hazard-amber border border-concrete-border backdrop-blur-sm hover:bg-concrete/90"
                  >
                    <RotateCcw size={16} aria-hidden="true" />
                    REPLAY SMELT
                  </button>
                  {!showReport && (
                    <button
                      onClick={() => setShowReport(true)}
                      className="modern-button flex items-center gap-2 text-sm"
                    >
                      VIEW POSTMORTEM
                    </button>
                  )}
                </div>
              )}

            </div>

            {/* Inline analyze error — displayed below canvas, themed as institutional fault.
                The `data-health-issue` test id is the historical contract for the analyzer's
                user-visible fault surface. It used to live inside DataHealthIndicator's list,
                but the post-redesign layout puts the analyzer-specific message inline below
                the canvas (closer to the action that triggered it) while DataHealthIndicator
                still owns the global `statsIssue`/`queueIssue` state. Tests query this id to
                pin the contract that an analyzer fault always reaches the UI. */}
            {analyzeIssue && (
              <div
                role="alert"
                data-testid="data-health-issue"
                className="font-mono text-[10px] uppercase tracking-widest text-hazard-amber border border-hazard-amber/25 bg-hazard-amber/5 rounded-lg px-4 py-3 leading-relaxed"
              >
                {analyzeIssue}
              </div>
            )}

            {/* Compact result summary — shown after smelt completes */}
            {isComplete && analysis && (
              <div className="font-mono text-[10px] uppercase tracking-widest border border-concrete-border bg-concrete-mid rounded-lg px-4 py-3 flex items-center gap-3 min-w-0">
                <SeverityBadge severity={analysis.severity} />
                <span className="text-stone-gray truncate min-w-0">{analysis.ogHeadline}</span>
              </div>
            )}
          </div>

          {/* Right Column: Incident Queue */}
          <div className="lg:col-span-5">
            <div>
              <div className="mb-3">
                <h2 className="text-hazard-amber font-mono text-xs lg:text-sm uppercase tracking-wide lg:tracking-widest font-bold">
                  P0 INCIDENT QUEUE
                </h2>
                <div className="hazard-stripe h-1 w-full mt-2 rounded-sm" />
              </div>
              <ul className="space-y-4">
                {recentLogs.map((log) => (
                  <li key={log.id}>
                    <IncidentLogCard
                      log={log}
                      showP0Badge
                      onClick={() => setSelectedRecentLog(log)}
                    />
                  </li>
                ))}
                {recentLogs.length === 0 && (
                  <li className="modern-card p-12 text-center list-none">
                    <Flame size={32} className="text-hazard-amber mx-auto mb-3" />
                    <p className="text-stone-gray font-mono text-xs uppercase tracking-wider">
                      Furnace idle. Awaiting condemned infrastructure.
                    </p>
                  </li>
                )}
              </ul>
            </div>
          </div>

        </div>
      </main>

      <SiteFooter />

      {/* Post-mortem overlay.

          `showP0Badge` is derived from live top-3 membership, not from
          which surface opened the overlay — a deep link can land on an
          incident that was never in the queue, and a home-queue click
          can open an incident that just aged out between render and
          click. `isInTopPriority` is the single source of truth for
          both overlay call sites so the badge stays consistent with
          the cards visible underneath. Deep links are additionally
          gated on `recentLogsLoaded` upstream (see the staging effect)
          so the badge cannot flash false-then-true while the top-3
          subscription is still landing. */}
      {selectedRecentLog && (
        <IncidentReportOverlay
          log={selectedRecentLog}
          shareLinks={getLogShareLinks(selectedRecentLog)}
          incidentId={selectedRecentLog.id}
          showP0Badge={isInTopPriority(selectedRecentLog.id)}
          onClose={() => setSelectedRecentLog(null)}
        />
      )}

      {showReport && analysis && (
        <IncidentReportOverlay
          analysis={analysis}
          shareLinks={reportShareLinks}
          incidentId={analysis.incidentId}
          showP0Badge={isInTopPriority(analysis.incidentId)}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
