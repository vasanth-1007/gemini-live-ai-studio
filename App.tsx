import React, { useState, useEffect, useRef } from 'react';
import { useLiveGemini } from './hooks/useLiveGemini';
import { ConnectionState, DocumentFile, TranscriptionItem } from './types';
import FileUploader from './components/FileUploader';
import Visualizer from './components/Visualizer';

const App: React.FC = () => {
  const [documentFile, setDocumentFile] = useState<DocumentFile | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptionItem[]>([]);
  const [volume, setVolume] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcripts
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  const onTranscription = (item: TranscriptionItem) => {
    setTranscripts(prev => [...prev, item]);
  };

  const systemInstruction = documentFile 
    ? `You are an intelligent voice assistant. You have access to the following document provided by the user. Your answers must be based on this document content. 
       
       DOCUMENT TITLE: ${documentFile.name}
       DOCUMENT CONTENT:
       ${documentFile.content}
       
       Answer concisely and conversationally.` 
    : "You are a helpful assistant. Please ask the user to upload a document to get started.";

  const apiKey = process.env.API_KEY || '';

  const { connect, disconnect, connectionState, error } = useLiveGemini({
    apiKey,
    systemInstruction,
    onTranscription,
    onVolumeChange: setVolume
  });

  const handleToggleConnection = () => {
    if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) {
      disconnect();
    } else {
      if (!documentFile) {
        alert("Please upload a document first (or continue without context if you prefer).");
      }
      connect();
    }
  };

  const isConnected = connectionState === ConnectionState.CONNECTED;
  const isConnecting = connectionState === ConnectionState.CONNECTING;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col md:flex-row overflow-hidden">
      
      {/* LEFT PANEL: Sidebar / Controls */}
      <aside className="w-full md:w-80 lg:w-96 bg-slate-950 border-r border-slate-800 p-6 flex flex-col gap-6 flex-shrink-0 z-10 shadow-2xl">
        
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
            Gemini Live DocuBot
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Real-time RAG with Gemini 2.5 Live
          </p>
        </div>

        {/* Step 1: Upload */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">1. Context</h2>
          <FileUploader 
            onFileLoaded={setDocumentFile} 
            disabled={isConnected || isConnecting}
            apiKey={apiKey}
          />
        </div>

        {/* Step 2: Controls */}
        <div className="space-y-3 mt-auto mb-6">
           <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">2. Connection</h2>
           
           <button
             onClick={handleToggleConnection}
             disabled={isConnecting}
             className={`w-full py-4 px-6 rounded-xl font-bold text-lg shadow-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-3
               ${isConnected 
                 ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/20' 
                 : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20'
               } ${isConnecting ? 'opacity-70 cursor-wait' : ''}`}
           >
             {isConnecting && (
               <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
               </svg>
             )}
             {isConnected ? 'End Conversation' : (isConnecting ? 'Connecting...' : 'Start Conversation')}
           </button>

           {error && (
             <p className="text-xs text-red-400 text-center">{error}</p>
           )}
        </div>

        {/* Visualizer (Small Preview) */}
        <div className="flex flex-col items-center justify-center p-4 bg-slate-900/50 rounded-xl border border-slate-800">
           <Visualizer isActive={isConnected} volume={volume} />
           <p className="text-xs text-slate-500 mt-2 font-mono">
             {isConnected ? 'LIVE SESSION ACTIVE' : 'READY TO CONNECT'}
           </p>
        </div>

      </aside>

      {/* RIGHT PANEL: Transcript / Chat Interface */}
      <main className="flex-1 flex flex-col relative bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-slate-900">
        
        {/* Top Bar */}
        <div className="h-16 border-b border-slate-800 flex items-center px-6 bg-slate-900/80 backdrop-blur-md sticky top-0 z-10">
          <div className={`w-3 h-3 rounded-full mr-3 ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-slate-600'}`}></div>
          <span className="text-sm font-medium text-slate-300">
            {isConnected ? 'Listening & Speaking' : 'Offline'}
          </span>
          <div className="ml-auto text-xs text-slate-500">
             Using gemini-2.5-flash-native-audio-preview
          </div>
        </div>

        {/* Transcripts Area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
          {transcripts.length === 0 ? (
             <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50">
                <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                <p>Upload a doc and press Start to begin talking.</p>
             </div>
          ) : (
            transcripts.map((t) => (
              <div key={t.id} className={`flex ${t.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div 
                  className={`max-w-[80%] rounded-2xl p-4 shadow-sm ${
                    t.sender === 'user' 
                      ? 'bg-blue-600 text-white rounded-br-none' 
                      : 'bg-slate-800 border border-slate-700 text-slate-200 rounded-bl-none'
                  }`}
                >
                  <p className="text-sm leading-relaxed">{t.text}</p>
                </div>
              </div>
            ))
          )}
          
          {/* Typing/Listening Indicator */}
          {isConnected && volume > 0.05 && (
            <div className="flex justify-end">
               <div className="text-xs text-slate-500 italic animate-pulse">Listening...</div>
            </div>
          )}
        </div>

      </main>
    </div>
  );
};

export default App;