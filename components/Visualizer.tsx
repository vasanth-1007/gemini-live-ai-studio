import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isActive: boolean;
  volume: number; // 0 to 1 ideally, but can go higher
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, volume }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const barsRef = useRef<number[]>([0.1, 0.2, 0.1, 0.3, 0.1]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      
      // Update target bars based on volume
      const targetHeight = isActive ? Math.max(0.1, volume) : 0.1;
      
      // Smoothly interpolate bars
      if (barsRef.current.length < 5) barsRef.current = [0.1, 0.1, 0.1, 0.1, 0.1];
      
      for(let i=0; i<5; i++) {
        // Randomize slightly for organic feel
        const randomOffset = Math.random() * 0.2;
        const target = targetHeight + (i === 2 ? 0.1 : 0) + (isActive ? randomOffset : 0);
        
        // Linear interpolation
        barsRef.current[i] += (target - barsRef.current[i]) * 0.2;
        
        const h = barsRef.current[i] * 100;
        
        // Draw Pill
        ctx.fillStyle = isActive ? '#60a5fa' : '#475569'; // Blue when active, gray when idle
        if(isActive && i===2) ctx.fillStyle = '#3b82f6'; // Center one brighter
        
        const x = centerX + (i - 2) * 20;
        const width = 12;
        
        ctx.beginPath();
        ctx.roundRect(x - width/2, centerY - h/2, width, h, 6);
        ctx.fill();
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [isActive, volume]);

  return (
    <canvas 
      ref={canvasRef} 
      width={200} 
      height={150} 
      className="w-full max-w-[200px] h-[150px]"
    />
  );
};

export default Visualizer;