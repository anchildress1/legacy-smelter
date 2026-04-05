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
import { formatPixels, getFiveDistinctColors } from './lib/utils';
import { Camera, Upload, X, Zap, RotateCcw, ScrollText } from 'lucide-react';
import { handleFirestoreError, OperationType } from './lib/firestoreErrors';

// Audio
const flyInSound = new Howl({ src: ['/assets/audio/sfx-fly-in.wav'], loop: false, volume: 0.5 });
const fireSound = new Howl({ src: ['/assets/audio/sfx-smelt.wav'], loop: false, volume: 0.6 });
const purrSound = new Howl({ src: ['/assets/audio/sfx-purr.wav'], loop: true, volume: 0.4 });

interface AppProps {
  onNavigateManifest: () => void;
}

export default function App({ onNavigateManifest }: AppProps) {
  const [globalStats, setGlobalStats] = useState<GlobalStatsType>({ total_pixels_melted: 0 });
  const [recentLogs, setRecentLogs] = useState<SmeltLog[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
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
      collection(db, 'smelt_logs'),
      orderBy('timestamp', 'desc'),
      limit(3)
    );
    const unsubLogs = onSnapshot(logsQuery, (snapshot) => {
      const entries = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SmeltLog));
      setRecentLogs(entries);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'smelt_logs');
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
      console.error("Camera access denied", err);
      cameraInputRef.current?.click();
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
      }
    }
  };

  const processImage = async (base64: string, mimeType: string) => {
    if (import.meta.env.DEV) console.log("Processing image...", mimeType);
    setCurrentImage(base64);
    setIsComplete(false);
    setShowReport(false);
    setLoadingPostMortem(false);
    setIsPlaying(false);
    setIsAnalyzing(true);
    flyInSound.stop();
    fireSound.stop();
    purrSound.stop();

    try {
      const base64Data = base64.split(',')[1];
      const result = await analyzeLegacyTech(base64Data, mimeType);
      if (import.meta.env.DEV) console.log("Analysis complete:", result);
      setAnalysis(result);
      setIsAnalyzing(false);

      await canvasRef.current?.loadAndSmelt(base64, result.subjectBox, result.dominantColors);
    } catch (error) {
      console.error("Analysis failed", error);
      setIsAnalyzing(false);
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
    reader.readAsDataURL(file);
  };

  const handleSmeltComplete = async () => {
    if (import.meta.env.DEV) console.log("Smelt complete");
    fireSound.stop();
    purrSound.play();
    setIsPlaying(false);

    if (isComplete || !analysis) return;

    setLoadingPostMortem(true);

    try {
      const colors = analysis.dominantColors;
      const box = analysis.subjectBox;
      const logRef = doc(collection(db, 'smelt_logs'));
      await setDoc(logRef, {
        pixel_count: analysis.pixelCount,
        damage_report: analysis.damageReport,
        color_1: colors[0] || '',
        color_2: colors[1] || '',
        color_3: colors[2] || '',
        color_4: colors[3] || '',
        color_5: colors[4] || '',
        subject_box_ymin: box[0] ?? 100,
        subject_box_xmin: box[1] ?? 100,
        subject_box_ymax: box[2] ?? 900,
        subject_box_xmax: box[3] ?? 900,
        legacy_infra_class: analysis.legacyInfraClass,
        legacy_infra_description: analysis.legacyInfraDescription,
        visual_summary: analysis.visualSummary,
        confidence: analysis.confidence,
        palette_name: analysis.paletteName,
        cursed_dx: analysis.cursedDx,
        smelt_rating: analysis.smeltRating,
        dominant_contamination: analysis.dominantContamination,
        secondary_contamination: analysis.secondaryContamination,
        root_cause: analysis.rootCause,
        salvageability: analysis.salvageability,
        museum_caption: analysis.museumCaption,
        og_headline: analysis.ogHeadline,
        og_description: analysis.ogDescription,
        share_quote: analysis.shareQuote,
        anon_handle: analysis.anonHandle,
        timestamp: serverTimestamp(),
        uid: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2)
      });

      const statsRef = doc(db, 'global_stats', 'main');
      await setDoc(statsRef, {
        total_pixels_melted: increment(analysis.pixelCount)
      }, { merge: true });

      setIsComplete(true);

      setTimeout(() => {
        setLoadingPostMortem(false);
        setShowReport(true);
      }, 2200);
    } catch (error) {
      setLoadingPostMortem(false);
      handleFirestoreError(error, OperationType.WRITE, 'smelt_logs / global_stats');
    }
  };

  const handleReplay = () => {
    purrSound.stop();
    setShowReport(false);
    setIsPlaying(true);
    canvasRef.current?.replay();
  };

  const getShareText = () => {
    if (!analysis) return '';
    return `${analysis.shareQuote}\n\n${analysis.damageReport}`;
  };

  const shareLinks = analysis ? [
    { label: 'X', href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(getShareText())}` },
    { label: 'REDDIT', href: `https://www.reddit.com/submit?title=${encodeURIComponent(analysis.ogHeadline)}&selftext=true&text=${encodeURIComponent(getShareText())}` },
    { label: 'BLUESKY', href: `https://bsky.app/intent/compose?text=${encodeURIComponent(getShareText())}` },
    { label: 'LINKEDIN', href: `https://www.linkedin.com/shareArticle?mini=true&title=${encodeURIComponent(analysis.ogHeadline)}&summary=${encodeURIComponent(getShareText())}` },
  ] : [];

  const formatted = formatPixels(globalStats.total_pixels_melted);

  return (
    <div className="min-h-screen flex flex-col bg-concrete text-ash-white font-sans">
      {/* Header — clean original style */}
      <header className="border-b border-concrete-border bg-concrete-mid sticky top-0 z-50">
        <div className="max-w-7xl mx-auto w-full flex justify-between items-center px-6 py-4">
          <h1 className="text-2xl font-black font-mono tracking-tighter uppercase">
            LEGACY <span className="text-hazard-amber">SMELTER</span>
          </h1>
          <div className="flex items-center gap-4">
            <button
              onClick={onNavigateManifest}
              className="text-stone-gray hover:text-hazard-amber transition-colors flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider"
            >
              <ScrollText size={14} />
              INCIDENT MANIFEST
            </button>
            <span className="text-stone-gray font-mono text-xs tracking-widest hidden sm:inline">
              [ ACCESS_GRANTED ]
            </span>
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
                SUBMIT ARTIFACT
              </button>
              <button
                onClick={startCamera}
                className="modern-button flex-1 flex items-center justify-center gap-2 bg-concrete-mid text-ash-white border border-concrete-border hover:brightness-110"
              >
                <Camera size={18} />
                DEPLOY FIELD SCANNER
              </button>
            </div>

            {/* Hidden file inputs */}
            <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="image/*" />
            <input type="file" ref={cameraInputRef} onChange={handleFileSelect} className="hidden" accept="image/*" capture="environment" />

            {/* Animation Window */}
            <div className="modern-card aspect-video relative overflow-hidden bg-concrete">
              {/* Camera overlay */}
              {isCameraActive && (
                <div className="absolute inset-0 bg-black z-30">
                  <video ref={videoRef} playsInline className="w-full h-full object-cover" />
                  <button
                    onClick={stopCamera}
                    className="absolute top-4 right-4 w-10 h-10 bg-concrete-mid/80 rounded-full flex items-center justify-center text-stone-gray hover:text-ash-white z-50"
                  >
                    <X size={20} />
                  </button>
                  <div className="absolute bottom-6 left-0 w-full flex justify-center z-50">
                    <button
                      onClick={captureImage}
                      className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center bg-white/20 hover:bg-white/40 backdrop-blur-sm transition-all"
                    >
                      <div className="w-12 h-12 bg-white rounded-full" />
                    </button>
                  </div>
                </div>
              )}

              {/* Empty state */}
              {!currentImage && !isCameraActive && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <Zap className="text-hazard-amber mx-auto mb-3" size={32} />
                    <p className="text-stone-gray font-mono text-xs uppercase tracking-wider">
                      FURNACE IDLE // AWAITING CONDEMNED INFRASTRUCTURE
                    </p>
                  </div>
                </div>
              )}

              {/* PixiJS Canvas */}
              {currentImage && (
                <SmelterCanvas
                  ref={canvasRef}
                  onComplete={handleSmeltComplete}
                  onFlyInStart={() => flyInSound.play()}
                  onFireStart={() => { flyInSound.stop(); fireSound.play(); }}
                />
              )}

              {/* Analyzing overlay */}
              {isAnalyzing && (
                <div className="absolute inset-0 bg-concrete/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-40">
                  <div className="w-12 h-12 border-4 border-hazard-amber border-t-transparent rounded-full animate-spin mb-4" />
                  <p className="text-hazard-amber font-mono text-xs uppercase animate-pulse tracking-wider">
                    GEMINI_CORE: SCANNING CONDEMNED INFRASTRUCTURE...
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
                <div className="absolute inset-0 z-40 flex items-center justify-center gap-3">
                  <button
                    onClick={handleReplay}
                    className="modern-button flex items-center gap-2 text-sm bg-concrete/80 text-hazard-amber border border-concrete-border backdrop-blur-sm hover:bg-concrete/90"
                  >
                    <RotateCcw size={16} aria-hidden="true" />
                    REPLAY
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
          </div>

          {/* Right Column: Global Stats + Recent Incidents */}
          <div className="md:col-span-5 space-y-4">
            {/* Stats card — compact inline below md, full card at md+ */}
            <div className="modern-card relative overflow-hidden">
              <div className="hazard-stripe h-1.5 w-full" />
              <div className="p-4 md:p-5">
                <h2 className="text-hazard-amber font-mono text-[10px] uppercase tracking-widest mb-1">
                  CUMULATIVE THERMAL DESTRUCTION INDEX
                </h2>
                <div className="flex items-baseline gap-3 md:block">
                  <div className="text-3xl md:text-4xl font-extrabold font-mono text-hazard-amber tracking-tighter">
                    {formatted.value}
                    <span className="text-sm ml-2 text-stone-gray">{formatted.unit}</span>
                  </div>
                  {/* Status line — inline on narrow, block on md+ */}
                  <div className="flex gap-2 items-center md:mt-4">
                    <div className="w-2 h-2 rounded-full bg-coolant-green animate-pulse" />
                    <div className="text-[10px] font-mono text-stone-gray uppercase hidden md:block">
                      FURNACE STATUS: NOMINAL // AWAITING DIRECTIVES
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent incidents — hidden below md to save vertical space in embed/stacked view */}
            <div className="hidden md:block">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-hazard-amber font-mono text-sm uppercase tracking-widest font-bold">
                  RECENT INCIDENTS
                </h2>
                <button
                  onClick={onNavigateManifest}
                  className="text-stone-gray hover:text-hazard-amber transition-colors font-mono text-[10px] uppercase tracking-wider"
                >
                  VIEW ALL
                </button>
              </div>
              <div className="space-y-3">
                {recentLogs.map((log) => {
                  const fmt = formatPixels(log.pixel_count);
                  const rawColors = [log.color_1, log.color_2, log.color_3, log.color_4, log.color_5];
                  const finalColors = getFiveDistinctColors(rawColors);

                  return (
                    <div
                      key={log.id}
                      className="modern-card relative overflow-hidden flex"
                    >
                      {/* Color strip */}
                      <div className="w-2 shrink-0 flex flex-col" aria-hidden="true">
                        {finalColors.map((col, idx) => (
                          <div key={idx} className="flex-1" style={{ backgroundColor: col }} />
                        ))}
                      </div>
                      <div className="p-3 flex-1 min-w-0">
                        {log.legacy_infra_class && (
                          <p className="text-hazard-amber font-mono text-[10px] uppercase tracking-widest">
                            {log.legacy_infra_class}
                          </p>
                        )}
                        <p className="text-ash-white font-mono text-xs leading-snug mt-0.5 line-clamp-2">
                          {log.damage_report}
                        </p>
                        <div className="mt-1.5 flex justify-between items-end">
                          <span className="text-hazard-amber font-mono text-[10px] font-bold">
                            {fmt.value} {fmt.unit}
                          </span>
                          <span className="text-dead-gray font-mono text-[10px]">
                            {log.timestamp?.toDate
                              ? new Date(log.timestamp.toDate()).toLocaleTimeString()
                              : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {recentLogs.length === 0 && (
                  <div className="text-dead-gray font-mono text-center py-6 italic text-xs">
                    NO INCIDENTS ON RECORD. FURNACE IDLE.
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
