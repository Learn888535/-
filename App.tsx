
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { SystemStatus, DetectionResult, ActivityLog, InferenceMode, SystemConfig, EmergencyContact } from './types';
import VideoDisplay from './components/VideoDisplay';
import StatsCard from './components/StatsCard';
import { analyzeScene, dispatchSpeak, stopSpeaking } from './services/aiService';

const PRESETS = {
  ALIBABA: { name: '阿里通义', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max' },
  ZHIPU: { name: '智谱 GLM', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v' },
  BAIDU: { name: '百度文心', url: 'https://qianfan.baidubce.com/v2', model: 'ernie-vl-plus' },
  DEEPSEEK: { name: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }
};

const STORAGE_KEY = 'guardian_config_v23';
const LOGS_KEY = 'guardian_logs_v23';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'monitor' | 'history' | 'settings'>('monitor');
  const [status, setStatus] = useState<SystemStatus>(SystemStatus.IDLE);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'danger'>('all');
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null);
  const [editingLog, setEditingLog] = useState<ActivityLog | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [config, setConfig] = useState<SystemConfig>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : {
      mode: InferenceMode.CLOUD,
      localEndpoint: 'http://localhost:11434',
      localModel: 'llava:latest',
      customBaseUrl: '',
      customApiKey: '',
      customModel: '',
      contacts: [{ id: '1', name: '紧急呼救中心', phone: '120', relation: '公共服务', isPrimary: true }],
      ttsRate: 1.0,
      voiceType: 'ai',
      aiVoiceName: 'Kore',
      customTtsUrl: '',
      customTtsApiKey: '',
      customTtsModel: ''
    };
  });
  
  const [lastDetection, setLastDetection] = useState<DetectionResult>({ isFallDetected: false, confidence: 0, reasoning: "系统就绪", posture: "none" });
  const [logs, setLogs] = useState<ActivityLog[]>(() => {
    const saved = localStorage.getItem(LOGS_KEY);
    if (!saved) return [];
    try {
      return JSON.parse(saved).map((l: any) => ({ ...l, timestamp: new Date(l.timestamp) }));
    } catch { return []; }
  });
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    localStorage.setItem(LOGS_KEY, JSON.stringify(logs));
  }, [config, logs]);

  useEffect(() => {
    const checkStandalone = () => {
      const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
      setIsStandalone(!!isStandaloneMode);
    };
    checkStandalone();
  }, []);

  const addLog = useCallback((event: string, type: ActivityLog['type'] = 'human', logStatus: ActivityLog['status'] = 'info') => {
    setLogs(prev => [{ id: Math.random().toString(36).substr(2, 9), timestamp: new Date(), event, type, status: logStatus, note: "" }, ...prev].slice(0, 500));
  }, []);

  const handleUpdateLog = (updatedLog: ActivityLog) => {
    setLogs(prev => prev.map(log => log.id === updatedLog.id ? updatedLog : log));
    setEditingLog(null);
  };

  const handleSaveContact = () => {
    if (!editingContact) return;
    if (!editingContact.name || !editingContact.phone) {
      alert("请完整填写联系人姓名和电话");
      return;
    }
    setConfig(prev => {
      const exists = prev.contacts.find(c => c.id === editingContact.id);
      let newContacts = exists 
        ? prev.contacts.map(c => c.id === editingContact.id ? editingContact : c) 
        : [...prev.contacts, editingContact];
      
      if (editingContact.isPrimary) {
        newContacts = newContacts.map(c => ({ ...c, isPrimary: c.id === editingContact.id }));
      }
      return { ...prev, contacts: newContacts };
    });
    setEditingContact(null);
  };

  const downloadLogsCSV = () => {
    if (logs.length === 0) return alert("暂无数据可导出");
    const header = ['ID', '日期时间', '事件', '类别', '状态', '备注'];
    const rows = logs.map(log => [
      log.id, 
      log.timestamp.toLocaleString(), 
      log.event.replace(/,/g, '，'), 
      log.type, 
      log.status, 
      (log.note || '').replace(/,/g, '，')
    ]);
    const csvContent = "\uFEFF" + [header, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Guardian_安全报表_${new Date().getTime()}.csv`;
    link.click();
  };

  const exportConfig = () => {
    const dataStr = JSON.stringify(config, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "Guardian_Config_Backup.json";
    link.click();
  };

  const importConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        setConfig(json);
        alert("配置恢复成功！");
      } catch (err) {
        alert("无效的备份文件");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleFrameAnalysis = useCallback(async (base64: string) => {
    if (status !== SystemStatus.MONITORING || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeScene(base64, config);
      setLastDetection(result);
      if (result.isFallDetected && result.confidence > 0.4) {
        addLog(`[紧急] 检测到跌倒风险! ${result.reasoning}`, 'fall', 'danger');
        setStatus(SystemStatus.ALERT);
        dispatchSpeak(`警报！监测到意外。请问您需要帮助吗？`, config);
        setCountdown(10);
      } else if (result.confidence > 0.2) {
        addLog(`动态更新：${result.reasoning}`, 'human', 'info');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsAnalyzing(false);
    }
  }, [status, isAnalyzing, config, addLog]);

  useEffect(() => {
    let timer: any;
    if (status === SystemStatus.ALERT && countdown > 0) {
      timer = setInterval(() => setCountdown(prev => prev - 1), 1000);
    } else if (status === SystemStatus.ALERT && countdown === 0) {
      setStatus(SystemStatus.EMERGENCY);
      dispatchSpeak(`确认险情。正在呼叫紧急联系人，请保持冷静。`, config);
      addLog(`执行紧急救援程序`, 'contact', 'danger');
    }
    return () => clearInterval(timer);
  }, [status, countdown, config, addLog]);

  return (
    <div className="flex h-screen bg-[#050505] text-zinc-300 font-sans overflow-hidden">
      {/* 侧边导航 */}
      <nav className="w-20 lg:w-64 border-r border-white/5 flex flex-col p-6 bg-black/40 backdrop-blur-3xl z-50">
        <div className="flex items-center gap-4 mb-14 px-2">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/30">
            <i className="fas fa-radar text-white animate-pulse"></i>
          </div>
          <span className="hidden lg:block text-lg font-black italic text-white tracking-widest uppercase">Guardian</span>
        </div>
        <div className="flex flex-col gap-2">
          <NavTab active={activeTab === 'monitor'} onClick={() => setActiveTab('monitor')} icon="fa-desktop" label="实时监控" />
          <NavTab active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon="fa-list-ul" label="安全日志" />
          <NavTab active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon="fa-gear" label="系统配置" />
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto p-8 lg:p-12 custom-scrollbar relative">
        {activeTab === 'monitor' && (
          <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in">
            <header className="flex justify-between items-center">
              <div>
                <h2 className="text-3xl font-black text-white italic tracking-tight uppercase">监控中心</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">系统状态: {
                    status === SystemStatus.IDLE ? '待机' : 
                    status === SystemStatus.MONITORING ? '布防中' : 
                    status === SystemStatus.ALERT ? '二次确认' : '紧急响应'
                  }</span>
                  {isStandalone && <span className="text-[8px] bg-indigo-600/20 text-indigo-400 px-2 py-0.5 rounded-full font-black uppercase">App 模式</span>}
                </div>
              </div>
              <button onClick={() => setStatus(status === SystemStatus.IDLE ? SystemStatus.MONITORING : SystemStatus.IDLE)} 
                className={`px-10 py-3 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all ${
                status === SystemStatus.IDLE ? 'bg-indigo-600 text-white shadow-xl hover:scale-105' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}>
                {status === SystemStatus.IDLE ? '部署全屋布防' : '撤下监控系统'}
              </button>
            </header>
            
            <div className="grid grid-cols-12 gap-8">
              <div className="col-span-12 xl:col-span-8 space-y-8">
                <VideoDisplay isMonitoring={status === SystemStatus.MONITORING} isAnalyzing={isAnalyzing} status={status === SystemStatus.ALERT ? 'danger' : 'safe'} onFrame={handleFrameAnalysis} />
                <div className="grid grid-cols-3 gap-4">
                  <StatsCard label="肢体姿态" value={lastDetection.posture} icon="fa-street-view" color="amber" />
                  <StatsCard label="判定信心" value={`${Math.round(lastDetection.confidence * 100)}%`} icon="fa-brain" color="emerald" loading={isAnalyzing} />
                  <StatsCard label="首选救护人" value={config.contacts.find(c => c.isPrimary)?.name || '未设置'} icon="fa-phone" color="indigo" />
                </div>
              </div>
              <div className="col-span-12 xl:col-span-4 bg-zinc-900/40 border border-white/5 rounded-3xl p-8 flex flex-col h-[600px] shadow-2xl overflow-hidden backdrop-blur-md">
                <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-6">实时简报</h3>
                <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                  {logs.slice(0, 15).map(log => (
                    <div key={log.id} className={`p-4 rounded-2xl border transition-all ${log.status === 'danger' ? 'bg-rose-500/10 border-rose-500/20 animate-pulse' : 'bg-white/5 border-white/5'}`}>
                      <div className="flex justify-between text-[8px] font-black mb-1 uppercase tracking-tighter">
                        <span className={log.status === 'danger' ? 'text-rose-500' : 'text-indigo-400'}>{log.type === 'fall' ? '风险' : '日常'}</span>
                        <span className="text-zinc-600">{log.timestamp.toLocaleTimeString()}</span>
                      </div>
                      <p className="text-xs font-bold text-zinc-200 leading-snug">{log.event}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="max-w-5xl mx-auto space-y-8 animate-in slide-in-from-bottom-4">
            <header className="flex justify-between items-end">
              <div>
                <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">安全档案记录</h2>
                <p className="text-zinc-500 text-[10px] font-black mt-2 tracking-widest uppercase">存档负载: {logs.length} / 500 条</p>
              </div>
              <div className="flex items-center gap-4">
                <button onClick={downloadLogsCSV} className="px-6 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-700 flex items-center gap-2 border border-white/5">
                  <i className="fas fa-file-csv text-indigo-500"></i> 下载报表 (CSV)
                </button>
                <div className="flex gap-2 bg-zinc-900 p-1.5 rounded-xl border border-white/5">
                  <button onClick={() => setHistoryFilter('all')} className={`px-6 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${historyFilter === 'all' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500'}`}>全部日志</button>
                  <button onClick={() => setHistoryFilter('danger')} className={`px-6 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${historyFilter === 'danger' ? 'bg-rose-600 text-white shadow-lg' : 'text-zinc-500'}`}>仅高危</button>
                </div>
              </div>
            </header>

            <div className="bg-zinc-900/40 border border-white/5 rounded-[2.5rem] overflow-hidden shadow-2xl">
              <div className="max-h-[65vh] overflow-y-auto custom-scrollbar">
                {logs.filter(l => historyFilter === 'all' || l.status === 'danger').map((log) => (
                  <div key={log.id} className="p-8 border-b border-white/5 hover:bg-white/[0.02] flex items-center gap-8 group">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${log.status === 'danger' ? 'bg-rose-500/20 text-rose-500' : 'bg-indigo-500/20 text-indigo-400'}`}>
                      <i className={`fas ${log.type === 'fall' ? 'fa-user-injured' : 'fa-info-circle'} text-xl`}></i>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{log.timestamp.toLocaleString()}</span>
                        {log.status === 'danger' && <span className="bg-rose-600 text-white text-[8px] px-2 py-0.5 rounded font-black uppercase">高风险</span>}
                      </div>
                      <p className="text-lg font-bold text-zinc-100 italic">{log.event}</p>
                      {log.note && <p className="text-xs text-zinc-500 mt-2 p-3 bg-black/40 rounded-xl border border-white/5 italic">备注：{log.note}</p>}
                    </div>
                    <button onClick={() => setEditingLog(log)} className="opacity-0 group-hover:opacity-100 transition-opacity px-6 py-3 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black uppercase text-indigo-400 hover:bg-indigo-600 hover:text-white">添加标注</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-5xl mx-auto space-y-12 animate-in slide-in-from-bottom-4 pb-32">
            <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase mb-12 flex items-center gap-4">
              <i className="fas fa-sliders-h text-indigo-600"></i> 全局参数与部署
            </h2>
            
            {/* 跨平台部署手册 */}
            <section className="bg-gradient-to-br from-indigo-600/20 to-zinc-900 border border-white/10 p-10 rounded-[3rem] shadow-2xl relative overflow-hidden">
               <div className="absolute top-0 right-0 p-12 text-white/5 text-[12rem] pointer-events-none transform translate-x-1/4 -translate-y-1/4">
                 <i className="fas fa-cloud-download-alt"></i>
               </div>
              <h3 className="text-xl font-black text-white italic mb-10 uppercase tracking-widest flex items-center gap-4 border-l-4 border-indigo-600 pl-6">
                跨平台部署与安装中心
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
                <DeployCard icon="fa-windows" title="PC / Windows" 
                  desc="在 Edge 或 Chrome 中打开地址，点击右侧“安装”图标即可生成桌面快捷方式。" 
                  hint="支持固定至任务栏，提供独立窗口体验" />
                <DeployCard icon="fa-apple" title="iPhone / iOS" 
                  desc="使用 Safari 打开并点击“分享”，选择“添加到主屏幕”，应用将像原生 App 一样开启。" 
                  hint="无浏览器地址栏，沉浸式全屏体验" />
                <DeployCard icon="fa-android" title="安卓 / 鸿蒙" 
                  desc="在 Chrome 中打开菜单，选择“安装应用”，系统将自动同步权限并创建图标。" 
                  hint="支持系统级后台监听与实时提醒" />
              </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* 推理配置 */}
              <section className="bg-zinc-900/40 border border-white/5 p-10 rounded-[3rem] shadow-xl backdrop-blur-md">
                <h3 className="text-lg font-black text-white italic mb-8 uppercase tracking-widest border-l-4 border-emerald-600 pl-4">AI 推理引擎 (Inference)</h3>
                <div className="grid grid-cols-3 gap-2 p-1 bg-black rounded-xl border border-white/5 mb-8">
                  {[InferenceMode.CLOUD, InferenceMode.LOCAL, InferenceMode.CUSTOM].map(m => (
                    <button key={m} onClick={() => setConfig({...config, mode: m})} className={`py-3 rounded-lg text-[10px] font-black uppercase transition-all ${config.mode === m ? 'bg-emerald-600 text-white shadow-lg' : 'text-zinc-600'}`}>{m === 'CLOUD' ? '云端' : m === 'LOCAL' ? '本地' : '自定义'}</button>
                  ))}
                </div>

                <div className="space-y-6">
                  {config.mode === InferenceMode.CLOUD && (
                    <div className="p-6 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl">
                      <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                        <i className="fas fa-shield-check"></i> 智能托管激活
                      </p>
                      <p className="text-xs text-zinc-500 leading-relaxed font-medium">当前由 Google Gemini 提供深度推理。API Key 已通过安全通道注入，您无需任何设置即可直接使用。</p>
                    </div>
                  )}

                  {config.mode === InferenceMode.LOCAL && (
                    <div className="space-y-4">
                      <InputGroup label="Ollama 地址" value={config.localEndpoint} onChange={v => setConfig({...config, localEndpoint: v})} />
                      <InputGroup label="本地模型名" value={config.localModel} onChange={v => setConfig({...config, localModel: v})} />
                    </div>
                  )}

                  {config.mode === InferenceMode.CUSTOM && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-2 mb-4">
                        {Object.entries(PRESETS).map(([key, p]) => (
                          <button key={key} onClick={() => setConfig({...config, customBaseUrl: p.url, customModel: p.model})} className="py-2.5 bg-zinc-800 border border-white/5 rounded-lg text-[9px] font-black uppercase text-zinc-400 hover:text-white transition-colors">{p.name}</button>
                        ))}
                      </div>
                      <InputGroup label="API Base URL" value={config.customBaseUrl} onChange={v => setConfig({...config, customBaseUrl: v})} />
                      <InputGroup label="API Key" value={config.customApiKey} type="password" onChange={v => setConfig({...config, customApiKey: v})} />
                      <InputGroup label="Model Name" value={config.customModel} onChange={v => setConfig({...config, customModel: v})} />
                    </div>
                  )}
                </div>
              </section>

              {/* 配置迁移 */}
              <section className="bg-zinc-900/40 border border-white/5 p-10 rounded-[3rem] shadow-xl flex flex-col justify-between backdrop-blur-md">
                <div>
                  <h3 className="text-lg font-black text-white italic mb-8 uppercase tracking-widest border-l-4 border-amber-600 pl-4">同步与迁移 (Sync)</h3>
                  <div className="space-y-5">
                    <p className="text-xs text-zinc-500 leading-relaxed">您可以将当前的所有设置（含 AI 配置和联系人）导出为 JSON 文件，并在另一台设备上快速恢复。</p>
                    <div className="grid grid-cols-2 gap-4">
                      <button onClick={exportConfig} className="py-5 bg-zinc-800 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-3 hover:bg-zinc-700 transition-all border border-white/5">
                        <i className="fas fa-file-export text-amber-500"></i> 导出配置备份
                      </button>
                      <button onClick={() => fileInputRef.current?.click()} className="py-5 bg-zinc-800 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-3 hover:bg-zinc-700 transition-all border border-white/5">
                        <i className="fas fa-file-import text-indigo-500"></i> 导入配置备份
                      </button>
                    </div>
                    <input type="file" ref={fileInputRef} onChange={importConfig} className="hidden" accept=".json" />
                  </div>
                </div>
                <div className="mt-8 pt-8 border-t border-white/5">
                   <InputGroup label="播报语速 (0.5 - 2.0)" value={config.ttsRate.toString()} onChange={v => setConfig({...config, ttsRate: parseFloat(v)})} />
                </div>
              </section>

              {/* 联络人管理 */}
              <section className="bg-zinc-900/40 border border-white/5 p-10 rounded-[3rem] shadow-xl backdrop-blur-md lg:col-span-2">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-lg font-black text-white italic uppercase tracking-widest border-l-4 border-rose-600 pl-4">紧急救护联络网</h3>
                  <button onClick={() => setEditingContact({ id: Date.now().toString(), name: '', phone: '', relation: '', isPrimary: false })} 
                    className="h-12 px-6 bg-rose-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-rose-900/20 hover:scale-105 transition-all text-[10px] font-black uppercase tracking-widest gap-2">
                    <i className="fas fa-plus"></i> 新增联络人
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {config.contacts.map(c => (
                    <div key={c.id} className={`p-6 rounded-3xl border transition-all ${c.isPrimary ? 'bg-rose-500/10 border-rose-500/30 ring-1 ring-rose-500/20' : 'bg-white/5 border-white/10'}`}>
                      <div className="flex justify-between items-start">
                        <div className="flex gap-4 items-center">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${c.isPrimary ? 'bg-rose-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>
                            <i className="fas fa-user-shield text-lg"></i>
                          </div>
                          <div>
                            <p className="text-sm font-black text-white flex items-center gap-2 italic">
                              {c.name} {c.isPrimary && <span className="bg-rose-600 text-white text-[8px] px-2 py-0.5 rounded font-black uppercase">主要</span>}
                            </p>
                            <p className="text-[10px] text-zinc-500 font-mono mt-1 tracking-wider uppercase">{c.phone} · {c.relation}</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => setEditingContact(c)} className="w-10 h-10 rounded-xl bg-zinc-900 text-zinc-500 hover:text-indigo-400 flex items-center justify-center border border-white/5 transition-colors"><i className="fas fa-pen text-[10px]"></i></button>
                          <button onClick={() => setConfig({...config, contacts: config.contacts.filter(con => con.id !== c.id)})} className="w-10 h-10 rounded-xl bg-zinc-900 text-zinc-500 hover:text-rose-500 flex items-center justify-center border border-white/5 transition-colors"><i className="fas fa-trash text-[10px]"></i></button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {config.contacts.length === 0 && <div className="md:col-span-2 py-10 text-center text-zinc-600 border border-dashed border-white/10 rounded-2xl">未配置联系人</div>}
                </div>
              </section>
            </div>
          </div>
        )}

        {/* 弹窗部分 */}
        {editingContact && (
          <div className="fixed inset-0 bg-black/95 backdrop-blur-3xl z-[200] flex items-center justify-center p-6 animate-in fade-in">
            <div className="bg-zinc-950 border border-white/10 p-10 rounded-[3rem] w-full max-w-md shadow-2xl">
              <h3 className="text-2xl font-black italic text-white uppercase mb-8">编辑救护联络人</h3>
              <div className="space-y-6">
                <InputGroup label="姓名" value={editingContact.name} onChange={v => setEditingContact({...editingContact, name: v})} />
                <InputGroup label="手机号码" value={editingContact.phone} onChange={v => setEditingContact({...editingContact, phone: v})} />
                <InputGroup label="身份/关系" value={editingContact.relation} onChange={v => setEditingContact({...editingContact, relation: v})} />
                <div className="flex items-center gap-4 p-4 bg-white/5 rounded-2xl border border-white/5 cursor-pointer" onClick={() => setEditingContact({...editingContact, isPrimary: !editingContact.isPrimary})}>
                  <input type="checkbox" checked={editingContact.isPrimary} onChange={() => {}} className="w-5 h-5 accent-indigo-600" />
                  <label className="text-xs font-black text-zinc-400 uppercase tracking-widest cursor-pointer">标记为紧急首选救护人</label>
                </div>
              </div>
              <div className="flex gap-4 mt-12">
                <button onClick={() => setEditingContact(null)} className="flex-1 py-5 bg-zinc-900 rounded-2xl text-[10px] font-black uppercase text-zinc-500">取消</button>
                <button onClick={handleSaveContact} className="flex-1 py-5 bg-indigo-600 rounded-2xl text-[10px] font-black uppercase text-white shadow-xl shadow-indigo-900/20">保存设置</button>
              </div>
            </div>
          </div>
        )}

        {editingLog && (
          <div className="fixed inset-0 bg-black/95 backdrop-blur-3xl z-[200] flex items-center justify-center p-6 animate-in fade-in">
            <div className="bg-zinc-950 border border-white/10 p-10 rounded-[3rem] w-full max-w-lg shadow-2xl">
              <h3 className="text-2xl font-black italic text-white uppercase mb-8 tracking-tighter">添加存档标注</h3>
              <div className="space-y-6">
                <div className="p-5 bg-indigo-600/10 border border-indigo-600/20 rounded-2xl mb-4">
                  <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">原始事件记录</p>
                  <p className="text-sm font-bold text-white">{editingLog.event}</p>
                </div>
                <textarea className="w-full h-40 bg-black border border-white/10 p-6 rounded-3xl text-sm text-zinc-200 outline-none focus:border-indigo-600 transition-colors" placeholder="输入情况跟进或误报说明..." value={editingLog.note || ""} onChange={e => setEditingLog({...editingLog, note: e.target.value})} />
              </div>
              <div className="flex gap-4 mt-12">
                <button onClick={() => setEditingLog(null)} className="flex-1 py-5 bg-zinc-900 rounded-2xl text-[10px] font-black uppercase text-zinc-500">关闭</button>
                <button onClick={() => handleUpdateLog(editingLog)} className="flex-1 py-5 bg-indigo-600 rounded-2xl text-[10px] font-black uppercase text-white shadow-xl shadow-indigo-900/20">保存标注</button>
              </div>
            </div>
          </div>
        )}

        {status === SystemStatus.ALERT && (
          <div className="fixed inset-0 bg-black/98 backdrop-blur-[100px] z-[300] flex items-center justify-center p-8 animate-in zoom-in-110">
            <div className="max-w-2xl w-full text-center">
              <div className="text-[14rem] font-black text-white mb-6 leading-none tracking-tighter italic">{countdown}</div>
              <h2 className="text-4xl font-black text-rose-500 italic mb-12 uppercase tracking-tight">监测到高度跌倒风险 // 确认为意外？</h2>
              <div className="grid grid-cols-2 gap-6">
                <button onClick={() => { stopSpeaking(); setStatus(SystemStatus.MONITORING); addLog("人工干预：标记为误报", "human", "info"); }} className="py-8 bg-zinc-900 text-zinc-500 rounded-3xl font-black uppercase tracking-[0.2em] text-xs hover:text-white transition-all">安全，解除警报</button>
                <button onClick={() => { stopSpeaking(); setStatus(SystemStatus.EMERGENCY); }} className="py-8 bg-rose-600 text-white rounded-3xl font-black uppercase shadow-2xl shadow-rose-600/40 tracking-[0.2em] text-xs transition-all active:scale-95">确认为险情，呼救</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const NavTab: React.FC<{ active: boolean; onClick: () => void; icon: string; label: string }> = ({ active, onClick, icon, label }) => (
  <button onClick={onClick} className={`w-full flex items-center gap-5 p-5 rounded-2xl transition-all relative group ${
    active ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/20' : 'text-zinc-600 hover:bg-white/5 hover:text-zinc-300'
  }`}>
    <div className="w-6 text-center transition-transform group-hover:scale-110"><i className={`fas ${icon} text-xl`}></i></div>
    <span className="hidden lg:block text-[10px] font-black tracking-[0.15em] uppercase">{label}</span>
    {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-10 bg-white rounded-full"></div>}
  </button>
);

const InputGroup: React.FC<{ label: string; value: string; onChange: (v: string) => void; type?: string }> = ({ label, value, onChange, type = "text" }) => (
  <div className="space-y-2">
    <label className="text-[9px] font-black text-zinc-600 uppercase ml-1 tracking-widest">{label}</label>
    <input type={type} className="w-full bg-black border border-white/10 p-5 rounded-2xl text-sm font-bold text-zinc-100 outline-none focus:border-indigo-600 transition-colors shadow-inner" value={value} onChange={e => onChange(e.target.value)} />
  </div>
);

const DeployCard: React.FC<{ icon: string; title: string; desc: string; hint: string }> = ({ icon, title, desc, hint }) => (
  <div className="bg-black/40 border border-white/5 p-8 rounded-[2rem] hover:bg-black/60 transition-all group relative overflow-hidden">
    <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center text-white mb-6 group-hover:bg-indigo-600 transition-all duration-300">
      <i className={`fab ${icon} text-2xl`}></i>
    </div>
    <h4 className="text-xs font-black text-white uppercase tracking-widest mb-3 italic">{title}</h4>
    <p className="text-[10px] text-zinc-500 leading-relaxed mb-6 font-medium">{desc}</p>
    <div className="pt-5 border-t border-white/5 text-[8px] font-black text-indigo-400 uppercase">贴士: {hint}</div>
  </div>
);

export default App;
