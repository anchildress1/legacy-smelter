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
import { Camera, Upload, Trash2, ShieldAlert, Zap } from 'lucide-react';
import { cn } from './lib/utils';
import { handleFirestoreError, OperationType } from './lib/firestoreErrors';

// Audio Assets (Placeholders)
const fireSound = new Howl({ src: ['https://www.soundjay.com/free-music/sounds/fire-1.mp3'], loop: true });
const sizzleSound = new Howl({ src: ['https://www.soundjay.com/mechanical/sounds/sizzling-1.mp3'], loop: true });

export default function App() {
  const [logs, setLogs] = useState<SmeltLog[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStatsType>({ total_pixels_melted: 0 });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isMelting, setIsMelting] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<SmeltAnalysis | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setCurrentImage(base64);
      setIsAnalyzing(true);
      
      try {
        const base64Data = base64.split(',')[1];
        const result = await analyzeLegacyTech(base64Data, file.type);
        setAnalysis(result);
      } catch (error) {
        console.error("Analysis failed", error);
      } finally {
        setIsAnalyzing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const startSmelt = () => {
    if (!analysis) return;
    setIsMelting(true);
    fireSound.play();
    sizzleSound.play();
  };

  const handleSmeltComplete = async () => {
    setIsMelting(false);
    fireSound.stop();
    sizzleSound.stop();

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

      // Reset
      setCurrentImage(null);
      setAnalysis(null);
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
              {!currentImage ? (
                <div className="text-center p-8">
                  <div className="mb-6 flex justify-center">
                    <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center">
                      <Zap className="text-hazard-yellow" size={32} />
                    </div>
                  </div>
                  <p className="text-zinc-400 font-mono text-sm uppercase mb-6">
                    INPUT LEGACY HARDWARE FOR SMELTING
                  </p>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="modern-button w-full flex items-center justify-center gap-2"
                  >
                    <Upload size={20} />
                    UPLOAD_TARGET
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileSelect} 
                    className="hidden" 
                    accept="image/*"
                  />
                </div>
              ) : (
                <div className="w-full h-full relative">
                  <SmelterCanvas 
                    image={currentImage} 
                    isMelting={isMelting} 
                    onComplete={handleSmeltComplete}
                    colors={analysis?.dominantColors || []}
                  />
                  
                  {isAnalyzing && (
                    <div className="absolute inset-0 bg-concrete/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
                      <div className="w-12 h-12 border-4 border-steel-blue border-t-transparent rounded-full animate-spin mb-4" />
                      <p className="text-steel-blue font-mono text-xs uppercase animate-pulse">
                        GEMINI_VISION: ANALYZING_DECAY_PATTERNS...
                      </p>
                    </div>
                  )}

                  {analysis && !isMelting && (
                    <div className="absolute bottom-0 left-0 w-full p-6 bg-concrete-light/95 backdrop-blur-md border-t border-zinc-700">
                      <p className="text-zinc-300 font-mono text-sm mb-4 leading-relaxed">
                        {analysis.damageReport}
                      </p>
                      <button 
                        onClick={startSmelt}
                        className="modern-button w-full"
                      >
                        INITIATE_SMELT
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
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
