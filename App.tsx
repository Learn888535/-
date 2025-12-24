
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

const STORAGE_KEY = 'guardian_config_v18';
const LOGS_KEY = 'guardian_logs_v18';

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
  
  const [lastDetection, setLastDetection] = useState<DetectionResult>({ isFallDetected: false, confidence: 0, reasoning: "就绪", posture: "none" });
  const [logs, setLogs] = useState<ActivityLog[]>(() => {
    const saved = localStorage.getItem(LOGS_KEY);
    return saved ? JSON.parse(saved).map((l: any) => ({ ...l, timestamp: new Date(l.timestamp) })) : [];
  });
  const [countdown, setCountdown] = useState(10);
  const [currentTTS, setCurrentTTS] = useState<string>("");

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

  const applyPreset = (preset: typeof PRESETS.ALIBABA) => {
    setConfig(prev => ({ ...prev, customBaseUrl: preset.url, customModel: preset.model, mode: InferenceMode.CUSTOM }));
  };

  const downloadLogsCSV = () => {
    const header = ['编号', '时间', '事件内容', '类型', '风险等级', '备注'];
    const rows = logs.map(log => [log.id, log.timestamp.toLocaleString(), log.event.replace(/,/g, '，'), log.type, log.status, (log.note || '').replace(/,/g, '，')]);
    const csvContent = "\uFEFF" + [header, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `guardian_logs.csv`);
    link.click();
  };

  // 联络人管理核心逻辑
  const handleSaveContact = () => {
    if (!editingContact) return;
    if (!editingContact.name || !editingContact.phone) {
      alert("请填写完整的姓名和电话");
      return;
    }

    setConfig(prev => {
      const exists = prev.contacts.find(c => c.id === editingContact.id);
      let newContacts;
      if (exists) {
        newContacts = prev.contacts.map(c => c.id === editingContact.id ? editingContact : c);
      } else {
        newContacts = [...prev.contacts, editingContact];
      }
      return { ...prev, contacts: newContacts };
    });
    setEditingContact(null);
  };

  const handleDeleteContact = (id: string) => {
    if (confirm("确定要删除此联系人吗？")) {
      setConfig(prev => ({
        ...prev,
        contacts: prev.contacts.filter(c => c.id !== id)
      }));
    }
  };

  const handleSetPrimaryContact = (id: string) => {
    setConfig(prev => ({
      ...prev,
      contacts: prev.contacts.map(c => ({
        ...c,
        isPrimary: c.id === id
      }))
    }));
  };

  const handleFrameAnalysis = useCallback(async (base64: string) => {
    if (status !== SystemStatus.MONITORING || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeScene(base64, config);
      setLastDetection(result);
      if (result.isFallDetected && result.confidence > 0.4) {
        addLog(`[严重] 检测到跌倒! ${result.reasoning}`, 'fall', 'danger');
        setStatus(SystemStatus.ALERT);
        const msg = `警报！检测到风险。请问您需要帮助吗？我们将于十秒内呼叫救援人员。`;
        setCurrentTTS(msg);
        setCountdown(10);
        dispatchSpeak(msg, config);
      } else if (result.confidence > 0.2) {
        addLog(`分析：${result.reasoning}`, 'human', 'info');
      }
    } catch (e) {
      addLog("传感器链路波动", "system", "warning");
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
      const msg = `确认险情。正在通知紧急联系人。`;
      setCurrentTTS(msg);
      dispatchSpeak(msg, config);
      addLog(`执行紧急呼叫程序`, 'contact', 'danger');
    }
    return () => clearInterval(timer);
  }, [status, countdown]);

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
          <NavTab active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon="fa-gear" label="配置中心" />
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto p-8 lg:p-12 custom-scrollbar relative">
        {activeTab === 'monitor' && (
          <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in">
            <header className="flex justify-between items-center">
              <div>
                <h2 className="text-3xl font-black text-white italic tracking-tight">监控中心</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Status: {status}</span>
                  {isStandalone && <span className="text-[8px] bg-indigo-600/20 text-indigo-400 px-2 py-0.5 rounded-full font-black uppercase">App Mode</span>}
                </div>
              </div>
              <button onClick={() => setStatus(status === SystemStatus.IDLE ? SystemStatus.MONITORING : SystemStatus.IDLE)} 
                className={`px-10 py-3 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all ${
                status === SystemStatus.IDLE ? 'bg-indigo-600 text-white shadow-xl hover:scale-105' : 'bg-zinc-800 text-zinc-500'
              }`}>
                {status === SystemStatus.IDLE ? '部署系统' : '停止监控'}
              </button>
            </header>
            
            <div className="grid grid-cols-12 gap-8">
              <div className="col-span-12 xl:col-span-8 space-y-8">
                <VideoDisplay isMonitoring={status === SystemStatus.MONITORING} isAnalyzing={isAnalyzing} status={status === SystemStatus.ALERT ? 'danger' : 'safe'} onFrame={handleFrameAnalysis} />
                <div className="grid grid-cols-3 gap-4">
                  <StatsCard label="肢体姿态" value={lastDetection.posture} icon="fa-street-view" color="amber" />
                  <StatsCard label="判定信心" value={`${Math.round(lastDetection.confidence * 100)}%`} icon="fa-brain" color="emerald" loading={isAnalyzing} />
                  <StatsCard label="联络状态" value={config.contacts.find(c => c.isPrimary)?.name || '未设置'} icon="fa-phone" color="indigo" />
                </div>
              </div>
              <div className="col-span-12 xl:col-span-4 bg-zinc-900/40 border border-white/5 rounded-3xl p-8 flex flex-col h-[600px] shadow-2xl overflow-hidden">
                <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-6">实时简报</h3>
                <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                  {logs.slice(0, 20).map(log => (
                    <div key={log.id} className={`p-4 rounded-2xl border ${log.status === 'danger' ? 'bg-rose-500/10 border-rose-500/20' : 'bg-white/5 border-white/5'}`}>
                      <div className="flex justify-between text-[8px] font-black mb-1 uppercase tracking-tighter">
                        <span className={log.status === 'danger' ? 'text-rose-500' : 'text-indigo-400'}>{log.type}</span>
                        <span className="text-zinc-600">{log.timestamp.toLocaleTimeString()}</span>
                      </div>
                      <p className="text-xs font-bold text-zinc-200">{log.event}</p>
                    </div>
                  ))}
                  {logs.length === 0 && <p className="text-center text-zinc-600 text-[10px] mt-10">暂无事件记录</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="max-w-5xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-500">
            <header className="flex justify-between items-end">
              <div>
                <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase">安全存档</h2>
                <p className="text-zinc-500 text-xs font-bold mt-2 tracking-widest uppercase">Archive Capacity: {logs.length} / 500</p>
              </div>
              <div className="flex gap-3">
                <button onClick={downloadLogsCSV} className="px-6 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-700">CSV 导出</button>
                <div className="flex gap-2 bg-zinc-900 p-1.5 rounded-xl border border-white/5">
                  <button onClick={() => setHistoryFilter('all')} className={`px-6 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${historyFilter === 'all' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500'}`}>全部</button>
                  <button onClick={() => setHistoryFilter('danger')} className={`px-6 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${historyFilter === 'danger' ? 'bg-rose-600 text-white shadow-lg' : 'text-zinc-500'}`}>异常</button>
                </div>
              </div>
            </header>

            <div className="bg-zinc-900/40 border border-white/5 rounded-[2.5rem] overflow-hidden shadow-2xl">
              <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/5">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">历史日志序列</span>
                <button onClick={() => { if(confirm('确认清空记录？')) setLogs([]); }} className="text-[10px] font-black text-rose-500 uppercase tracking-widest">清空</button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
                {logs.filter(l => historyFilter === 'all' || l.status === 'danger').map((log, idx) => (
                    <div key={log.id} className="p-8 border-b border-white/5 hover:bg-white/[0.02] flex items-center gap-6">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${log.status === 'danger' ? 'bg-rose-600/20 text-rose-500' : 'bg-indigo-600/20 text-indigo-500'}`}>
                        <i className={`fas ${log.type === 'fall' ? 'fa-user-injured' : 'fa-walking'}`}></i>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-bold text-zinc-100">{log.event}</p>
                        <p className="text-[10px] text-zinc-600 font-medium uppercase mt-1">{log.timestamp.toLocaleString()}</p>
                      </div>
                      <button onClick={() => setEditingLog(log)} className="text-[10px] font-black text-indigo-400 uppercase tracking-widest px-4 py-2 bg-white/5 rounded-lg border border-white/5">编辑</button>
                    </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-5xl mx-auto space-y-10 animate-in slide-in-from-bottom-4 duration-500 pb-20">
            <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase mb-12">系统深度配置</h2>
            
            {/* 跨平台 App 状态卡片 */}
            <div className="bg-indigo-600/10 border border-indigo-500/20 p-8 rounded-[2.5rem] flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl">
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center text-3xl text-white shadow-xl shadow-indigo-600/40">
                  <i className={isStandalone ? "fas fa-mobile-screen-button" : "fas fa-globe"}></i>
                </div>
                <div>
                  <h3 className="text-xl font-black text-white italic uppercase tracking-tight">应用运行模式</h3>
                  <p className="text-xs text-zinc-400 mt-1 font-medium">
                    {isStandalone ? "当前处于独立 App 模式，已获得完整的系统级体验。" : "当前正在网页中预览。建议将其“添加到主屏幕”以获得全屏 App 体验。"}
                  </p>
                </div>
              </div>
              {!isStandalone && (
                <div className="text-right hidden md:block">
                  <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">安装提示</p>
                  <p className="text-[9px] text-zinc-500 mt-1">iOS: 分享 -> 添加到主屏幕<br/>Android/PC: 地址栏安装按钮</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* 视觉推理核配置面板 */}
              <section className="bg-zinc-900/40 border border-white/5 p-10 rounded-[3rem] shadow-xl">
                <h3 className="text-lg font-black text-white italic mb-8 uppercase tracking-widest border-l-4 border-indigo-600 pl-4">视觉推理核 (Inference)</h3>
                <div className="space-y-6">
                  <div className="grid grid-cols-3 gap-2 p-1 bg-black rounded-xl border border-white/5">
                    {[InferenceMode.CLOUD, InferenceMode.LOCAL, InferenceMode.CUSTOM].map(m => (
                      <button key={m} onClick={() => setConfig({...config, mode: m})} className={`py-3 rounded-lg text-[10px] font-black uppercase transition-all ${config.mode === m ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-600'}`}>{m}</button>
                    ))}
                  </div>

                  {config.mode === InferenceMode.CLOUD && (
                    <div className="p-6 bg-indigo-500/5 border border-indigo-500/10 rounded-2xl animate-in fade-in">
                      <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                        <i className="fas fa-shield-halved"></i> 托管模式激活
                      </p>
                      <p className="text-xs text-zinc-500 leading-relaxed">系统正在使用云端 Gemini 推理引擎。API Key 已通过环境安全通道自动注入，无需手动配置。</p>
                    </div>
                  )}

                  {config.mode === InferenceMode.LOCAL && (
                    <div className="space-y-5 animate-in fade-in zoom-in-95">
                      <div className="space-y-1.5">
                        <label className="text-[8px] font-black text-zinc-600 uppercase ml-2">本地端点 (Ollama Endpoint)</label>
                        <input type="text" value={config.localEndpoint} onChange={e => setConfig({...config, localEndpoint: e.target.value})} className="w-full bg-black/50 border border-white/10 p-4 rounded-xl text-xs font-mono text-indigo-400 focus:border-indigo-500 outline-none" placeholder="e.g. http://localhost:11434" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[8px] font-black text-zinc-600 uppercase ml-2">本地模型名称 (Model Tag)</label>
                        <input type="text" value={config.localModel} onChange={e => setConfig({...config, localModel: e.target.value})} className="w-full bg-black/50 border border-white/10 p-4 rounded-xl text-xs font-mono text-zinc-100 focus:border-indigo-500 outline-none" placeholder="e.g. llava:latest" />
                      </div>
                    </div>
                  )}

                  {config.mode === InferenceMode.CUSTOM && (
                    <div className="space-y-6 animate-in fade-in zoom-in-95">
                      <div className="space-y-3">
                        <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">快捷预设 (Presets)</label>
                        <div className="grid grid-cols-2 gap-2">
                          {Object.entries(PRESETS).map(([key, preset]) => (
                            <button key={key} onClick={() => applyPreset(preset)} className="py-2.5 bg-zinc-800 border border-white/5 rounded-lg text-[9px] font-black text-zinc-400 hover:bg-zinc-700 hover:text-white transition-all uppercase">
                              {preset.name}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-4 pt-4 border-t border-white/5">
                        <div className="space-y-1.5">
                          <label className="text-[8px] font-black text-zinc-600 uppercase ml-2">API Base URL</label>
                          <input type="text" value={config.customBaseUrl} onChange={e => setConfig({...config, customBaseUrl: e.target.value})} className="w-full bg-black/50 border border-white/10 p-4 rounded-xl text-xs font-mono text-indigo-400 focus:border-indigo-500 outline-none" placeholder="https://api.example.com/v1" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[8px] font-black text-zinc-600 uppercase ml-2">API Key</label>
                          <input type="password" value={config.customApiKey} onChange={e => setConfig({...config, customApiKey: e.target.value})} className="w-full bg-black/50 border border-white/10 p-4 rounded-xl text-xs font-mono text-zinc-100 focus:border-indigo-500 outline-none" placeholder="sk-..." />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[8px] font-black text-zinc-600 uppercase ml-2">模型 ID (Model Name)</label>
                          <input type="text" value={config.customModel} onChange={e => setConfig({...config, customModel: e.target.value})} className="w-full bg-black/50 border border-white/10 p-4 rounded-xl text-xs font-mono text-zinc-100 focus:border-indigo-500 outline-none" placeholder="qwen-vl-max" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* 紧急联系人列表 */}
              <section className="bg-zinc-900/40 border border-white/5 p-10 rounded-[3rem] shadow-xl">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-lg font-black text-white italic uppercase tracking-widest border-l-4 border-rose-600 pl-4">紧急救护联络网</h3>
                  <button 
                    onClick={() => setEditingContact({ id: Date.now().toString(), name: '', phone: '', relation: '', isPrimary: false })}
                    className="w-10 h-10 bg-rose-600 rounded-full flex items-center justify-center text-white hover:scale-110 transition-transform shadow-lg shadow-rose-600/30"
                  >
                    <i className="fas fa-plus"></i>
                  </button>
                </div>
                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {config.contacts.map(contact => (
                    <div key={contact.id} className={`p-5 rounded-2xl border transition-all ${contact.isPrimary ? 'bg-rose-500/10 border-rose-500/30' : 'bg-white/5 border-white/5'}`}>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h4 className="font-black text-zinc-100 flex items-center gap-2">
                            {contact.name}
                            {contact.isPrimary && <span className="text-[8px] bg-rose-600 text-white px-1.5 py-0.5 rounded font-black uppercase">首选</span>}
                          </h4>
                          <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{contact.phone} · {contact.relation}</p>
                        </div>
                        <div className="flex gap-2">
                          {!contact.isPrimary && (
                            <button onClick={() => handleSetPrimaryContact(contact.id)} title="设为首选" className="w-8 h-8 rounded-lg bg-zinc-800 text-zinc-500 hover:text-rose-500 flex items-center justify-center transition-colors">
                              <i className="fas fa-star text-[10px]"></i>
                            </button>
                          )}
                          <button onClick={() => setEditingContact(contact)} title="编辑" className="w-8 h-8 rounded-lg bg-zinc-800 text-zinc-500 hover:text-indigo-400 flex items-center justify-center transition-colors">
                            <i className="fas fa-pen text-[10px]"></i>
                          </button>
                          <button onClick={() => handleDeleteContact(contact.id)} title="删除" className="w-8 h-8 rounded-lg bg-zinc-800 text-zinc-500 hover:text-rose-500 flex items-center justify-center transition-colors">
                            <i className="fas fa-trash text-[10px]"></i>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {config.contacts.length === 0 && (
                    <div className="text-center py-10 text-zinc-600 text-[10px] border border-dashed border-white/10 rounded-2xl">
                      尚未配置任何紧急联系人
                    </div>
                  )}
                </div>
              </section>

              {/* 配置迁移与语音 */}
              <section className="bg-zinc-900/40 border border-white/5 p-10 rounded-[3rem] shadow-xl flex flex-col justify-between">
                <div>
                  <h3 className="text-lg font-black text-white italic mb-6 uppercase tracking-widest border-l-4 border-amber-600 pl-4">配置迁移</h3>
                  <div className="space-y-6">
                    <p className="text-xs text-zinc-500 leading-relaxed">您可以将当前的所有设置导出为备份文件。</p>
                    <button onClick={() => {}} className="w-full py-5 bg-zinc-800 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-3 hover:bg-zinc-700 transition-all">
                      <i className="fas fa-file-export"></i> 导出配置副本
                    </button>
                  </div>
                </div>
                <div className="mt-8 pt-8 border-t border-white/5">
                  <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-4">语音输出设置</h4>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center text-[10px] font-black">
                      <span className="text-zinc-600 uppercase">语速: {config.ttsRate.toFixed(1)}x</span>
                    </div>
                    <input type="range" min="0.5" max="2" step="0.1" value={config.ttsRate} onChange={e => setConfig({...config, ttsRate: parseFloat(e.target.value)})} className="w-full accent-indigo-600" />
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}

        {/* 联系人编辑弹窗 */}
        {editingContact && (
          <div className="fixed inset-0 bg-black/95 backdrop-blur-3xl z-[150] flex items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="bg-zinc-950 border border-white/10 p-10 rounded-[3rem] w-full max-w-md shadow-2xl">
              <h3 className="text-2xl font-black italic text-white uppercase tracking-tighter mb-8">联络人档案</h3>
              <div className="space-y-6">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-zinc-600 uppercase ml-1">全名</label>
                  <input 
                    className="w-full bg-black border border-white/10 p-4 rounded-xl text-sm font-bold focus:border-indigo-600 outline-none transition-colors" 
                    value={editingContact.name} 
                    onChange={e => setEditingContact({...editingContact, name: e.target.value})}
                    placeholder="例如：张三"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-zinc-600 uppercase ml-1">联系电话</label>
                  <input 
                    className="w-full bg-black border border-white/10 p-4 rounded-xl text-sm font-mono focus:border-indigo-600 outline-none transition-colors" 
                    value={editingContact.phone} 
                    onChange={e => setEditingContact({...editingContact, phone: e.target.value})}
                    placeholder="138xxxx8888"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-zinc-600 uppercase ml-1">关系/职务</label>
                  <input 
                    className="w-full bg-black border border-white/10 p-4 rounded-xl text-sm focus:border-indigo-600 outline-none transition-colors" 
                    value={editingContact.relation} 
                    onChange={e => setEditingContact({...editingContact, relation: e.target.value})}
                    placeholder="例如：长子 / 社区医生"
                  />
                </div>
              </div>
              <div className="flex gap-4 mt-12">
                <button onClick={() => setEditingContact(null)} className="flex-1 py-4 bg-zinc-900 rounded-xl text-[10px] font-black uppercase text-zinc-500">取消</button>
                <button onClick={handleSaveContact} className="flex-1 py-4 bg-indigo-600 rounded-xl text-[10px] font-black uppercase text-white shadow-lg">确认保存</button>
              </div>
            </div>
          </div>
        )}

        {/* 日志编辑弹窗 */}
        {editingLog && (
          <div className="fixed inset-0 bg-black/95 backdrop-blur-3xl z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="bg-zinc-950 border border-white/10 p-10 rounded-[3rem] w-full max-w-2xl shadow-2xl">
              <h3 className="text-2xl font-black italic text-white uppercase tracking-tighter mb-8">日志编辑</h3>
              <div className="space-y-6">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-zinc-600 uppercase ml-1">事件名称</label>
                  <input className="w-full bg-black border border-white/10 p-4 rounded-xl text-sm font-bold" value={editingLog.event} onChange={e => setEditingLog({...editingLog, event: e.target.value})} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-zinc-600 uppercase ml-1">备注/说明</label>
                  <textarea className="w-full h-32 bg-black border border-white/10 p-4 rounded-xl text-sm text-zinc-300" placeholder="添加备注..." value={editingLog.note || ""} onChange={e => setEditingLog({...editingLog, note: e.target.value})} />
                </div>
              </div>
              <div className="flex gap-4 mt-12">
                <button onClick={() => setEditingLog(null)} className="flex-1 py-4 bg-zinc-900 rounded-xl text-[10px] font-black uppercase text-zinc-500">取消</button>
                <button onClick={() => handleUpdateLog(editingLog)} className="flex-1 py-4 bg-indigo-600 rounded-xl text-[10px] font-black uppercase text-white shadow-lg">确认保存</button>
              </div>
            </div>
          </div>
        )}

        {/* 警报遮罩 */}
        {status === SystemStatus.ALERT && (
          <div className="fixed inset-0 bg-black/98 backdrop-blur-[100px] z-[200] flex items-center justify-center p-8 animate-in zoom-in-110">
            <div className="max-w-2xl w-full text-center">
              <div className="text-[12rem] font-black text-white mb-10 leading-none">{countdown}</div>
              <h2 className="text-4xl font-black text-rose-500 italic mb-12 uppercase tracking-tight">异常行为确认中...</h2>
              <div className="grid grid-cols-2 gap-6">
                <button onClick={() => { stopSpeaking(); setStatus(SystemStatus.MONITORING); addLog("人工解除警报", "human", "info"); }} className="py-6 bg-zinc-900 text-zinc-500 rounded-2xl font-black uppercase tracking-widest">解除误报</button>
                <button onClick={() => { stopSpeaking(); setStatus(SystemStatus.EMERGENCY); }} className="py-6 bg-rose-600 text-white rounded-2xl font-black uppercase shadow-xl shadow-rose-600/30 tracking-widest">立即呼救</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const NavTab: React.FC<{ active: boolean; onClick: () => void; icon: string; label: string }> = ({ active, onClick, icon, label }) => (
  <button onClick={onClick} className={`w-full flex items-center gap-5 p-5 rounded-2xl transition-all relative ${
    active ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/20' : 'text-zinc-600 hover:bg-white/5 hover:text-zinc-300'
  }`}>
    <div className="w-6 text-center"><i className={`fas ${icon} text-xl`}></i></div>
    <span className="hidden lg:block text-[10px] font-black tracking-widest uppercase">{label}</span>
    {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-10 bg-white rounded-full"></div>}
  </button>
);

export default App;
