import * as pdfjsLib from 'pdfjs-dist';

// Set up the worker source explicitly for the browser environment
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs`;

export async function convertPdfToImages(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  
  // Load the PDF document
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  
  const images: string[] = [];
  const totalPages = pdf.numPages;

  // Limit pages to prevent browser crashes on huge docs, optional but recommended for client-side
  const MAX_PAGES = 20; 
  const pagesToProcess = Math.min(totalPages, MAX_PAGES);

  for (let i = 1; i <= pagesToProcess; i++) {
    const page = await pdf.getPage(i);
    
    // Determine scale. We want good quality but not massive resolution.
    // 1.5 scale is usually good for OCR (approx 1000-1500px width for standard docs)
    const viewport = page.getViewport({ scale: 1.5 });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    if (!context) continue;

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };

    await page.render(renderContext).promise;
    
    // Convert to base64 string (remove data URL prefix for Gemini API)
    const base64Url = canvas.toDataURL('image/jpeg', 0.8);
    const base64Data = base64Url.split(',')[1];
    
    images.push(base64Data);
  }

  return images;
}