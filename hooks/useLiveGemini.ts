import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { ConnectionState, TranscriptionItem } from '../types';
import {
  createPcmBlob,
  decodeAudioData,
  base64ToArrayBuffer,
  PCM_SAMPLE_RATE_INPUT,
  PCM_SAMPLE_RATE_OUTPUT
} from '../utils/audioUtils';

interface UseLiveGeminiProps {
  apiKey: string;
  systemInstruction?: string;
  onTranscription: (item: TranscriptionItem) => void;
  onVolumeChange: (volume: number) => void;
  onUserFinalText: (finalText: string) => Promise<void> | void;
  onSources?: (sources: any[]) => void;
}

export const useLiveGemini = ({
  apiKey,
  systemInstruction,
  onTranscription,
  onVolumeChange,
  onUserFinalText,
  onSources,
}: UseLiveGeminiProps) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);

  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const sessionRef = useRef<any | null>(null);

  const currentInputTranscriptionRef = useRef<string>('');
  const currentOutputTranscriptionRef = useRef<string>('');

  const disconnect = useCallback(() => {
    console.log("Disconnecting Live Session...");
    if (inputAudioContextRef.current) { inputAudioContextRef.current.close(); inputAudioContextRef.current = null; }
    if (outputAudioContextRef.current) { outputAudioContextRef.current.close(); outputAudioContextRef.current = null; }

    audioSourcesRef.current.forEach(source => { try { source.stop(); } catch {} });
    audioSourcesRef.current.clear();

    setConnectionState(ConnectionState.DISCONNECTED);
    nextStartTimeRef.current = 0;
    sessionPromiseRef.current = null;
    sessionRef.current = null;
  }, []);

  const sendTextTurn = useCallback(async (text: string) => {
    const s = sessionRef.current || (await sessionPromiseRef.current);
    if (!s) throw new Error('No live session');
    await s.sendClientContent({
      turns: [{ role: 'user', parts: [{ text }] }],
      turnComplete: true,
    });
  }, []);

  // TOOL: Fetch from backend
  const retrieveContextTool = useCallback(async (query: string, top_k?: number) => {
    try {
      console.log(`Tool Executing: retrieve_context for query="${query}"`);
      const r = await fetch('/api/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, top_k }),
      });
      if (!r.ok) throw new Error(`Retrieve failed: ${r.status}`);
      return await r.json();
    } catch (e: any) {
      console.error("Tool execution failed:", e);
      return { context: "Error retrieving context.", sources: [] };
    }
  }, []);

  const connect = useCallback(async () => {
    console.log("Initializing Live Connection...");
    if (!apiKey) { setError("API Key is missing"); return; }

    try {
      setConnectionState(ConnectionState.CONNECTING);
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: PCM_SAMPLE_RATE_INPUT
      });

      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: PCM_SAMPLE_RATE_OUTPUT
      });

      nextStartTimeRef.current = outputAudioContextRef.current.currentTime;

      const ai = new GoogleGenAI({ apiKey });

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            console.log("WebSocket Session Opened");
            setConnectionState(ConnectionState.CONNECTED);

            sessionPromise.then((s) => { sessionRef.current = s; });

            const ctx = inputAudioContextRef.current;
            if (!ctx) return;

            const source = ctx.createMediaStreamSource(stream);
            inputSourceRef.current = source;

            const processor = ctx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              onVolumeChange(rms * 5);

              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(processor);
            processor.connect(ctx.destination);
          },

          onmessage: async (message: LiveServerMessage) => {
            // FIX #2: Wrap onmessage in try/catch to prevent session crashes
            try {
              const ctx = outputAudioContextRef.current;
              if (!ctx) return;

              // 1. TOOL CALL HANDLING
              const toolCall = (message as any).toolCall;
              if (toolCall?.functionCalls?.length) {
                console.log("Received Tool Call:", toolCall);
                const s = sessionRef.current || (await sessionPromiseRef.current);
                if (!s) return;

                const functionResponses: any[] = [];

                for (const fc of toolCall.functionCalls) {
                  if (fc.name === 'retrieve_context') {
                    const query = String(fc.args?.query ?? '').trim();
                    const top_k = fc.args?.top_k ? Number(fc.args.top_k) : undefined;
                    
                    const result = await retrieveContextTool(query, top_k);
                    
                    if (onSources && result.sources) {
                      onSources(result.sources);
                    }

                    functionResponses.push({
                      id: fc.id,
                      name: fc.name,
                      response: {
                        result: result 
                      }
                    });
                  } else {
                    console.warn("Unknown tool called:", fc.name);
                    functionResponses.push({
                      id: fc.id,
                      name: fc.name,
                      response: { error: `Unknown tool: ${fc.name}` }
                    });
                  }
                }

                console.log("Sending Tool Response:", functionResponses);
                await s.sendToolResponse({ functionResponses });
                return; 
              }

              // 2. AUDIO HANDLING
              const parts = message.serverContent?.modelTurn?.parts || [];
              for (const p of parts) {
                // FIX #1: Removed the erroneous "constWZAudio" line
                const base64Audio = p.inlineData?.data;
                if (!base64Audio) continue;

                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);

                const audioData = new Uint8Array(base64ToArrayBuffer(base64Audio));
                const audioBuffer = await decodeAudioData(audioData, ctx, PCM_SAMPLE_RATE_OUTPUT);

                const source = ctx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(ctx.destination);
                source.addEventListener('ended', () => audioSourcesRef.current.delete(source));

                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                audioSourcesRef.current.add(source);
              }

              if (message.serverContent?.interrupted) {
                console.log("Model Interrupted");
                audioSourcesRef.current.forEach(src => { try { src.stop(); } catch {} });
                audioSourcesRef.current.clear();
                nextStartTimeRef.current = ctx.currentTime;
                currentOutputTranscriptionRef.current = '';
              }

              if (message.serverContent?.outputTranscription?.text) {
                currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;
              }
              if (message.serverContent?.inputTranscription?.text) {
                currentInputTranscriptionRef.current += message.serverContent.inputTranscription.text;
              }

              if (message.serverContent?.turnComplete) {
                const userFinal = currentInputTranscriptionRef.current.trim();
                if (userFinal) {
                  onTranscription({
                    id: Date.now() + '-user',
                    text: userFinal,
                    sender: 'user',
                    timestamp: new Date()
                  });
                  currentInputTranscriptionRef.current = '';
                  await onUserFinalText(userFinal);
                }

                const modelFinal = currentOutputTranscriptionRef.current.trim();
                if (modelFinal) {
                  onTranscription({
                    id: Date.now() + '-model',
                    text: modelFinal,
                    sender: 'model',
                    timestamp: new Date()
                  });
                  currentOutputTranscriptionRef.current = '';
                }
              }
            } catch (err) {
              // FIX #2: Catch runtime errors in message handling so we don't crash the session
              console.error("Error processing onmessage:", err);
            }
          },

          onclose: (e: any) => {
            console.error("Gemini WS Closed", {
                code: e.code,
                reason: e.reason,
                wasClean: e.wasClean,
            });
            disconnect();
          },
          onerror: (err: any) => {
            console.error("Gemini WS Error", err);
            setError("Connection Error");
            disconnect();
          }
        },

        config: {
          systemInstruction: systemInstruction || "You are a helpful assistant.",
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'retrieve_context',
                  description: 'Retrieve relevant context/chunks from the knowledge base for a query.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      query: { type: 'STRING', description: 'The search query to find relevant documents.' },
                      top_k: { type: 'INTEGER', description: 'Number of chunks to retrieve (optional).' }
                    },
                    required: ['query']
                  }
                }
              ]
            }
          ]
        }
      });

      sessionPromiseRef.current = sessionPromise;

    } catch (e: any) {
      console.error("Connection Attempt Failed:", e);
      setError(e.message || "Failed to connect");
      setConnectionState(ConnectionState.ERROR);
    }
  }, [apiKey, systemInstruction, disconnect, onTranscription, onVolumeChange, onUserFinalText, onSources, retrieveContextTool]);

  useEffect(() => {
    return () => {
      console.log("Effect Cleanup: Disconnecting...");
      disconnect();
    };
  }, [disconnect]);

  return {
    connect,
    disconnect,
    sendTextTurn,
    connectionState,
    error
  };
};
