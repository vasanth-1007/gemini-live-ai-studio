import React, { useCallback, useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import { DocumentFile } from '../types';
import { convertPdfToImages } from '../utils/pdfUtils';

interface FileUploaderProps {
  onFileLoaded: (doc: DocumentFile | null) => void;
  disabled: boolean;
  apiKey: string;
}

const FileUploader: React.FC<FileUploaderProps> = ({ onFileLoaded, disabled, apiKey }) => {
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null); // 'uploading', 'processing', 'error', 'success'
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const processFile = async (file: File) => {
    try {
      setErrorMessage(null);
      setStatus('uploading');
      setFileName(file.name);

      // Handle Text Files
      if (file.type === 'text/plain' || file.name.endsWith('.md') || file.name.endsWith('.csv') || file.name.endsWith('.json')) {
        if (file.size > 1024 * 1024) {
          throw new Error("Text file is too large (Max 1MB)");
        }
        const text = await file.text();
        onFileLoaded({
          name: file.name,
          content: text,
          type: file.type
        });
        setStatus('success');
        return;
      }

      // Handle PDF Files
      if (file.type === 'application/pdf') {
        setStatus('processing');
        
        // 1. Convert PDF pages to Images
        const images = await convertPdfToImages(file);
        
        if (images.length === 0) {
          throw new Error("Could not extract any pages from the PDF.");
        }

        // 2. Send Images to Gemini for Multimodal Extraction
        setStatus('extracting');
        const ai = new GoogleGenAI({ apiKey });
        
        // Use gemini-3-flash-preview for efficient multimodal processing
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: [
            {
              role: 'user',
              parts: [
                { text: "You are a specialized document parser. Please transcribe the text from these document pages verbatim. If there are diagrams, charts, or images, provide a detailed description of them in brackets [like this]. Merge the content of all pages into a single coherent text stream." },
                ...images.map(img => ({ inlineData: { mimeType: 'image/jpeg', data: img } }))
              ]
            }
          ]
        });

        const extractedText = response.text;
        
        if (!extractedText) {
          throw new Error("Failed to extract content from the PDF.");
        }

        onFileLoaded({
          name: file.name,
          content: extractedText,
          type: 'application/pdf-extracted'
        });
        setStatus('success');
        return;
      }

      throw new Error("Unsupported file type.");

    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "Failed to process file");
      setStatus('error');
      onFileLoaded(null);
      setFileName(null);
    }
  };

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setFileName(null);
      onFileLoaded(null);
      setStatus(null);
      return;
    }
    processFile(file);
  }, [onFileLoaded, apiKey]);

  return (
    <div className="w-full">
      <label className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer transition-colors relative overflow-hidden
        ${disabled ? 'border-gray-700 bg-gray-900/50 cursor-not-allowed' : 'border-gray-600 hover:border-blue-500 bg-gray-800/50 hover:bg-gray-800'}
        ${status === 'error' ? 'border-red-500/50 bg-red-900/10' : ''}
      `}>
        
        {/* Loading Overlay */}
        {(status === 'processing' || status === 'extracting') && (
          <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center z-10 animate-in fade-in">
            <svg className="animate-spin h-8 w-8 text-blue-500 mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-xs text-blue-400 font-medium">
              {status === 'processing' ? 'Rendering PDF...' : 'Gemini is reading...'}
            </p>
          </div>
        )}

        <div className="flex flex-col items-center justify-center pt-5 pb-6">
          <svg className="w-8 h-8 mb-4 text-gray-400" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16">
            <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"/>
          </svg>
          <p className="mb-2 text-sm text-gray-400"><span className="font-semibold">Click to upload document</span></p>
          <p className="text-xs text-gray-500">PDF, TXT, MD, CSV (Max 20MB)</p>
        </div>
        <input 
          type="file" 
          className="hidden" 
          accept=".pdf,.txt,.md,.csv,.json"
          onChange={handleFileChange}
          disabled={disabled || status === 'processing' || status === 'extracting'}
        />
      </label>
      
      {fileName && status === 'success' && (
        <div className="mt-2 flex items-center gap-2 text-sm text-green-400 bg-green-400/10 p-2 rounded-lg border border-green-400/20">
            <span className="truncate">📄 {fileName} ready</span>
        </div>
      )}
      
      {errorMessage && (
         <div className="mt-2 text-sm text-red-400 bg-red-400/10 p-2 rounded-lg border border-red-400/20">
            {errorMessage}
         </div>
      )}
    </div>
  );
};

export default FileUploader;