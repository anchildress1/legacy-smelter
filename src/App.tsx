import React, { useState, useEffect, useRef } from 'react';
import { Howl } from 'howler';
import {
  db,
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  getDoc,
  setDoc,
  increment,
  serverTimestamp
} from './firebase';
import { analyzeLegacyTech, SmeltAnalysis } from './services/geminiService';
import { GlobalStats as GlobalStatsType, SmeltLog, computeImpact } from './types';
import { SmelterCanvas, SmelterCanvasHandle } from './components/SmelterCanvas';
import { IncidentReportOverlay } from './components/IncidentReportOverlay';
import { IncidentLogCard } from './components/IncidentLogCard';
import { formatPixels, getFiveDistinctColors, getLogShareLinks, buildShareLinks, buildIncidentUrl } from './lib/utils';
import { Camera, Upload, X, Flame, RotateCcw, ArrowRight } from 'lucide-react';
import { handleFirestoreError, OperationType } from './lib/firestoreErrors';
import { parseSmeltLog } from './lib/smeltLogSchema';

// Audio
const flyInSound = new Howl({ src: ['/assets/audio/sfx-fly-in.wav'], loop: false, volume: 0.5 });
const fireSound = new Howl({ src: ['/assets/audio/sfx-smelt.wav'], loop: false, volume: 0.6 });
const purrSound = new Howl({ src: ['/assets/audio/sfx-purr.wav'], loop: false, volume: 0.4 });
const INCIDENT_SCHEMA_ERROR = 'INCIDENT DATA SCHEMA VIOLATION. FIX MALFORMED INCIDENT_LOGS DOCUMENTS.';

interface AppProps {
  onNavigateManifest: () => void;
  deepLinkId?: string | null;
}

