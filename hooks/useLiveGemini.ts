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

  // NEW: called when user's spoken turn is finalized
  onUserFinalText: (finalText: string) => Promise<void> | void;
}

export const useLiveGemini = ({
  apiKey,
  systemInstruction,
  onTranscription,
  onVolumeChange,
  onUserFinalText,
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

  const connect = useCallback(async () => {
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
            const ctx = outputAudioContextRef.current;
            if (!ctx) return;

            // AUDIO: handle possibly multiple parts
            const parts = message.serverContent?.modelTurn?.parts || [];
            for (const p of parts) {
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

            // interruption
            if (message.serverContent?.interrupted) {
              audioSourcesRef.current.forEach(src => { try { src.stop(); } catch {} });
              audioSourcesRef.current.clear();
              nextStartTimeRef.current = ctx.currentTime;
              currentOutputTranscriptionRef.current = '';
            }

            // transcription deltas
            if (message.serverContent?.outputTranscription?.text) {
              currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;
            }
            if (message.serverContent?.inputTranscription?.text) {
              currentInputTranscriptionRef.current += message.serverContent.inputTranscription.text;
            }

            // turn complete: 1) show user transcript 2) retrieve+ask via text turn 3) show model transcript when it arrives
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

                // Trigger RAG -> ask model (text turn)
                // This is the key “scaling to 100+ SOPs” step.
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
          },

          onclose: () => { disconnect(); },
          onerror: (err) => {
            console.error(err);
            setError("Connection Error");
            disconnect();
          }
        },

        config: {
          systemInstruction: systemInstruction || "You are a helpful assistant.",
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        }
      });

      sessionPromiseRef.current = sessionPromise;

    } catch (e: any) {
      console.error(e);
      setError(e.message || "Failed to connect");
      setConnectionState(ConnectionState.ERROR);
    }
  }, [apiKey, systemInstruction, disconnect, onTranscription, onVolumeChange, onUserFinalText]);

  useEffect(() => () => { disconnect(); }, [disconnect]);

  return {
    connect: Object.assign(connect, { sendTextTurn }), // so App can call connect.sendTextTurn(...)
    disconnect,
    connectionState,
    error
  };
};
