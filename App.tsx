import React, { useState, useEffect, useRef } from 'react';
import { useLiveGemini } from './hooks/useLiveGemini';
import { ConnectionState, TranscriptionItem } from './types';
import Visualizer from './components/Visualizer';

type Source = { 
  id: string; 
  score?: number; 
  text_preview?: string; 
  properties?: Record<string, any> 
};

const App: React.FC = () => {
  const [transcripts, setTranscripts] = useState<TranscriptionItem[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [volume, setVolume] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const apiKey = process.env.API_KEY || '';

  // Auto-scroll transcripts
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  const onTranscription = (item: TranscriptionItem) => {
    setTranscripts(prev => [...prev, item]);
  };

  // 1. UPDATED SYSTEM INSTRUCTION FOR TOOL USE
  // We explicitly tell the model to use the tool provided.
  const systemInstruction =
    "You are a helpful voice assistant with access to a knowledge base.\n" +
    "PROTOCOL:\n" +
    "1. When the user asks a question, ALWAYS use the 'retrieve_context' tool first to find information.\n" +
    "2. Wait for the tool result, then answer the user's question using ONLY that context.\n" +
    "3. If the tool returns no relevant information, politely say you don't know.\n" +
    "4. Keep answers conversational, concise, and helpful.";

  // 3. HOOK CONFIGURATION
  const { connect, disconnect, sendTextTurn, connectionState, error } = useLiveGemini({
    apiKey,
    systemInstruction,
    onTranscription,
    onVolumeChange: setVolume,
    // NEW: Receive sources from the tool execution in the hook
    onSources: (srcs) => {
      setSources((srcs || []) as Source[]);
    },
    // INTERCEPT: When user finishes speaking...
    onUserFinalText: async (finalText) => {
      // Fix B: We simply send the text turn. 
      // The model will see this text, decide it needs info, and call the tool defined in the hook.
      if (sendTextTurn) {
        await sendTextTurn(finalText);
      }
    }
  });

  const handleToggleConnection = () => {
    if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) {
      disconnect();
    } else {
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
            Gemini Live RAG
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Live Tool & Function Calling
          </p>
        </div>

        {/* Connection Control */}
        <div className="space-y-3">
           <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Connection</h2>
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
             {isConnected ? 'End Session' : (isConnecting ? 'Connecting...' : 'Start Session')}
           </button>
           {error && <p className="text-xs text-red-400 text-center">{error}</p>}
        </div>

        {/* Visualizer */}
        <div className="flex flex-col items-center justify-center p-4 bg-slate-900/50 rounded-xl border border-slate-800">
           <Visualizer isActive={isConnected} volume={volume} />
           <p className="text-xs text-slate-500 mt-2 font-mono">
             {isConnected ? 'LISTENING' : 'OFFLINE'}
           </p>
        </div>

        {/* NEW: Retrieved Sources Display */}
        <div className="flex-1 min-h-0 flex flex-col p-4 bg-slate-900/50 rounded-xl border border-slate-800">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3 flex items-center justify-between">
            <span>Retrieved Sources</span>
            <span className="bg-slate-800 text-slate-400 px-2 py-0.5 rounded text-[10px]">{sources.length}</span>
          </h3>
          
          <div className="flex-1 overflow-y-auto space-y-3 pr-1 scrollbar-thin scrollbar-thumb-slate-700">
            {sources.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-600 text-xs text-center">
                <p>Speak to retrieve context<br/>(Tool will execute automatically)</p>
              </div>
            ) : (
              sources.map((s) => (
                <div key={s.id} className="group relative text-xs bg-slate-950 border border-slate-800 rounded-lg p-3 hover:border-blue-500/50 transition-colors">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-blue-400 font-mono truncate max-w-[70%]">{s.id}</span>
                    {s.score && <span className="text-slate-500">{s.score.toFixed(2)}</span>}
                  </div>
                  <p className="text-slate-300 line-clamp-3 leading-relaxed">{s.text_preview}</p>
                </div>
              ))
            )}
          </div>
        </div>

      </aside>

      {/* RIGHT PANEL: Transcript Interface */}
      <main className="flex-1 flex flex-col relative bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-slate-900">
        
        {/* Status Bar */}
        <div className="h-14 border-b border-slate-800 flex items-center px-6 bg-slate-900/80 backdrop-blur-md sticky top-0 z-10">
          <div className={`w-2.5 h-2.5 rounded-full mr-3 ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-slate-600'}`}></div>
          <span className="text-sm font-medium text-slate-300">
            {isConnected ? 'Live Audio RAG (Tool Use)' : 'Disconnected'}
          </span>
        </div>

        {/* Transcripts */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
          {transcripts.length === 0 ? (
             <div className="h-full flex flex-col items-center justify-center text-slate-600 opacity-50">
                <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                <p>Press "Start Session" to begin.</p>
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
          
          {/* Activity Indicator */}
          {isConnected && volume > 0.05 && (
            <div className="flex justify-end">
               <div className="text-xs text-slate-500 italic animate-pulse">Processing audio...</div>
            </div>
          )}
        </div>

      </main>
    </div>
  );
};

export default App;
