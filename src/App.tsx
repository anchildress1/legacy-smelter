import React, { useState, useEffect, useRef } from 'react';
import { Howl } from 'howler';
import {
  db,
  collection,
  onSnapshot,
  query,
  orderBy,
  limit,
  doc,
  setDoc,
  increment,
  serverTimestamp
} from './firebase';
import { analyzeLegacyTech, SmeltAnalysis } from './services/geminiService';
import { GlobalStats as GlobalStatsType, SmeltLog } from './types';
import { SmelterCanvas, SmelterCanvasHandle } from './components/SmelterCanvas';
import { IncidentReportOverlay } from './components/IncidentReportOverlay';
import { formatPixels, getFiveDistinctColors, getLogShareLinks } from './lib/utils';
import { Camera, Upload, X, Flame, RotateCcw, ArrowRight } from 'lucide-react';
import { handleFirestoreError, OperationType } from './lib/firestoreErrors';

// Audio
const flyInSound = new Howl({ src: ['/assets/audio/sfx-fly-in.wav'], loop: false, volume: 0.5 });
const fireSound = new Howl({ src: ['/assets/audio/sfx-smelt.wav'], loop: false, volume: 0.6 });
const purrSound = new Howl({ src: ['/assets/audio/sfx-purr.wav'], loop: false, volume: 0.4 });

interface AppProps {
  onNavigateManifest: () => void;
}

