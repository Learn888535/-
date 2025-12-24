
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SystemStatus, DetectionResult, ActivityLog } from './types';
import VideoDisplay from './components/VideoDisplay';
import StatsCard from './components/StatsCard';
import { analyzeScene, createLiveSession } from './services/gemini';

type AppView = 'dashboard' | 'analysis' | 'history' | 'settings';

interface Contact {
  id: string;
  name: string;
  role: string;
  tel: string;
}

const SidebarItem: React.FC<{ icon: string; label: string; active?: boolean; onClick: () => void }> = ({ icon, label, active, onClick }) => (
  <div 
    onClick={onClick}
    className={`flex items-center gap-3 px-4 py-3 rounded-2xl cursor-pointer transition-all ${active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-200'}`}
  >
    <i className={`fas ${icon} w-5 text-center`}></i>
    <span className="text-sm font-bold tracking-tight">{label}</span>
  </div>
);

const LogItem: React.FC<{ log: ActivityLog }> = ({ log }) => (
  <div className="flex items-start gap-4 py-5 border-b border-zinc-800/40 last:border-0 group animate-in fade-in slide-in-from-left-4">
    <div className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${log.status === 'danger' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]' : log.status === 'warning' ? 'bg-amber-500' : 'bg-zinc-600 group-hover:bg-indigo-500'}`}></div>
    <div className="flex-1">
      <p className={`text-xs font-bold leading-relaxed ${log.status === 'danger' ? 'text-red-400' : log.status === 'warning' ? 'text-amber-200' : 'text-zinc-200'}`}>
        {log.event}
      </p>
      <div className="flex items-center gap-2 mt-1.5">
        <i className="far fa-clock text-[9px] text-zinc-600"></i>
        <p className="text-[9px] text-zinc-600 font-mono font-bold uppercase tracking-widest">{log.timestamp.toLocaleTimeString()}</p>
      </div>
    </div>
  </div>
);