export default function App({ onNavigateManifest, deepLinkId }: AppProps) {
  const [globalStats, setGlobalStats] = useState<GlobalStatsType>({ total_pixels_melted: 0 });
  const [recentLogs, setRecentLogs] = useState<SmeltLog[]>([]);
  const [selectedRecentLog, setSelectedRecentLog] = useState<SmeltLog | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [deepLinkError, setDeepLinkError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [isWritingData, setIsWritingData] = useState(false);
  const [buttonsDelayed, setButtonsDelayed] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<SmeltAnalysis | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  // Firestore doc ID of the most recently smelted incident — used for share links
  const [loggedIncidentId, setLoggedIncidentId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<SmelterCanvasHandle>(null);
  const activeRequestIdRef = useRef(0);
  const analysisRef = useRef<SmeltAnalysis | null>(null);
  const hasWrittenRef = useRef(false);
  const smeltTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const statsDoc = doc(db, 'global_stats', 'main');
    const unsubStats = onSnapshot(statsDoc, (snapshot) => {
      if (snapshot.exists()) {
        setGlobalStats(snapshot.data() as GlobalStatsType);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'global_stats/main', setAnalysisError);
    });

    // Pull the full archive so P0 ranking is truly global.
    // Impact = (5×sanctions)+(3×escalations)+(2×breaches) can't be queried server-side.
    // SCALING: subscribes to the full collection for truly global P0 ranking.
    // At scale, replace with a precomputed impact_score field maintained by a
    // Cloud Function, then query orderBy('impact_score').limit(3).
    const logsQuery = query(
      collection(db, 'incident_logs'),
      orderBy('timestamp', 'desc')
    );
    const unsubLogs = onSnapshot(logsQuery, (snapshot) => {
      let entries: SmeltLog[];
      try {
        entries = snapshot.docs.map((d) => parseSmeltLog(d.id, d.data()));
      } catch (error) {
        console.error('[App] incident_logs schema violation:', error);
        setRecentLogs([]);
        setAnalysisError(INCIDENT_SCHEMA_ERROR);
        return;
      }
      const sorted = entries.sort((a, b) => {
        return computeImpact(b.sanction_count, b.escalation_count, b.breach_count)
             - computeImpact(a.sanction_count, a.escalation_count, a.breach_count);
      });
      setRecentLogs(sorted.slice(0, 3));
      setAnalysisError((prev) => (prev === INCIDENT_SCHEMA_ERROR ? null : prev));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'incident_logs', setAnalysisError);
    });

    return () => { unsubStats(); unsubLogs(); };
  }, []);

  // Release camera hardware and pending timers if component unmounts mid-flow
  useEffect(() => {
    return () => {
      if (smeltTimerRef.current !== null) {
        clearTimeout(smeltTimerRef.current);
        smeltTimerRef.current = null;
      }
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // Deep link: fetch incident by Firestore doc ID and open its overlay.
  // The URL is already cleared by Root — deepLinkId is a one-shot value.
  useEffect(() => {
    if (!deepLinkId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'incident_logs', deepLinkId));
        if (cancelled) return;
        if (!snap.exists()) {
          setDeepLinkError('Incident not found — the link may have expired or been removed.');
          return;
        }
        const parsedLog = parseSmeltLog(snap.id, snap.data());
        setSelectedRecentLog(parsedLog);
        setDeepLinkError(null);
      } catch (err) {
        if (!cancelled) {
          console.error('[App] Deep link fetch/parsing failed:', err);
          setDeepLinkError('Could not load incident — data schema violation or network failure.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [deepLinkId]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setIsCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }, 100);
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setAnalysisError('CAMERA PERMISSION DENIED. FILE PICKER OPENED AS FALLBACK.');
        cameraInputRef.current?.click();
      } else {
        console.error(`[App] Camera unavailable (${name || 'unknown'}):`, err);
        setAnalysisError('CAMERA UNAVAILABLE. USE PROCESS ARTIFACT.');
      }
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
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
        setAnalysisError('CAMERA CAPTURE FAILED. USE PROCESS ARTIFACT.');
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
    setCurrentImage(base64);
    setSelectedRecentLog(null);
    setAnalysisError(null);
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
      setIsAnalyzing(false);
      setCurrentImage(null);
      setAnalysisError('GEMINI ANALYSIS FAILED. RETRY IN A MOMENT.');
      return;
    }

    if (requestId !== activeRequestIdRef.current) return;
    if (import.meta.env.DEV) console.log("Analysis complete:", result);
    setAnalysis(result);
    analysisRef.current = result;
    setIsAnalyzing(false);

    try {
      await canvasRef.current?.loadAndSmelt(base64, result.subjectBox, result.dominantColors);
    } catch (error) {
      if (requestId !== activeRequestIdRef.current) return;
      console.error('[App] Canvas rendering failed:', error);
      resetToIdle();
      setCurrentImage(null);
      setAnalysisError('CANVAS RENDER FAILED. TRY A DIFFERENT BROWSER OR ENABLE HARDWARE ACCELERATION.');
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      processImage(base64, file.type);
    };
    reader.onerror = () => {
      console.error('[App] FileReader failed:', reader.error);
      setAnalysisError('FILE READ FAILED. THE FILE MAY BE CORRUPT OR INACCESSIBLE.');
    };
    reader.readAsDataURL(file);
  };

  const handleSmeltComplete = async () => {
    if (import.meta.env.DEV) console.log("Smelt complete");
    fireSound.stop();
    purrSound.play();
    setIsPlaying(false);

    const completedAnalysis = analysisRef.current;
    if (!completedAnalysis) return;

    // Always delay buttons — works for both first smelt and replay
    setButtonsDelayed(true);

    if (!hasWrittenRef.current) {
      // First completion — reveal report after delay regardless of write outcome,
      // then write to Firestore in the background.
      const writeRequestId = activeRequestIdRef.current;
      hasWrittenRef.current = true;
      setIsComplete(true);

      // Let the dragon return to rest before showing the spinner
      setTimeout(() => setIsWritingData(true), 1200);

      smeltTimerRef.current = setTimeout(() => {
        smeltTimerRef.current = null;
        setButtonsDelayed(false);
        setIsWritingData(false);
        setShowReport(true);
      }, 5000);

      (async () => {
        try {
          const colors = getFiveDistinctColors(completedAnalysis.dominantColors);
          const box = completedAnalysis.subjectBox;
          const logRef = doc(collection(db, 'incident_logs'));
          await setDoc(logRef, {
            pixel_count: completedAnalysis.pixelCount,
            incident_feed_summary: completedAnalysis.incidentFeedSummary,
            color_1: colors[0],
            color_2: colors[1],
            color_3: colors[2],
            color_4: colors[3],
            color_5: colors[4],
            subject_box_ymin: box[0] ?? 100,
            subject_box_xmin: box[1] ?? 100,
            subject_box_ymax: box[2] ?? 900,
            subject_box_xmax: box[3] ?? 900,
            legacy_infra_class: completedAnalysis.legacyInfraClass,
            diagnosis: completedAnalysis.diagnosis,
            chromatic_profile: completedAnalysis.chromaticProfile,
            system_dx: completedAnalysis.systemDx,
            severity: completedAnalysis.severity,
            primary_contamination: completedAnalysis.primaryContamination,
            contributing_factor: completedAnalysis.contributingFactor,
            failure_origin: completedAnalysis.failureOrigin,
            disposition: completedAnalysis.disposition,
            archive_note: completedAnalysis.archiveNote,
            og_headline: completedAnalysis.ogHeadline,
            share_quote: completedAnalysis.shareQuote,
            anon_handle: completedAnalysis.anonHandle,
            timestamp: serverTimestamp(),
            uid: crypto.randomUUID(),
            breach_count: 0,
            escalation_count: 0,
            sanction_count: 0,
            sanctioned: false,
            judged: false,
            sanction_rationale: null
          });
          if (writeRequestId !== activeRequestIdRef.current) return;
          setLoggedIncidentId(logRef.id);

          const statsRef = doc(db, 'global_stats', 'main');
          await setDoc(statsRef, {
            total_pixels_melted: increment(completedAnalysis.pixelCount)
          }, { merge: true });

        } catch (error) {
          if (writeRequestId !== activeRequestIdRef.current) return;
          hasWrittenRef.current = false;
          setIsWritingData(false);
          setAnalysisError('ARCHIVE WRITE FAILED. INCIDENT NOT PERSISTED TO MANIFEST.');
          handleFirestoreError(error, OperationType.WRITE, 'incident_logs / global_stats');
        }
      })();
    } else {
      // Replay — no Firestore write, just delay the buttons
      smeltTimerRef.current = setTimeout(() => {
        smeltTimerRef.current = null;
        setButtonsDelayed(false);
      }, 5000);
    }
  };

  const resetToIdle = () => {
    if (smeltTimerRef.current !== null) {
      clearTimeout(smeltTimerRef.current);
      smeltTimerRef.current = null;
    }
    setIsComplete(false);
    setShowReport(false);
    setAnalysis(null);
    analysisRef.current = null;
    hasWrittenRef.current = false;
    setIsWritingData(false);
    setButtonsDelayed(false);
    setIsPlaying(false);
    setLoggedIncidentId(null);
  };

  const handleReplay = () => {
    purrSound.stop();
    setShowReport(false);
    setIsPlaying(true);
    canvasRef.current?.replay();
  };

  const shareLinks = analysis
    ? buildShareLinks(
        `${analysis.shareQuote}\n\n${analysis.incidentFeedSummary}`,
        analysis.ogHeadline,
        loggedIncidentId ? buildIncidentUrl(loggedIncidentId) : window.location.origin
      )
    : [];

  const formatted = formatPixels(globalStats.total_pixels_melted);

  return (
    <div className="min-h-screen flex flex-col bg-concrete text-ash-white font-sans">
      <header className="border-b border-concrete-border bg-concrete-mid sticky top-0 z-50">
        <div className="max-w-7xl mx-auto w-full flex flex-col gap-3 px-4 py-4 sm:flex-row sm:justify-between sm:items-center sm:px-6">
          <div>
            <h1 className="text-2xl font-black font-mono tracking-tighter uppercase">
              LEGACY <span className="text-hazard-amber">SMELTER</span>
            </h1>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="w-2 h-2 rounded-full bg-coolant-green animate-pulse shrink-0" />
              <p className="text-stone-gray font-mono text-[10px] uppercase tracking-widest">
                If a bug exists, apply Hotfix.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 w-full sm:w-auto sm:justify-end">
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="font-mono font-extrabold text-hazard-amber text-lg leading-none tracking-tight">
                  {formatted.value} <span className="text-xs text-stone-gray font-bold">{formatted.unit}</span>
                </div>
                <div className="text-[10px] font-mono text-stone-gray uppercase tracking-widest mt-0.5">
                  DECOMMISSION INDEX
                </div>
              </div>
              <div className="hazard-stripe w-2 h-10 rounded-sm shrink-0" aria-hidden="true" />
            </div>
            <button onClick={onNavigateManifest} className="nav-btn">
              ALL INCIDENTS
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {deepLinkError && (
          <div className="modern-card p-4 mb-6" role="alert" aria-live="assertive">
            <p className="text-hazard-amber font-mono text-xs uppercase tracking-wide">{deepLinkError}</p>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* Left Column: Smelter Area */}
          <div className="lg:col-span-7 space-y-4">
            {/* Controls */}
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="modern-button flex-1 flex items-center justify-center gap-3 px-5 py-3"
              >
                <Upload size={18} />
                <span className="text-sm font-black uppercase tracking-[0.16em]">Process Artifact</span>
              </button>
              <button
                onClick={startCamera}
                className="modern-button flex-1 flex items-center justify-center gap-3 bg-concrete-mid px-5 py-3 text-ash-white border border-concrete-border hover:brightness-110"
              >
                <Camera size={18} />
                <span className="text-sm font-black uppercase tracking-[0.16em]">Deploy Scanner</span>
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
                  <video ref={videoRef} playsInline className="w-full h-full object-cover" aria-label="Camera preview" />
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
              <SmelterCanvas
                ref={canvasRef}
                onComplete={handleSmeltComplete}
                onFlyInStart={() => flyInSound.play()}
                onFireStart={() => { flyInSound.stop(); fireSound.play(); }}
              />


              {/* Analyzing overlay */}
              {isAnalyzing && (
                <div role="status" className="absolute inset-0 bg-concrete/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-40">
                  <div className="w-12 h-12 border-4 border-hazard-amber border-t-transparent rounded-full animate-spin mb-4" />
                  <p className="text-hazard-amber font-mono text-xs uppercase animate-pulse">
                    HOTFIX PROCESSING
                  </p>
                </div>
              )}

              {/* Loading post-mortem overlay — delayed 1.2s after smelt, stays until report reveals */}
              {isWritingData && !showReport && (
                <div role="status" aria-live="polite" className="absolute inset-0 z-40 flex items-center justify-center">
                  <div className="bg-concrete/90 backdrop-blur-sm px-6 py-3 rounded border border-concrete-border flex items-center gap-3">
                    <div className="w-4 h-4 border-2 border-hazard-amber border-t-transparent rounded-full animate-spin shrink-0" />
                    <p className="text-hazard-amber font-mono text-xs uppercase tracking-widest">
                      COMPILING INCIDENT POSTMORTEM // STAND BY
                    </p>
                  </div>
                </div>
              )}

              {/* Post-smelt controls — replay + view report */}
              {isComplete && !buttonsDelayed && !isPlaying && (
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

            {analysisError && (
              <div className="modern-card p-4" role="alert" aria-live="assertive">
                <p className="text-hazard-amber font-mono text-xs uppercase tracking-wide">
                  {analysisError}
                </p>
              </div>
            )}
          </div>

          {/* Right Column: Incident Queue */}
          <div className="lg:col-span-5">
            <div>
              <div className="mb-3">
                <h2 className="text-hazard-amber font-mono text-xs lg:text-sm uppercase tracking-wide lg:tracking-widest font-bold">
                  P0 INCIDENTS
                </h2>
                <div className="hazard-stripe h-1 w-full mt-2 rounded-sm" />
              </div>
              <ul role="list" className="space-y-3">
                {recentLogs.map((log) => (
                  <li key={log.id}>
                    <IncidentLogCard
                      log={log}
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

      {/* Footer */}
      <footer className="p-6 bg-concrete-mid border-t border-concrete-border mt-auto">
        <div className="max-w-7xl mx-auto w-full flex flex-col lg:flex-row justify-between items-center gap-4">
          <p className="text-xs font-mono text-stone-gray uppercase tracking-widest">
            &copy; 2026 Ashley Childress
          </p>
          <p className="text-xs font-mono text-stone-gray uppercase tracking-widest">
            Powered by Gemini
          </p>
        </div>
      </footer>

      {/* Post-mortem overlay */}
      {selectedRecentLog && (
        <IncidentReportOverlay
          log={selectedRecentLog}
          shareLinks={getLogShareLinks(selectedRecentLog)}
          incidentId={selectedRecentLog.id}

          onClose={() => setSelectedRecentLog(null)}
        />
      )}

      {showReport && analysis && (
        <IncidentReportOverlay
          analysis={analysis}
          shareLinks={shareLinks}
          incidentId={loggedIncidentId}

          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
