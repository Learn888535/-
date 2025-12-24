
import React, { useRef, useEffect, useState } from 'react';

interface VideoDisplayProps {
  onFrame: (base64: string) => void;
  isMonitoring: boolean;
  isAnalyzing: boolean;
  status: 'safe' | 'danger';
}

const VideoDisplay: React.FC<VideoDisplayProps> = ({ onFrame, isMonitoring, isAnalyzing, status }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function setupCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 1280 }, 
            height: { ideal: 720 }, 
            facingMode: 'user' 
          } 
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        setError("无法访问摄像头。请确保已授予权限。");
        console.error(err);
      }
    }
    setupCamera();
  }, []);

  useEffect(() => {
    if (!isMonitoring) return;

    const interval = setInterval(() => {
      if (videoRef.current && canvasRef.current && !isAnalyzing) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoRef.current, 0, 0, 640, 360);
          const base64 = canvasRef.current.toDataURL('image/jpeg', 0.5).split(',')[1];
          onFrame(base64);
        }
      }
    }, 3000); // 3秒分析一次

    return () => clearInterval(interval);
  }, [isMonitoring, onFrame, isAnalyzing]);

  // 模拟深度感滤镜渲染循环
  useEffect(() => {
    let animationFrame: number;
    const processVisuals = () => {
      if (videoRef.current && canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoRef.current, 0, 0, 640, 360);
          
          // 如果不是危险状态，应用“科技感蓝调”滤镜
          if (status !== 'danger') {
            const frame = ctx.getImageData(0, 0, 640, 360);
            const data = frame.data;
            for (let i = 0; i < data.length; i += 4) {
              const r = data[i], g = data[i+1], b = data[i+2];
              const avg = (r + g + b) / 3;
              // 模拟红外热成像/深度色调：蓝紫调
              data[i] = avg * 0.2;
              data[i+1] = avg * 0.5;
              data[i+2] = avg * 1.2;
            }
            ctx.putImageData(frame, 0, 0);
          }
        }
      }
      animationFrame = requestAnimationFrame(processVisuals);
    };
    
    processVisuals();
    return () => cancelAnimationFrame(animationFrame);
  }, [status]);

  return (
    <div className="relative w-full aspect-video bg-zinc-950 rounded-2xl overflow-hidden border border-zinc-800 shadow-2xl">
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />
      <canvas ref={canvasRef} width={640} height={360} className="w-full h-full object-cover" />

      {/* 扫描线效果 */}
      <div className="absolute inset-0 pointer-events-none opacity-20 depth-view-scanline"></div>

      {/* 状态指示器 */}
      <div className="absolute top-6 left-6 flex flex-col gap-3">
        <div className="bg-black/70 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isMonitoring ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`}></div>
          <span className="text-[10px] font-mono font-bold tracking-widest text-zinc-100 uppercase">
            {isMonitoring ? 'System Live' : 'System Standby'}
          </span>
        </div>
        
        {isAnalyzing && (
          <div className="bg-indigo-600/80 backdrop-blur-md px-4 py-1.5 rounded-full border border-indigo-400/30 flex items-center gap-2 animate-bounce">
            <i className="fas fa-microchip text-[10px] text-white"></i>
            <span className="text-[10px] font-mono font-bold tracking-widest text-white uppercase">
              AI Analyzing...
            </span>
          </div>
        )}
      </div>

      {/* 警报叠加层 */}
      {status === 'danger' && (
        <div className="absolute inset-0 bg-red-900/20 border-[8px] border-red-600/50 animate-pulse flex items-center justify-center pointer-events-none">
          <div className="bg-red-600 text-white px-8 py-2 font-black text-2xl skew-x-[-12deg] shadow-2xl">
            FALL DETECTED
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 z-50">
          <i className="fas fa-video-slash text-zinc-700 text-5xl mb-4"></i>
          <p className="text-zinc-400 font-mono text-sm px-12 text-center">{error}</p>
        </div>
      )}
    </div>
  );
};

export default VideoDisplay;
