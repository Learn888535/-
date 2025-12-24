
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
            width: { ideal: 1920 }, 
            height: { ideal: 1080 }, 
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

  // 渲染主逻辑：实时绘图并应用视觉滤镜
  useEffect(() => {
    let animationFrame: number;
    const processVisuals = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2) {
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
          // 关键：动态调整画布尺寸匹配视频源，防止拉伸模糊
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          // 非危险状态下应用深度感色调
          if (status !== 'danger') {
            ctx.globalCompositeOperation = 'multiply';
            ctx.fillStyle = 'rgba(20, 30, 80, 0.25)'; 
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.globalCompositeOperation = 'source-over';
          }
        }
      }
      animationFrame = requestAnimationFrame(processVisuals);
    };
    
    processVisuals();
    return () => cancelAnimationFrame(animationFrame);
  }, [status]);

  // 分析逻辑：降低频率进行 API 采样
  useEffect(() => {
    if (!isMonitoring) return;

    const interval = setInterval(() => {
      const video = videoRef.current;
      if (video && !isAnalyzing && video.readyState >= 2) {
        const offscreen = document.createElement('canvas');
        // 采样时使用较低的分辨率以减少 Token 消耗
        offscreen.width = 640;
        offscreen.height = 360;
        const ctx = offscreen.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, 640, 360);
          const base64 = offscreen.toDataURL('image/jpeg', 0.6).split(',')[1];
          onFrame(base64);
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isMonitoring, onFrame, isAnalyzing]);

  return (
    <div className="relative w-full aspect-video bg-zinc-950 rounded-3xl overflow-hidden border border-white/5 shadow-2xl">
      <video ref={videoRef} autoPlay playsInline muted className="hidden" />
      <canvas ref={canvasRef} className="w-full h-full object-contain" />

      {/* 科技感扫描线 */}
      <div className="absolute inset-0 pointer-events-none opacity-10 depth-view-scanline"></div>

      {/* 顶部状态条 */}
      <div className="absolute top-6 left-6 right-6 flex justify-between items-start pointer-events-none">
        <div className="bg-black/60 backdrop-blur-xl px-4 py-1.5 rounded-full border border-white/10 flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isMonitoring ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`}></div>
          <span className="text-[10px] font-black tracking-widest text-zinc-100 uppercase">
            {isMonitoring ? 'Monitoring Active' : 'System Paused'}
          </span>
        </div>
        <div className="bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/5 text-[9px] font-mono text-zinc-500">
          HD STREAM // 1080P
        </div>
      </div>

      {/* 警报叠加层 */}
      {status === 'danger' && (
        <div className="absolute inset-0 bg-red-900/10 border-[12px] border-red-600/50 flex items-center justify-center pointer-events-none">
          <div className="bg-red-600 text-white px-10 py-3 font-black text-2xl uppercase tracking-tighter shadow-2xl animate-pulse">
            FALL DETECTED
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 z-50 p-12 text-center">
          <i className="fas fa-camera-slash text-zinc-800 text-6xl mb-6"></i>
          <p className="text-zinc-500 font-bold max-w-sm">{error}</p>
        </div>
      )}
    </div>
  );
};

export default VideoDisplay;
