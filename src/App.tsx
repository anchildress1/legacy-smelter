import React, { useState, useEffect, useRef } from 'react';
import { Howl } from 'howler';
import { 
  db, 
  auth, 
  signInAnonymously, 
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
import { SlagManifest } from './components/SlagManifest';
import { GlobalStats } from './components/GlobalStats';
import { Camera, Upload, Trash2, ShieldAlert, Zap } from 'lucide-react';
import { cn } from './lib/utils';
import { handleFirestoreError, OperationType } from './lib/firestoreErrors';

// Audio Assets (Placeholders)
const fireSound = new Howl({ src: ['https://www.soundjay.com/free-music/sounds/fire-1.mp3'], loop: true });
const sizzleSound = new Howl({ src: ['https://www.soundjay.com/mechanical/sounds/sizzling-1.mp3'], loop: true });

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [logs, setLogs] = useState<SmeltLog[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStatsType>({ total_pixels_melted: 0 });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isMelting, setIsMelting] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<SmeltAnalysis | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribeAuth = auth.onAuthStateChanged((u) => {
      if (u) {
        setUser(u);
      } else {
        signInAnonymously(auth).catch(console.error);
      }
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    const logsQuery = query(collection(db, 'smelt_logs'), orderBy('timestamp', 'desc'), limit(5));
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
        uid: user?.uid || 'anonymous'
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
    <div className="min-h-screen flex flex-col max-w-md mx-auto relative bg-concrete overflow-x-hidden">
      {/* Header */}
      <header className="p-6 border-b-4 border-white bg-black sticky top-0 z-50">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-black font-mono text-white tracking-tighter uppercase">
            THE LEGACY <span className="text-neon-pink">SMELTER</span>
          </h1>
          <div className="text-acid-green font-mono text-xs uppercase font-bold">
            [ ACCESS_GRANTED ]
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 space-y-8">
        {/* Global Stats */}
        <GlobalStats totalPixels={globalStats.total_pixels_melted} />

        {/* Smelter Area */}
        <div className="brutalist-card aspect-square relative bg-[#0a0a0a] flex items-center justify-center overflow-hidden">
          {!currentImage ? (
            <div className="text-center p-8">
              <div className="mb-6 flex justify-center">
                <div className="w-16 h-16 border-4 border-dashed border-gray-600 flex items-center justify-center">
                  <Zap className="text-gray-600" size={32} />
                </div>
              </div>
              <p className="text-gray-500 font-mono text-xs uppercase mb-6">
                INPUT LEGACY HARDWARE FOR DESTRUCTION
              </p>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="brutalist-button w-full flex items-center justify-center gap-2"
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
                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center p-6 text-center">
                  <div className="w-12 h-12 border-4 border-acid-green border-t-transparent rounded-full animate-spin mb-4" />
                  <p className="text-acid-green font-mono text-xs uppercase animate-pulse">
                    GEMINI_VISION: ANALYZING_DECAY_PATTERNS...
                  </p>
                </div>
              )}

              {analysis && !isMelting && (
                <div className="absolute bottom-0 left-0 w-full p-4 bg-black/90 border-t-4 border-neon-pink">
                  <p className="text-acid-green font-mono text-xs mb-4 leading-tight">
                    {analysis.damageReport}
                  </p>
                  <button 
                    onClick={startSmelt}
                    className="brutalist-button w-full bg-neon-pink text-white border-white"
                  >
                    INITIATE_SMELT
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Public Feed */}
        <SlagManifest logs={logs} />
      </main>

      {/* Footer / Hazard Stripe */}
      <footer className="p-4 bg-black border-t-4 border-white">
        <div className="hazard-stripe h-6 w-full mb-4" />
        <p className="text-[10px] font-mono text-gray-500 text-center uppercase tracking-widest">
          © 2026 BLAST_BUNKER_SYSTEMS // ALL_LEGACY_REDUCED_TO_SLAG
        </p>
      </footer>
    </div>
  );
}
