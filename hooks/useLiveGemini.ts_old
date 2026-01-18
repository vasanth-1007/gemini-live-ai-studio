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
}

export const useLiveGemini = ({ apiKey, systemInstruction, onTranscription, onVolumeChange }: UseLiveGeminiProps) => {
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);

  // Audio Context Refs
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Session Ref
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const currentInputTranscriptionRef = useRef<string>('');
  const currentOutputTranscriptionRef = useRef<string>('');

  const disconnect = useCallback(() => {
    // Close Audio Contexts
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }

    // Stop all playing audio
    audioSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    audioSourcesRef.current.clear();

    // Reset state
    setConnectionState(ConnectionState.DISCONNECTED);
    nextStartTimeRef.current = 0;
    
    // We cannot explicitly "close" the session promise in the current SDK without the session object exposed directly easily
    // but stopping the audio context effectively kills the stream interactions.
    // In a production app, we would store the resolved session and call session.close() if available.
    sessionPromiseRef.current = null;
  }, []);

  const connect = useCallback(async () => {
    if (!apiKey) {
      setError("API Key is missing");
      return;
    }

    try {
      setConnectionState(ConnectionState.CONNECTING);
      setError(null);

      // 1. Setup Audio Input (Microphone)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: PCM_SAMPLE_RATE_INPUT
      });
      
      // 2. Setup Audio Output (Speaker)
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: PCM_SAMPLE_RATE_OUTPUT
      });
      nextStartTimeRef.current = outputAudioContextRef.current.currentTime;

      // 3. Initialize Gemini Client
      const ai = new GoogleGenAI({ apiKey });
      
      // 4. Create Session
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setConnectionState(ConnectionState.CONNECTED);
            
            // Start processing microphone input
            const ctx = inputAudioContextRef.current;
            if (!ctx) return;

            const source = ctx.createMediaStreamSource(stream);
            inputSourceRef.current = source;
            
            // Use ScriptProcessor for raw PCM access (AudioWorklet is better for prod, but more complex for single-file)
            const processor = ctx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              
              // Simple volume meter calculation
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
              const rms = Math.sqrt(sum / inputData.length);
              onVolumeChange(rms * 5); // Scale up a bit for visibility

              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(processor);
            processor.connect(ctx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            const ctx = outputAudioContextRef.current;
            if (!ctx) return;

            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
               // Ensure playback timing is continuous
               nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
               
               const audioData = new Uint8Array(base64ToArrayBuffer(base64Audio));
               const audioBuffer = await decodeAudioData(audioData, ctx, PCM_SAMPLE_RATE_OUTPUT);
               
               const source = ctx.createBufferSource();
               source.buffer = audioBuffer;
               source.connect(ctx.destination);
               source.addEventListener('ended', () => {
                 audioSourcesRef.current.delete(source);
               });
               
               source.start(nextStartTimeRef.current);
               nextStartTimeRef.current += audioBuffer.duration;
               audioSourcesRef.current.add(source);
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
              audioSourcesRef.current.forEach(src => {
                 try { src.stop(); } catch(e) {}
              });
              audioSourcesRef.current.clear();
              nextStartTimeRef.current = ctx.currentTime;
              currentOutputTranscriptionRef.current = ''; 
            }

            // Handle Transcription
            if (message.serverContent?.outputTranscription) {
               currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;
            }
            if (message.serverContent?.inputTranscription) {
               currentInputTranscriptionRef.current += message.serverContent.inputTranscription.text;
            }

            if (message.serverContent?.turnComplete) {
               if (currentInputTranscriptionRef.current) {
                 onTranscription({
                    id: Date.now() + '-user',
                    text: currentInputTranscriptionRef.current,
                    sender: 'user',
                    timestamp: new Date()
                 });
                 currentInputTranscriptionRef.current = '';
               }
               if (currentOutputTranscriptionRef.current) {
                 onTranscription({
                    id: Date.now() + '-model',
                    text: currentOutputTranscriptionRef.current,
                    sender: 'model',
                    timestamp: new Date()
                 });
                 currentOutputTranscriptionRef.current = '';
               }
            }
          },
          onclose: () => {
            disconnect();
          },
          onerror: (err) => {
            console.error(err);
            setError("Connection Error");
            disconnect();
          }
        },
        config: {
          systemInstruction: systemInstruction || "You are a helpful assistant.",
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          },
          // FIX: Pass empty objects to enable transcription. 
          // Do NOT pass a 'model' field here.
          inputAudioTranscription: { },
          outputAudioTranscription: { }
        }
      });
      
      sessionPromiseRef.current = sessionPromise;

    } catch (e: any) {
      console.error(e);
      setError(e.message || "Failed to connect");
      setConnectionState(ConnectionState.ERROR);
    }
  }, [apiKey, systemInstruction, disconnect, onTranscription, onVolumeChange]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      disconnect();
    }
  }, [disconnect]);

  return {
    connect,
    disconnect,
    connectionState,
    error
  };
};