const App: React.FC = () => {
  const [view, setView] = useState<AppView>('dashboard');
  const [status, setStatus] = useState<SystemStatus>(SystemStatus.IDLE);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastDetection, setLastDetection] = useState<DetectionResult>({
    isFallDetected: false,
    confidence: 0,
    reasoning: "等待摄像头连接以启动智能分析系统...",
    posture: "none"
  });
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [isEmergencyActive, setIsEmergencyActive] = useState(false);
  const [countdown, setCountdown] = useState(10);
  
  // Settings State
  const [contacts, setContacts] = useState<Contact[]>([
    { id: '1', name: "张医生", role: "社区全科医生", tel: "138-1234-5678" },
    { id: '2', name: "李女士", role: "主要家属", tel: "139-8765-4321" }
  ]);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);

  // History Edit State
  const [editingLogId, setEditingLogId] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);

  const addLog = useCallback((event: string, logStatus: 'info' | 'warning' | 'danger' = 'info') => {
    setLogs(prev => [{
      id: Math.random().toString(36),
      timestamp: new Date(),
      event,
      status: logStatus
    }, ...prev].slice(0, 50));
  }, []);

  const handleFrameAnalysis = useCallback(async (base64: string) => {
    if (status === SystemStatus.EMERGENCY || isAnalyzing) return;

    setIsAnalyzing(true);
    try {
      const result = await analyzeScene(base64);
      setLastDetection({ ...result });

      if (result.isFallDetected && result.confidence > 0.6) {
        if (status !== SystemStatus.ALERT) {
          setStatus(SystemStatus.ALERT);
          addLog(`紧急：检测到潜在跌倒行为 (置信度: ${Math.round(result.confidence * 100)}%)`, 'danger');
          triggerEmergencyInteraction();
        }
      } else if (status === SystemStatus.MONITORING) {
        const pMap: any = { standing: '站立', sitting: '坐姿', lying: '卧姿', none: '未检测到人员', unknown: '探测中' };
        addLog(`分析：人员状态 [${pMap[result.posture] || result.posture}]`, 'info');
      }
    } catch (e) {
      addLog("后端计算节点暂时无响应", "warning");
    } finally {
      setIsAnalyzing(false);
    }
  }, [status, isAnalyzing, addLog]);

  const triggerEmergencyInteraction = async () => {
    setIsEmergencyActive(true);
    setCountdown(10);
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    try {
      await createLiveSession({
        onmessage: async (message: any) => {
          const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (audioData && audioContextRef.current) {
            const ctx = audioContextRef.current;
            const binaryString = atob(audioData);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
            const dataInt16 = new Int16Array(bytes.buffer);
            const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
            const channelData = buffer.getChannelData(0);
            for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.start(nextStartTimeRef.current);
            nextStartTimeRef.current += buffer.duration;
          }
        },
        onclose: () => setIsEmergencyActive(false)
      });
      addLog("系统对讲机已开启，正在询问伤情", "info");
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    let timer: number;
    if (status === SystemStatus.ALERT && countdown > 0) {
      timer = window.setInterval(() => setCountdown(prev => prev - 1), 1000);
    } else if (countdown === 0 && status === SystemStatus.ALERT) {
      setStatus(SystemStatus.EMERGENCY);
      addLog("无人响应。正在拨打紧急救援中心...", "danger");
    }
    return () => clearInterval(timer);
  }, [status, countdown, addLog]);

  const toggleMonitoring = () => {
    if (status === SystemStatus.IDLE) {
      setStatus(SystemStatus.MONITORING);
      addLog("视觉安全系统已上线", "info");
    } else {
      setStatus(SystemStatus.IDLE);
      addLog("监控模式已暂停", "info");
    }
  };

  const handleUpdateContact = (id: string, updates: Partial<Contact>) => {
    setContacts(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const handleAddNewContact = () => {
    const newContact: Contact = {
      id: Math.random().toString(36).substr(2, 9),
      name: "新联络人",
      role: "身份描述",
      tel: "输入号码"
    };
    setContacts(prev => [...prev, newContact]);
    setEditingContactId(newContact.id);
  };

  const handleDeleteContact = (id: string) => {
    setContacts(prev => prev.filter(c => c.id !== id));
    if (editingContactId === id) setEditingContactId(null);
  };

  const handleDeleteLog = (id: string) => {
    setLogs(prev => prev.filter(l => l.id !== id));
  };

  const handleUpdateLog = (id: string, event: string) => {
    setLogs(prev => prev.map(l => l.id === id ? { ...l, event } : l));
  };

  const downloadHistory = () => {
    const historyLogs = logs.filter(l => l.status !== 'info');
    if (historyLogs.length === 0) return;
    const headers = ["ID", "Timestamp", "Status", "Event"];
    const rows = historyLogs.map(l => [l.id, l.timestamp.toLocaleString(), l.status.toUpperCase(), `"${l.event.replace(/"/g, '""')}"`]);
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Guardian_History_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderDashboard = () => (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-10 animate-in fade-in duration-500">
      <div className="xl:col-span-8 flex flex-col gap-8">
        <VideoDisplay 
          isMonitoring={status !== SystemStatus.IDLE}
          isAnalyzing={isAnalyzing}
          status={(status === SystemStatus.ALERT || status === SystemStatus.EMERGENCY) ? 'danger' : 'safe'}
          onFrame={handleFrameAnalysis}
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <StatsCard label="状态监测" value={lastDetection.posture === 'standing' ? '正常站立' : (lastDetection.posture === 'sitting' ? '平稳坐姿' : (lastDetection.posture === 'lying' ? '可能倒地' : '正在扫描'))} icon="fa-user-shield" color="indigo" loading={isAnalyzing} />
          <StatsCard label="置信水平" value={status === SystemStatus.IDLE ? '--' : `${Math.round(lastDetection.confidence * 100)}%`} icon="fa-brain" color="emerald" loading={isAnalyzing} />
          <StatsCard label="环境光感" value="正常" icon="fa-sun" color="amber" />
        </div>
        <div className="bg-gradient-to-br from-zinc-900 to-zinc-900/40 border border-zinc-800/60 p-8 rounded-[2.5rem] relative overflow-hidden shadow-2xl">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <i className="fas fa-microchip text-8xl"></i>
          </div>
          <h3 className="text-indigo-400 text-[10px] font-black uppercase tracking-[0.3em] mb-4 flex items-center gap-3">
            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full shadow-[0_0_8px_rgba(99,102,241,1)]"></span>
            视觉推理 AI 报告
          </h3>
          <p className="text-xl text-zinc-100 font-bold leading-relaxed min-h-[3rem] italic">"{lastDetection.reasoning}"</p>
        </div>
      </div>
      <div className="xl:col-span-4 flex flex-col gap-8">
        {(status === SystemStatus.ALERT || status === SystemStatus.EMERGENCY) && (
          <div className="bg-red-950/20 border-2 border-red-500/50 p-8 rounded-[2.5rem] animate-pulse-red shadow-2xl shadow-red-500/10">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 rounded-2xl bg-red-600 flex items-center justify-center text-white text-2xl animate-bounce shadow-lg shadow-red-600/40">
                <i className="fas fa-phone-alt"></i>
              </div>
              <div>
                <h3 className="text-red-500 font-black text-xl tracking-tighter">紧急警报</h3>
                <p className="text-red-200/40 text-[9px] uppercase font-black tracking-widest mt-1">Status: Fall Confirmed</p>
              </div>
            </div>
            {status === SystemStatus.ALERT ? (
              <div className="space-y-6">
                <p className="text-zinc-200 text-sm leading-relaxed font-bold">检测到倒地行为。正在启动远程医疗介入。倒计时结束后将呼叫救援。</p>
                <div className="bg-black/40 rounded-3xl p-8 border border-red-500/20 flex flex-col items-center">
                  <span className="text-7xl font-black text-white font-mono tracking-tighter">{countdown}</span>
                  <span className="text-red-500/60 text-[10px] uppercase font-black tracking-widest mt-2">Seconds Remaining</span>
                </div>
              </div>
            ) : (
              <div className="p-6 bg-red-600 rounded-3xl text-center shadow-xl shadow-red-600/20">
                <p className="text-white font-black text-sm uppercase tracking-widest">正在联络紧急救援队...</p>
              </div>
            )}
            <div className="flex flex-col gap-3 mt-8">
              <button onClick={() => { setStatus(SystemStatus.MONITORING); setIsEmergencyActive(false); }} className="w-full bg-zinc-800 hover:bg-zinc-700 text-white py-4 rounded-2xl font-bold text-sm transition-all active:scale-95">取消误报</button>
              {status === SystemStatus.ALERT && <button onClick={() => setStatus(SystemStatus.EMERGENCY)} className="w-full bg-red-600 hover:bg-red-500 text-white py-4 rounded-2xl font-bold text-sm shadow-xl shadow-red-600/30 transition-all active:scale-95">立即求救</button>}
            </div>
          </div>
        )}
        <div className="bg-[#080808] border border-zinc-800/60 rounded-[2.5rem] flex-1 flex flex-col overflow-hidden shadow-2xl">
          <div className="px-8 py-6 border-b border-zinc-800/60 bg-zinc-900/30 flex justify-between items-center">
            <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">实时监控日志</h3>
            <span className="text-[10px] text-zinc-600 font-mono">{logs.length} EVENTS</span>
          </div>
          <div className="px-8 overflow-y-auto max-h-[500px] flex flex-col-reverse custom-scrollbar">
            {logs.length === 0 ? <div className="py-24 text-center opacity-10"><i className="fas fa-database text-4xl mb-4"></i><p className="text-[10px] font-black uppercase tracking-widest">无数据</p></div> : logs.map(log => <LogItem key={log.id} log={log} />)}
          </div>
        </div>
      </div>
    </div>
  );

  const renderAnalysis = () => (
    <div className="flex flex-col gap-10 animate-in fade-in slide-in-from-bottom-6 duration-700">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 space-y-8">
          <VideoDisplay 
            isMonitoring={status !== SystemStatus.IDLE}
            isAnalyzing={isAnalyzing}
            status={(status === SystemStatus.ALERT || status === SystemStatus.EMERGENCY) ? 'danger' : 'safe'}
            onFrame={handleFrameAnalysis}
          />
          <div className="bg-zinc-900/20 border border-zinc-800/40 p-10 rounded-[3rem] backdrop-blur-md relative overflow-hidden">
             <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(99,102,241,0.1),transparent_70%)]"></div>
             <div className="relative z-10 flex flex-col items-center text-center">
                <div className={`w-20 h-20 rounded-3xl flex items-center justify-center text-3xl mb-6 shadow-2xl transition-all ${isAnalyzing ? 'bg-indigo-600 animate-spin-slow' : 'bg-emerald-500/20 text-emerald-500'}`}>
                  <i className={`fas ${isAnalyzing ? 'fa-circle-notch' : 'fa-brain'}`}></i>
                </div>
                <h3 className="text-zinc-100 font-black text-2xl tracking-tight mb-2 italic">视觉推理引擎核心</h3>
                <p className="text-zinc-500 text-sm max-w-md leading-relaxed">系统正在实时解算环境深度信息。置信度当前保持在 <span className="text-indigo-400 font-mono font-bold">{(lastDetection.confidence * 100).toFixed(1)}%</span></p>
                <div className="w-full bg-zinc-800/50 h-1.5 rounded-full mt-8 overflow-hidden">
                  <div className="h-full bg-indigo-500 transition-all duration-1000" style={{ width: `${lastDetection.confidence * 100}%` }}></div>
                </div>
             </div>
          </div>
        </div>
        <div className="space-y-8">
          <div className="bg-[#080808] border border-zinc-800/60 rounded-[2.5rem] p-8 shadow-2xl">
            <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] mb-6 flex items-center gap-2">
              <span className="w-2 h-2 bg-indigo-500 rounded-full"></span>
              姿态解算历史
            </h4>
            <div className="space-y-4">
              {logs.slice(0, 8).map(log => (
                <div key={log.id} className="flex items-center gap-4 group">
                  <div className="w-1 h-6 bg-zinc-800 rounded-full group-hover:bg-indigo-500 transition-colors"></div>
                  <div className="flex-1">
                    <p className="text-[11px] font-bold text-zinc-300 truncate">{log.event}</p>
                    <p className="text-[9px] text-zinc-600 font-mono mt-0.5">{log.timestamp.toLocaleTimeString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-[2.5rem] p-8">
            <h4 className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.3em] mb-6">感测阈值设定</h4>
            <div className="space-y-6">
              <div className="flex justify-between items-center"><span className="text-xs font-bold text-zinc-400">灵敏度</span><span className="text-xs font-mono text-zinc-100">HIGH</span></div>
              <div className="flex justify-between items-center"><span className="text-xs font-bold text-zinc-400">采样率</span><span className="text-xs font-mono text-zinc-100">0.3Hz</span></div>
              <div className="flex justify-between items-center"><span className="text-xs font-bold text-zinc-400">隐私遮罩</span><span className="text-xs font-mono text-emerald-500">ACTIVE</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderHistory = () => {
    const historyLogs = logs.filter(l => l.status !== 'info');
    return (
      <div className="max-w-5xl mx-auto bg-zinc-900/30 border border-zinc-800/60 rounded-[3rem] p-10 animate-in fade-in zoom-in duration-300 shadow-2xl">
        <div className="flex justify-between items-center mb-10">
          <h2 className="text-2xl font-black text-white flex items-center gap-4 italic"><i className="fas fa-history text-indigo-500"></i> 警报历史存档</h2>
          {historyLogs.length > 0 && <button onClick={downloadHistory} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-indigo-600/20"><i className="fas fa-file-csv text-lg"></i>导出所有记录 (CSV)</button>}
        </div>
        <div className="space-y-6">
          {historyLogs.length === 0 ? <div className="py-32 text-center text-zinc-600"><i className="fas fa-folder-open text-5xl mb-6 opacity-20"></i><p className="text-lg font-bold">暂无历史警报记录</p><p className="text-xs mt-2 font-mono uppercase tracking-widest opacity-50">All Systems Normal</p></div> : historyLogs.map(log => (
            <div key={log.id} className="bg-black/40 border border-zinc-800/40 p-8 rounded-[2rem] flex items-center justify-between group hover:border-indigo-500/30 transition-all shadow-xl">
              <div className="flex items-center gap-8 flex-1 mr-8">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${log.status === 'danger' ? 'bg-red-500/20 text-red-500' : 'bg-amber-500/20 text-amber-500'}`}><i className={`fas ${log.status === 'danger' ? 'fa-exclamation-triangle' : 'fa-bell'} text-2xl`}></i></div>
                <div className="flex-1 min-w-0">
                  {editingLogId === log.id ? <div className="space-y-3 animate-in fade-in slide-in-from-left-2"><input autoFocus className="w-full bg-zinc-900/80 border border-indigo-500/50 rounded-xl px-4 py-2 text-white font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500" value={log.event} onChange={(e) => handleUpdateLog(log.id, e.target.value)} /><div className="flex gap-2"><button onClick={() => setEditingLogId(null)} className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest">保存修改</button><button onClick={() => setEditingLogId(null)} className="bg-zinc-800 text-zinc-400 px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest">取消</button></div></div> : <><p className="text-zinc-100 font-black text-lg leading-tight truncate">{log.event}</p><div className="flex items-center gap-4 mt-2"><p className="text-[10px] text-zinc-600 font-mono font-bold uppercase tracking-widest"><i className="far fa-clock mr-1.5"></i>{log.timestamp.toLocaleString()}</p><span className={`px-3 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest ${log.status === 'danger' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'}`}>{log.status === 'danger' ? 'Emergency' : 'Alert'}</span></div></>}
                </div>
              </div>
              <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                {editingLogId !== log.id && <button onClick={() => setEditingLogId(log.id)} className="w-10 h-10 rounded-xl bg-zinc-800 text-zinc-400 hover:bg-indigo-600 hover:text-white transition-all flex items-center justify-center" title="编辑记录"><i className="fas fa-edit"></i></button>}
                <button onClick={() => handleDeleteLog(log.id)} className="w-10 h-10 rounded-xl bg-zinc-800 text-zinc-400 hover:bg-red-600 hover:text-white transition-all flex items-center justify-center" title="删除记录"><i className="fas fa-trash-alt"></i></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderSettings = () => (
    <div className="max-w-4xl mx-auto bg-zinc-900/30 border border-zinc-800/60 rounded-[3rem] p-10 animate-in fade-in zoom-in duration-300 shadow-2xl">
      <h2 className="text-2xl font-black text-white mb-10 flex items-center gap-4 italic"><i className="fas fa-user-shield text-indigo-500"></i> 紧急联络人设置</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {contacts.map((contact) => (
          <div key={contact.id} className="bg-black/40 border border-zinc-800/40 p-8 rounded-[2rem] hover:border-indigo-500/20 transition-all group">
            <div className="flex justify-between items-start mb-6"><div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center"><i className="fas fa-user text-xl"></i></div><button onClick={() => handleDeleteContact(contact.id)} className="opacity-0 group-hover:opacity-100 p-2 text-zinc-600 hover:text-red-500 transition-all"><i className="fas fa-trash-alt text-xs"></i></button></div>
            {editingContactId === contact.id ? <div className="space-y-4 animate-in fade-in duration-300"><input autoFocus className="w-full bg-zinc-900/60 border border-indigo-500/40 rounded-xl px-4 py-2 text-white font-bold text-lg focus:outline-none focus:ring-1 focus:ring-indigo-500" value={contact.name} onChange={(e) => handleUpdateContact(contact.id, { name: e.target.value })} placeholder="姓名" /><input className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-400 text-xs uppercase tracking-widest font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500" value={contact.role} onChange={(e) => handleUpdateContact(contact.id, { role: e.target.value })} placeholder="身份描述" /><div className="flex items-center gap-4 mt-6"><input className="flex-1 bg-zinc-800/50 py-3 px-4 rounded-xl text-indigo-400 font-mono text-xs border border-zinc-800 focus:outline-none focus:ring-1 focus:ring-indigo-500" value={contact.tel} onChange={(e) => handleUpdateContact(contact.id, { tel: e.target.value })} placeholder="联系电话" /><button onClick={() => setEditingContactId(null)} className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-600/40"><i className="fas fa-check"></i></button></div></div> : <div><h4 className="text-white font-black text-lg mb-1">{contact.name}</h4><p className="text-zinc-500 text-xs mb-6 uppercase tracking-widest font-bold">{contact.role}</p><div className="flex items-center gap-4"><span className="flex-1 bg-zinc-800/50 py-3 px-4 rounded-xl text-zinc-300 font-mono text-xs">{contact.tel}</span><button onClick={() => setEditingContactId(contact.id)} className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center text-zinc-500 hover:bg-zinc-700 hover:text-white transition-all"><i className="fas fa-edit"></i></button></div></div>}
          </div>
        ))}
        <button onClick={handleAddNewContact} className="md:col-span-2 border-2 border-dashed border-zinc-800 rounded-[2rem] py-10 text-zinc-600 font-black uppercase tracking-widest hover:border-indigo-500/40 hover:text-indigo-500/60 transition-all flex flex-col items-center gap-3"><i className="fas fa-plus-circle text-2xl"></i>添加紧急联络人</button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#020202] text-zinc-300 font-sans selection:bg-indigo-500/30 overflow-hidden">
      <aside className="w-80 border-r border-zinc-800/60 flex flex-col p-10 gap-12 bg-[#050505] z-50">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-indigo-600 to-violet-700 rounded-2xl flex items-center justify-center shadow-2xl shadow-indigo-600/40 transform -rotate-6"><i className="fas fa-eye text-white text-2xl"></i></div>
          <div><h1 className="text-2xl font-black tracking-tight text-white italic leading-none">GUARDIAN</h1><p className="text-[10px] text-indigo-500 font-mono tracking-[0.3em] uppercase mt-1">Vision AI 2.5</p></div>
        </div>
        <nav className="flex flex-col gap-2 flex-1">
          <SidebarItem icon="fa-th-large" label="系统总览" active={view === 'dashboard'} onClick={() => setView('dashboard')} />
          <SidebarItem icon="fa-video" label="实时分析" active={view === 'analysis'} onClick={() => setView('analysis')} />
          <SidebarItem icon="fa-history" label="警报存档" active={view === 'history'} onClick={() => setView('history')} />
          <SidebarItem icon="fa-user-shield" label="联络设置" active={view === 'settings'} onClick={() => setView('settings')} />
        </nav>
        <div className="bg-indigo-600/5 border border-indigo-500/20 p-6 rounded-[2rem]">
          <p className="text-[9px] text-zinc-600 uppercase font-black mb-4 tracking-widest">Core Status</p>
          <div className="space-y-3">
            <div className="flex justify-between items-center text-[10px] font-mono"><span className="text-zinc-500">ENGINE</span><span className="text-emerald-500 font-black">ACTIVE</span></div>
            <div className="flex justify-between items-center text-[10px] font-mono"><span className="text-zinc-500">FPS</span><span className="text-zinc-100 font-black">30.2</span></div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-28 border-b border-zinc-800/60 flex items-center justify-between px-12 bg-[#050505]/40 backdrop-blur-3xl z-40">
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-4 italic tracking-tight"><span className={`w-3 h-3 rounded-full shadow-[0_0_15px_rgba(99,102,241,1)] ${status !== SystemStatus.IDLE ? 'bg-indigo-500 animate-pulse' : 'bg-zinc-700'}`}></span>{view === 'dashboard' ? '中央安全监控终端' : (view === 'analysis' ? '高级分析矩阵' : (view === 'history' ? '警报历史调取' : '系统联络中心'))}</h2>
            <p className="text-[10px] text-zinc-500 mt-1 uppercase font-bold tracking-widest">Node: Area-Alpha-Monitor-01</p>
          </div>
          <div className="flex items-center gap-6">
            <button onClick={toggleMonitoring} className={`px-10 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all transform active:scale-95 shadow-2xl ${status === SystemStatus.IDLE ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'}`}>{status === SystemStatus.IDLE ? '开启全时监控' : '挂起监控'}</button>
          </div>
        </header>

        <div className="flex-1 p-12 overflow-y-auto bg-[radial-gradient(circle_at_30%_10%,rgba(60,60,120,0.1),transparent_50%)]">
          <div className="max-w-[1400px] mx-auto">
            {view === 'dashboard' && renderDashboard()}
            {view === 'analysis' && renderAnalysis()}
            {view === 'history' && renderHistory()}
            {view === 'settings' && renderSettings()}
          </div>
        </div>
      </main>

      {isEmergencyActive && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 bg-zinc-900/95 backdrop-blur-3xl border border-indigo-500/50 px-12 py-8 rounded-[3rem] flex items-center gap-10 shadow-[0_40px_100px_rgba(0,0,0,0.9)] z-[100] animate-in slide-in-from-bottom-20 zoom-in duration-500">
          <div className="relative"><div className="w-16 h-16 rounded-[1.5rem] bg-indigo-600 flex items-center justify-center text-white text-2xl shadow-2xl shadow-indigo-600/50"><i className="fas fa-microphone"></i></div><div className="absolute -inset-2 rounded-[1.5rem] border-2 border-indigo-500/30 animate-ping"></div></div>
          <div><p className="text-white font-black text-sm uppercase tracking-[0.4em] mb-3 italic">正在建立双向对讲通讯...</p><div className="flex gap-2 items-end h-8">{[...Array(15)].map((_, i) => (<div key={i} className="w-2 bg-indigo-500 rounded-full animate-pulse shadow-[0_0_15px_rgba(99,102,241,0.6)]" style={{ height: `${30 + Math.random() * 70}%`, animationDelay: `${i * 0.05}s` }}></div>))}</div></div>
        </div>
      )}
    </div>
  );
};

export default App;
