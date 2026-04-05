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
  getDoc,
  setDoc,
  updateDoc,
  increment,
  serverTimestamp
} from './firebase';
import { analyzeLegacyTech, SmeltAnalysis } from './services/geminiService';
import { SmeltLog, GlobalStats as GlobalStatsType } from './types';
import { SmelterCanvas, SmelterCanvasHandle } from './components/SmelterCanvas';
import { SmeltManifest } from './components/SmeltManifest';
import { GlobalStats } from './components/GlobalStats';
import { Camera, Upload, X, Zap, RotateCcw } from 'lucide-react';
import { handleFirestoreError, OperationType } from './lib/firestoreErrors';

// Audio
const flyInSound = new Howl({ src: ['/assets/audio/sfx-fly-in.wav'], loop: false, volume: 0.5 });
const fireSound = new Howl({ src: ['/assets/audio/sfx-smelt.wav'], loop: false, volume: 0.6 });
const purrSound = new Howl({ src: ['/assets/audio/sfx-purr.wav'], loop: true, volume: 0.4 });

export default function App() {
  const [logs, setLogs] = useState<SmeltLog[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStatsType>({ total_pixels_melted: 0 });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<SmeltAnalysis | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<SmelterCanvasHandle>(null);

  useEffect(() => {
    const logsQuery = query(collection(db, 'smelt_logs'), orderBy('timestamp', 'desc'), limit(10));
    const unsubscribeLogs = onSnapshot(logsQuery, (snapshot) => {
      const newLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SmeltLog));
      setLogs(newLogs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'smelt_logs');
    });

    const statsDoc = doc(db, 'global_stats', 'main');
    const unsubscribeStats = onSnapshot(statsDoc, (snapshot) => {
      if (snapshot.exists()) {
        setGlobalStats(snapshot.data() as GlobalStatsType);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'global_stats/main');
    });

    return () => {
      unsubscribeLogs();
      unsubscribeStats();
    };
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

      // Imperative: load image into canvas and start animation
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

    // Skip Firestore write on replay (isComplete already true)
    if (isComplete || !analysis) return;

    try {
      const logRef = doc(collection(db, 'smelt_logs'));
      await setDoc(logRef, {
        pixel_count: analysis.pixelCount,
        damage_report: analysis.damageReport,
        dominant_colors: analysis.dominantColors,
        legacy_infra_class: analysis.legacyInfraClass,
        cursed_dx: analysis.cursedDx,
        smelt_rating: analysis.smeltRating,
        palette_name: analysis.paletteName,
        og_headline: analysis.ogHeadline,
        og_description: analysis.ogDescription,
        share_quote: analysis.shareQuote,
        timestamp: serverTimestamp(),
        uid: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2)
      });

      const statsRef = doc(db, 'global_stats', 'main');
      await setDoc(statsRef, {
        total_pixels_melted: increment(analysis.pixelCount)
      }, { merge: true });

      setIsComplete(true);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'smelt_logs / global_stats');
    }
  };

  const handleReplay = () => {
    purrSound.stop();
    canvasRef.current?.replay();
  };

  return (
    <div className="min-h-screen flex flex-col bg-concrete text-ash-white font-sans">
      {/* Header */}
      <header className="p-6 border-b border-concrete-border bg-concrete-mid sticky top-0 z-50">
        <div className="max-w-7xl mx-auto w-full flex justify-between items-center">
          <h1 className="text-2xl font-black font-mono tracking-tighter uppercase">
            LEGACY <span className="text-hazard-amber">SMELTER</span>
          </h1>
          <div className="text-hazard-amber font-mono text-xs uppercase font-bold">
            [ ACCESS_GRANTED ]
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

          {/* Left Column: Smelter Area */}
          <div className="lg:col-span-7 space-y-4">
            {/* Controls — always visible */}
            <div className="flex gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="modern-button flex-1 flex items-center justify-center gap-2"
              >
                <Upload size={18} />
                UPLOAD
              </button>
              <button
                onClick={startCamera}
                className="modern-button flex-1 flex items-center justify-center gap-2 bg-concrete-mid text-ash-white border border-concrete-border hover:brightness-110"
              >
                <Camera size={18} />
                CAMERA
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
                    <p className="text-stone-gray font-mono text-xs uppercase">
                      INPUT LEGACY HARDWARE FOR SMELTING
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
                  <p className="text-hazard-amber font-mono text-xs uppercase animate-pulse">
                    GEMINI_VISION: ANALYZING_DECAY_PATTERNS...
                  </p>
                </div>
              )}
            </div>

            {/* Damage report + replay */}
            {isComplete && analysis && (
              <div className="modern-card p-6">
                <p className="text-ash-white font-mono text-sm leading-relaxed mb-4">
                  {analysis.damageReport}
                </p>
                <button
                  onClick={handleReplay}
                  className="modern-button flex items-center justify-center gap-2"
                >
                  <RotateCcw size={18} />
                  REPLAY SMELT
                </button>
              </div>
            )}
          </div>

          {/* Right Column: Stats & Feed */}
          <div className="lg:col-span-5 space-y-8">
            <GlobalStats totalPixels={globalStats.total_pixels_melted} />
            <SmeltManifest logs={logs} />
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="p-6 bg-concrete-mid border-t border-concrete-border mt-auto">
        <div className="max-w-7xl mx-auto w-full flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs font-mono text-dead-gray uppercase tracking-widest">
            &copy; 2026 Ashley Childress
          </p>
          <p className="text-xs font-mono text-dead-gray uppercase tracking-widest">
            Powered by Gemini | Built with Google AI Studio, Gemini &amp; Claude
          </p>
        </div>
      </footer>
    </div>
  );
}