export default function App({ onNavigateManifest }: AppProps) {
  const [globalStats, setGlobalStats] = useState<GlobalStatsType>({ total_pixels_melted: 0 });
  const [recentLogs, setRecentLogs] = useState<SmeltLog[]>([]);
  const [selectedRecentLog, setSelectedRecentLog] = useState<SmeltLog | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [loadingPostMortem, setLoadingPostMortem] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<SmeltAnalysis | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<SmelterCanvasHandle>(null);
  const activeRequestIdRef = useRef(0);
  const analysisRef = useRef<SmeltAnalysis | null>(null);

  useEffect(() => {
    const statsDoc = doc(db, 'global_stats', 'main');
    const unsubStats = onSnapshot(statsDoc, (snapshot) => {
      if (snapshot.exists()) {
        setGlobalStats(snapshot.data() as GlobalStatsType);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'global_stats/main');
    });

    const logsQuery = query(
      collection(db, 'incident_logs'),
      orderBy('timestamp', 'desc'),
      limit(3)
    );
    const unsubLogs = onSnapshot(logsQuery, (snapshot) => {
      const entries = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SmeltLog));
      setRecentLogs(entries);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'incident_logs');
    });

    return () => { unsubStats(); unsubLogs(); };
  }, []);

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
        cameraInputRef.current?.click();
      } else {
        console.error(`[App] Camera unavailable (${name || 'unknown'}):`, err);
        setAnalysisError('CAMERA UNAVAILABLE. USE THE PROCESS ARTIFACT BUTTON INSTEAD.');
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
        setAnalysisError('CAMERA CAPTURE FAILED. USE THE PROCESS ARTIFACT BUTTON INSTEAD.');
        stopCamera();
      }
    }
  };

  const processImage = async (base64: string, mimeType: string) => {
    const requestId = ++activeRequestIdRef.current;

    if (import.meta.env.DEV) console.log("Processing image...", mimeType);
    setCurrentImage(base64);
    setIsComplete(false);
    setShowReport(false);
    setSelectedRecentLog(null);
    setAnalysisError(null);
    setAnalysis(null);
    analysisRef.current = null;
    setLoadingPostMortem(false);
    setIsPlaying(false);
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
      setAnalysisError('GEMINI ANALYSIS FAILED. CHECK API KEY AND RETRY.');
      return;
    }

    if (requestId !== activeRequestIdRef.current) return;
    if (import.meta.env.DEV) console.log("Analysis complete:", result);
    setAnalysis(result);
    analysisRef.current = result;
    setIsAnalyzing(false);

    await canvasRef.current?.loadAndSmelt(base64, result.subjectBox, result.dominantColors);
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
    if (isComplete || !completedAnalysis) return;

    setLoadingPostMortem(true);

    try {
      const colors = completedAnalysis.dominantColors;
      const box = completedAnalysis.subjectBox;
      const logRef = doc(collection(db, 'incident_logs'));
      await setDoc(logRef, {
        pixel_count: completedAnalysis.pixelCount,
        incident_feed_summary: completedAnalysis.incidentFeedSummary,
        color_1: colors[0] || '',
        color_2: colors[1] || '',
        color_3: colors[2] || '',
        color_4: colors[3] || '',
        color_5: colors[4] || '',
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
        uid: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2)
      });

      const statsRef = doc(db, 'global_stats', 'main');
      await setDoc(statsRef, {
        total_pixels_melted: increment(completedAnalysis.pixelCount)
      }, { merge: true });

      setIsComplete(true);

      setTimeout(() => {
        setLoadingPostMortem(false);
        setShowReport(true);
      }, 4500);
    } catch (error) {
      setLoadingPostMortem(false);
      handleFirestoreError(error, OperationType.WRITE, 'incident_logs / global_stats');
    }
  };

  const handleReplay = () => {
    purrSound.stop();
    setShowReport(false);
    setIsPlaying(true);
    canvasRef.current?.replay();
  };

  const shareLinks = analysis ? (() => {
    const shareText = `${analysis.shareQuote}\n\n${analysis.incidentFeedSummary}`;
    return [
      { label: 'POST TO X', href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}` },
      { label: 'POST TO REDDIT', href: `https://www.reddit.com/submit?title=${encodeURIComponent(analysis.ogHeadline)}&selftext=true&text=${encodeURIComponent(shareText)}` },
      { label: 'POST TO BLUESKY', href: `https://bsky.app/intent/compose?text=${encodeURIComponent(shareText)}` },
      { label: 'POST TO LINKEDIN', href: `https://www.linkedin.com/shareArticle?mini=true&title=${encodeURIComponent(analysis.ogHeadline)}&summary=${encodeURIComponent(shareText)}` },
    ];
  })() : [];

  const formatted = formatPixels(globalStats.total_pixels_melted);

  return (
    <div className="min-h-screen flex flex-col bg-concrete text-ash-white font-sans">
      <header className="border-b border-concrete-border bg-concrete-mid sticky top-0 z-50">
        <div className="max-w-7xl mx-auto w-full flex justify-between items-center px-6 py-4">
          <div>
            <h1 className="text-2xl font-black font-mono tracking-tighter uppercase">
              LEGACY <span className="text-hazard-amber">SMELTER</span>
            </h1>
            <p className="text-stone-gray font-mono text-[10px] uppercase tracking-widest mt-0.5">
              If a bug exists, apply Hotfix.
            </p>
          </div>
          <div className="flex items-center gap-4">
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
            <button
              onClick={onNavigateManifest}
              className="text-stone-gray hover:text-hazard-amber transition-colors flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber focus-visible:rounded"
            >
              INCIDENT MANIFEST
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">

          {/* Left Column: Smelter Area */}
          <div className="md:col-span-7 space-y-4">
            {/* Controls */}
            <div className="flex gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="modern-button flex-1 flex items-center justify-center gap-2"
              >
                <Upload size={18} />
                PROCESS ARTIFACT
              </button>
              <button
                onClick={startCamera}
                className="modern-button flex-1 flex items-center justify-center gap-2 bg-concrete-mid text-ash-white border border-concrete-border hover:brightness-110"
              >
                <Camera size={18} />
                DEPLOY SCANNER
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
                  <video ref={videoRef} playsInline className="w-full h-full object-cover" />
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
                    GEMINI_VISION: ANALYZING_DECAY_PATTERNS...
                  </p>
                </div>
              )}

              {/* Loading post-mortem overlay */}
              {loadingPostMortem && !showReport && (
                <div className="absolute inset-x-0 bottom-0 z-40 flex items-end justify-center pb-6">
                  <div className="bg-concrete/90 backdrop-blur-sm px-6 py-3 rounded border border-concrete-border">
                    <p className="text-hazard-amber font-mono text-xs uppercase animate-pulse tracking-widest">
                      COMPILING INCIDENT POSTMORTEM // STAND BY
                    </p>
                  </div>
                </div>
              )}

              {/* Post-smelt controls — replay + view report */}
              {isComplete && !loadingPostMortem && !isPlaying && (
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

          {/* Right Column: Recent Incidents */}
          <div className="md:col-span-5">
            <div>
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-hazard-amber font-mono text-xs md:text-sm uppercase tracking-wide md:tracking-widest font-bold">
                  RECENT INCIDENTS
                </h2>
                <button
                  onClick={onNavigateManifest}
                  className="text-stone-gray hover:text-hazard-amber transition-colors font-mono text-xs md:text-[10px] uppercase tracking-wide md:tracking-wider"
                >
                  VIEW ALL
                </button>
              </div>
              <div className="space-y-3">
                {recentLogs.map((log, index) => {
                  const fmt = formatPixels(log.pixel_count);
                  const rawColors = [log.color_1, log.color_2, log.color_3, log.color_4, log.color_5];
                  const finalColors = getFiveDistinctColors(rawColors);
                  const visibilityClass = index === 0 ? 'flex' : 'hidden md:flex';

                  return (
                    <button
                      key={log.id}
                      onClick={() => setSelectedRecentLog(log)}
                      className={`modern-card relative overflow-hidden w-full text-left hover:border-hazard-amber/40 transition-colors cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hazard-amber ${visibilityClass}`}
                      aria-label={`Open incident report: ${log.legacy_infra_class || log.incident_feed_summary}`}
                    >
                      {/* Color strip */}
                      <div className="w-2 shrink-0 flex flex-col" aria-hidden="true">
                        {finalColors.map((col, idx) => (
                          <div key={idx} className="flex-1" style={{ backgroundColor: col }} />
                        ))}
                      </div>
                      <div className="p-4 flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-4">
                          <div className="min-w-0 flex-1">
                            {log.legacy_infra_class && (
                              <p className="text-hazard-amber font-mono text-xs uppercase tracking-wide md:tracking-widest">
                                {log.legacy_infra_class}
                              </p>
                            )}
                            <p className="text-ash-white font-mono text-sm leading-snug mt-1 line-clamp-2">
                              {log.incident_feed_summary}
                            </p>
                          </div>
                          <span className="text-stone-gray group-hover:text-hazard-amber font-mono text-xs uppercase tracking-wide shrink-0 mt-1 transition-colors">
                            INSPECT
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 items-end">
                          <span className="text-hazard-amber font-mono text-xs font-bold">
                            {fmt.value} {fmt.unit} THERMALLY DECOMMISSIONED
                          </span>
                          {log.severity && (
                            <span className="text-stone-gray font-mono text-xs">
                              {log.severity}
                            </span>
                          )}
                          <span className="text-stone-gray font-mono text-xs ml-auto">
                            {log.timestamp?.toDate
                              ? new Date(log.timestamp.toDate()).toLocaleString()
                              : '—'}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
                {recentLogs.length === 0 && (
                  <div className="modern-card p-12 text-center">
                    <Flame size={32} className="text-hazard-amber mx-auto mb-3" />
                    <p className="text-stone-gray font-mono text-xs uppercase tracking-wider">
                      NO INCIDENTS ON RECORD.
                    </p>
                    <div className="flex gap-2 items-center justify-center mt-3">
                      <div className="w-2 h-2 rounded-full bg-coolant-green animate-pulse" />
                      <span className="text-[10px] font-mono text-stone-gray uppercase">
                        HOTFIX STATUS: PENDING
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="p-6 bg-concrete-mid border-t border-concrete-border mt-auto">
        <div className="max-w-7xl mx-auto w-full flex flex-col md:flex-row justify-between items-center gap-4">
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
          onClose={() => setSelectedRecentLog(null)}
        />
      )}

      {showReport && analysis && (
        <IncidentReportOverlay
          analysis={analysis}
          shareLinks={shareLinks}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
