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
import { SmelterCanvas } from './components/SmelterCanvas';
import { SmeltManifest } from './components/SmeltManifest';
import { GlobalStats } from './components/GlobalStats';
import { Camera, Upload, X, Zap } from 'lucide-react';
import { cn } from './lib/utils';
import { handleFirestoreError, OperationType } from './lib/firestoreErrors';

// Audio Assets (Local)
const fireSound = new Howl({ src: ['/assets/audio/sfx-smelt.wav'], loop: false, volume: 0.6 });
const sizzleSound = new Howl({ src: ['/assets/audio/sfx-purr.wav'], loop: true, volume: 0.4 });
const flyInSound = new Howl({ src: ['/assets/audio/sfx-fly-in.wav'], volume: 0.8 });

export default function App() {
  const [logs, setLogs] = useState<SmeltLog[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStatsType>({ total_pixels_melted: 0 });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isMelting, setIsMelting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<SmeltAnalysis | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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
      // Fallback to native input capture if getUserMedia fails
      cameraInputRef.current?.click();
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
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
    console.log("Processing image...", mimeType);
    setCurrentImage(base64);
    setIsComplete(false);
    setIsAnalyzing(true);
    sizzleSound.stop();
    fireSound.stop();
    
    try {
      const base64Data = base64.split(',')[1];
      console.log("Analyzing with Gemini...");
      const result = await analyzeLegacyTech(base64Data, mimeType);
      console.log("Analysis complete:", result);
      setAnalysis(result);
      setIsAnalyzing(false);
      startSmelt();
    } catch (error) {
      console.error("Analysis failed", error);
      setIsAnalyzing(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // Reset input so same file can be selected again

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      processImage(base64, file.type);
    };
    reader.readAsDataURL(file);
  };

  const startSmelt = () => {
    console.log("Starting smelt animation...");
    setIsMelting(true);
    fireSound.play();
  };

  const handleSmeltComplete = async () => {
    console.log("Smelt complete, saving to Firestore...");
    setIsMelting(false);
    fireSound.stop();
    sizzleSound.play();

    if (!analysis) return;

    try {
      // Update Firestore
      const logRef = doc(collection(db, 'smelt_logs'));
      await setDoc(logRef, {
        pixel_count: analysis.pixelCount,
        damage_report: analysis.damageReport,
        dominant_colors: analysis.dominantColors,
        timestamp: serverTimestamp(),
        uid: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2)
      });

      const statsRef = doc(db, 'global_stats', 'main');
      await setDoc(statsRef, {
        total_pixels_melted: increment(analysis.pixelCount)
      }, { merge: true });

      setIsComplete(true);
      console.log("Final state updated: isComplete=true");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'smelt_logs / global_stats');
    }
  };


  return (
    <div className="min-h-screen flex flex-col bg-concrete text-zinc-100 font-sans">
      {/* Header */}
      <header className="p-6 border-b border-zinc-800 bg-concrete-light sticky top-0 z-50">
        <div className="max-w-7xl mx-auto w-full flex justify-between items-center">
          <h1 className="text-2xl font-black font-mono tracking-tighter uppercase">
            LEGACY <span className="text-hazard-yellow">SMELTER</span>
          </h1>
          <div className="text-steel-blue font-mono text-xs uppercase font-bold">
            [ ACCESS_GRANTED ]
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Smelter Area */}
          <div className="lg:col-span-7 space-y-6">
            <div className="modern-card aspect-video relative flex items-center justify-center overflow-hidden">
              {isCameraActive ? (
                <div className="w-full h-full relative bg-black">
                  <video 
                    ref={videoRef} 
                    playsInline 
                    className="w-full h-full object-cover"
                  />
                  <button 
                    onClick={stopCamera}
                    className="absolute top-4 right-4 w-10 h-10 bg-zinc-900/80 rounded-full flex items-center justify-center text-zinc-400 hover:text-white z-50"
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
              ) : !currentImage ? (
                <div className="text-center p-8 w-full max-w-md">
                  <div className="mb-6 flex justify-center">
                    <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center">
                      <Zap className="text-hazard-yellow" size={32} />
                    </div>
                  </div>
                  <p className="text-zinc-400 font-mono text-sm uppercase mb-8">
                    INPUT LEGACY HARDWARE FOR SMELTING
                  </p>
                  <div className="flex flex-col sm:flex-row gap-4 w-full">
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="modern-button flex-1 flex items-center justify-center gap-2"
                    >
                      <Upload size={20} />
                      UPLOAD
                    </button>
                    <button 
                      onClick={startCamera}
                      className="modern-button flex-1 flex items-center justify-center gap-2 bg-zinc-800 text-zinc-100 border-zinc-700 hover:bg-zinc-700"
                    >
                      <Camera size={20} />
                      CAMERA
                    </button>
                  </div>
                </div>
              ) : (
                <div className="w-full h-full relative">
                  <SmelterCanvas 
                    image={currentImage} 
                    isMelting={isMelting} 
                    onComplete={handleSmeltComplete}
                    colors={analysis?.dominantColors || []}
                    subjectBox={analysis?.subjectBox || null}
                  />
                  
                  {isAnalyzing && (
                    <div className="absolute inset-0 bg-concrete/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-40">
                      <div className="w-12 h-12 border-4 border-steel-blue border-t-transparent rounded-full animate-spin mb-4" />
                      <p className="text-steel-blue font-mono text-xs uppercase animate-pulse">
                        GEMINI_VISION: ANALYZING_DECAY_PATTERNS...
                      </p>
                    </div>
                  )}
                </div>
              )}
              {/* HIDDEN INPUTS MOVED HERE */}
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileSelect} 
                className="hidden" 
                accept="image/*"
              />
              <input 
                type="file" 
                ref={cameraInputRef} 
                onChange={handleFileSelect} 
                className="hidden" 
                accept="image/*"
                capture="environment"
              />
            </div>

            {isComplete && analysis && !isMelting && (
              <div className="modern-card p-6">
                <p className="text-zinc-300 font-mono text-sm mb-6 leading-relaxed">
                  {analysis.damageReport}
                </p>
                <div className="flex flex-col sm:flex-row gap-4">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="modern-button flex-1 flex items-center justify-center gap-2"
                  >
                    <Upload size={18} />
                    UPLOAD ANOTHER
                  </button>
                  <button 
                    onClick={startCamera}
                    className="modern-button flex-1 flex items-center justify-center gap-2 bg-zinc-800 text-zinc-100 border-zinc-700 hover:bg-zinc-700"
                  >
                    <Camera size={18} />
                    CAPTURE NEW
                  </button>
                </div>
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
      <footer className="p-6 bg-concrete-light border-t border-zinc-800 mt-auto">
        <div className="max-w-7xl mx-auto w-full flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest">
            © 2026 Ashley Childress
          </p>
          <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest">
            Powered by <span className="text-steel-blue">Gemini</span> & <span className="text-hazard-yellow">Google AI Studio</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

