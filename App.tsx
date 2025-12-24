
import React, { useState, useCallback, useEffect } from 'react';
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

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'monitor' | 'history' | 'settings'>('monitor');
  const [status, setStatus] = useState<SystemStatus>(SystemStatus.IDLE);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'danger'>('all');
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null);
  const [editingLogNote, setEditingLogNote] = useState<{ id: string, note: string } | null>(null);

  const [config, setConfig] = useState<SystemConfig>(() => {
    const saved = localStorage.getItem('guardian_config_v14');
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
      aiVoiceName: 'Kore'
    };
  });
  
  const [lastDetection, setLastDetection] = useState<DetectionResult>({ isFallDetected: false, confidence: 0, reasoning: "就绪", posture: "none" });
  const [logs, setLogs] = useState<ActivityLog[]>(() => {
    const saved = localStorage.getItem('guardian_logs_v14');
    return saved ? JSON.parse(saved).map((l: any) => ({ ...l, timestamp: new Date(l.timestamp) })) : [];
  });
  const [countdown, setCountdown] = useState(10);
  const [currentTTS, setCurrentTTS] = useState<string>("");

  useEffect(() => localStorage.setItem('guardian_config_v14', JSON.stringify(config)), [config]);
  useEffect(() => localStorage.setItem('guardian_logs_v14', JSON.stringify(logs)), [logs]);

  const addLog = useCallback((event: string, type: ActivityLog['type'] = 'human', logStatus: ActivityLog['status'] = 'info') => {
    setLogs(prev => [{ id: Math.random().toString(36).substr(2, 9), timestamp: new Date(), event, type, status: logStatus, note: "" }, ...prev].slice(0, 500));
  }, []);

  const applyPreset = (preset: typeof PRESETS.ALIBABA) => {
    setConfig(prev => ({ ...prev, customBaseUrl: preset.url, customModel: preset.model, mode: InferenceMode.CUSTOM }));
  };

  const updateLogNote = (id: string, note: string) => {
    setLogs(prev => prev.map(log => log.id === id ? { ...log, note } : log));
    setEditingLogNote(null);
  };

  const downloadLogs = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `guardian_logs_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
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

      {/* 主画布 */}
      <main className="flex-1 overflow-y-auto p-8 lg:p-12 custom-scrollbar relative">
        {activeTab === 'monitor' && (
          <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in">
            <header className="flex justify-between items-center">
              <div>
                <h2 className="text-3xl font-black text-white italic tracking-tight">监控中心</h2>
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-1">Status: {status}</p>
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
                  <StatsCard label="联络状态" value={config.contacts[0]?.name || '未设置'} icon="fa-phone" color="indigo" />
                </div>
              </div>
              <div className="col-span-12 xl:col-span-4 bg-zinc-900/40 border border-white/5 rounded-3xl p-8 flex flex-col h-[600px] shadow-2xl">
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
              <div className="flex gap-4">
                <button onClick={downloadLogs} className="px-6 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-700 transition-all">
                  <i className="fas fa-download mr-2"></i> 导出存档
                </button>
                <div className="flex gap-2 bg-zinc-900 p-1.5 rounded-xl border border-white/5">
                  <button onClick={() => setHistoryFilter('all')} className={`px-6 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${historyFilter === 'all' ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500'}`}>全部</button>
                  <button onClick={() => setHistoryFilter('danger')} className={`px-6 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${historyFilter === 'danger' ? 'bg-rose-600 text-white shadow-lg' : 'text-zinc-500'}`}>仅异常</button>
                </div>
              </div>
            </header>

            <div className="bg-zinc-900/40 border border-white/5 rounded-[2.5rem] overflow-hidden shadow-2xl">
              <div className="p-8 border-b border-white/5 flex justify-between items-center bg-white/5">
                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">历史日志序列</span>
                <button onClick={() => { if(confirm('确认清空所有历史记录？')) setLogs([]); }} className="text-[10px] font-black text-rose-500 hover:text-rose-400 uppercase tracking-widest transition-all">清空数据库</button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
                {logs
                  .filter(l => historyFilter === 'all' || l.status === 'danger')
                  .map((log, idx) => (
                    <div key={log.id} className={`flex flex-col gap-4 p-8 border-b border-white/5 hover:bg-white/[0.02] transition-all ${idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.01]'}`}>
                      <div className="flex items-center gap-6">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${log.status === 'danger' ? 'bg-rose-600/20 text-rose-500' : 'bg-indigo-600/20 text-indigo-500'}`}>
                          <i className={`fas ${log.type === 'fall' ? 'fa-user-injured' : 'fa-walking'}`}></i>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-bold text-zinc-100">{log.event}</p>
                          <div className="flex items-center gap-3 mt-1">
                             <p className="text-[10px] text-zinc-600 font-medium uppercase tracking-widest">{log.timestamp.toLocaleString()}</p>
                             {log.note && <span className="text-[8px] bg-indigo-600/20 text-indigo-400 px-1.5 py-0.5 rounded font-black uppercase">已添加备注</span>}
                          </div>
                        </div>
                        <button onClick={() => setEditingLogNote({ id: log.id, note: log.note || "" })} className="text-[10px] font-black text-indigo-400 uppercase tracking-widest hover:underline">
                          <i className="fas fa-edit mr-1"></i> {log.note ? '编辑备注' : '添加备注'}
                        </button>
                      </div>
                      {log.note && (
                        <div className="ml-18 pl-4 border-l-2 border-indigo-600/30 py-1">
                          <p className="text-xs text-zinc-400 italic">备注: {log.note}</p>
                        </div>
                      )}
                    </div>
                  ))}
                {logs.length === 0 && <div className="p-20 text-center text-zinc-700 font-bold uppercase tracking-widest">暂无记录</div>}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-5xl mx-auto space-y-10 animate-in slide-in-from-bottom-4 duration-500 pb-20">
            <h2 className="text-4xl font-black text-white italic tracking-tighter uppercase mb-12">系统深度配置</h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* 推理引擎设置 */}
              <section className="bg-zinc-900/40 border border-white/5 p-10 rounded-[2.5rem] shadow-xl">
                <h3 className="text-lg font-black text-white italic mb-8 uppercase tracking-widest border-l-4 border-indigo-600 pl-4">视觉推理核</h3>
                <div className="space-y-6">
                  <div className="grid grid-cols-3 gap-2 p-1 bg-black rounded-xl border border-white/5">
                    {[InferenceMode.CLOUD, InferenceMode.LOCAL, InferenceMode.CUSTOM].map(m => (
                      <button key={m} onClick={() => setConfig({...config, mode: m})} className={`py-3 rounded-lg text-[10px] font-black uppercase transition-all ${config.mode === m ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-600'}`}>{m}</button>
                    ))}
                  </div>
                  
                  {config.mode === InferenceMode.LOCAL && (
                    <div className="space-y-4 animate-in fade-in zoom-in-95">
                      <div className="space-y-1">
                        <label className="text-[8px] font-black text-zinc-600 uppercase ml-2">Endpoint URL</label>
                        <input type="text" value={config.localEndpoint} onChange={e => setConfig({...config, localEndpoint: e.target.value})} className="w-full bg-black/50 border border-white/10 p-4 rounded-xl text-xs font-mono text-indigo-400 focus:border-indigo-500 outline-none" placeholder="http://localhost:11434" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[8px] font-black text-zinc-600 uppercase ml-2">Model Name</label>
                        <input type="text" value={config.localModel} onChange={e => setConfig({...config, localModel: e.target.value})} className="w-full bg-black/50 border border-white/10 p-4 rounded-xl text-xs font-mono text-zinc-100 focus:border-indigo-500 outline-none" placeholder="llava:latest" />
                      </div>
                    </div>
                  )}

                  {config.mode === InferenceMode.CUSTOM && (
                    <div className="space-y-6 animate-in fade-in zoom-in-95">
                      {/* 国产模型快捷配置 */}
                      <div className="space-y-3">
                        <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">国产模型快捷填充</label>
                        <div className="grid grid-cols-2 gap-2">
                          {Object.entries(PRESETS).map(([key, preset]) => (
                            <button key={key} onClick={() => applyPreset(preset)} className="py-2 bg-zinc-800 border border-white/5 rounded-lg text-[9px] font-black text-zinc-400 hover:bg-zinc-700 hover:text-white transition-all uppercase">
                              {preset.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-4 pt-4 border-t border-white/5">
                        <div className="space-y-1">
                          <label className="text-[8px] font-black text-zinc-600 uppercase ml-2">API Base URL</label>
                          <input type="text" value={config.customBaseUrl} onChange={e => setConfig({...config, customBaseUrl: e.target.value})} className="w-full bg-black/50 border border-white/10 p-4 rounded-xl text-xs font-mono text-indigo-400 focus:border-indigo-500 outline-none" placeholder="https://api.openai.com/v1" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[8px] font-black text-zinc-600 uppercase ml-2">API Key</label>
                          <input type="password" value={config.customApiKey} onChange={e => setConfig({...config, customApiKey: e.target.value})} className="w-full bg-black/50 border border-white/10 p-4 rounded-xl text-xs font-mono text-zinc-100 focus:border-indigo-500 outline-none" placeholder="sk-..." />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[8px] font-black text-zinc-600 uppercase ml-2">Model ID</label>
                          <input type="text" value={config.customModel} onChange={e => setConfig({...config, customModel: e.target.value})} className="w-full bg-black/50 border border-white/10 p-4 rounded-xl text-xs font-mono text-zinc-100 focus:border-indigo-500 outline-none" placeholder="gpt-4-vision-preview" />
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <p className="text-[9px] text-zinc-600 italic px-2">提示：CUSTOM 模式兼容 OpenAI 视觉 API 规范。适用于通义千问 VL、智谱 GLM-4V 等。</p>
                </div>
              </section>

              {/* 语音播报设置 */}
              <section className="bg-zinc-900/40 border border-white/5 p-10 rounded-[2.5rem] shadow-xl">
                <h3 className="text-lg font-black text-white italic mb-8 uppercase tracking-widest border-l-4 border-emerald-600 pl-4">声学反馈节点</h3>
                <div className="space-y-8">
                  <div className="flex p-1 bg-black rounded-xl border border-white/5">
                    {['ai', 'local'].map(type => (
                      <button key={type} onClick={() => setConfig({...config, voiceType: type as any})}
                        className={`flex-1 py-3.5 rounded-lg text-[10px] font-black uppercase transition-all ${config.voiceType === type ? 'bg-emerald-600 text-white shadow-lg' : 'text-zinc-600'}`}>
                        {type === 'ai' ? 'Gemini 智能' : '系统原生'}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">语速平衡</label>
                      <span className="text-xs font-mono text-emerald-500 font-black">{config.ttsRate.toFixed(1)}x</span>
                    </div>
                    <input type="range" min="0.5" max="2" step="0.1" value={config.ttsRate} onChange={e => setConfig({...config, ttsRate: parseFloat(e.target.value)})} className="w-full accent-emerald-600 h-1 bg-zinc-800 rounded-full appearance-none cursor-pointer" />
                  </div>
                  <button onClick={() => dispatchSpeak("系统链路测试。已应用国产模型预设，目前输出纯净中文播报。", config)}
                    className="w-full py-4 bg-emerald-600/10 border border-emerald-500/20 rounded-xl text-[10px] font-black text-emerald-400 uppercase tracking-widest hover:bg-emerald-600/20 transition-all">
                    声学链路测试
                  </button>
                </div>
              </section>

              {/* 紧急联系人管理 */}
              <section className="lg:col-span-2 bg-zinc-900/40 border border-white/5 p-10 rounded-[2.5rem] shadow-xl">
                <div className="flex justify-between items-center mb-10">
                  <h3 className="text-lg font-black text-white italic uppercase tracking-widest border-l-4 border-rose-600 pl-4">紧急救护联络网</h3>
                  <button onClick={() => setEditingContact({ id: Date.now().toString(), name: '', phone: '', relation: '', isPrimary: false })}
                    className="px-6 py-2 bg-rose-600 text-white rounded-xl text-[10px] font-black uppercase shadow-lg shadow-rose-600/30 hover:scale-105 transition-all">
                    新增联络人
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {config.contacts.map(contact => (
                    <div key={contact.id} className={`p-6 rounded-2xl border transition-all ${contact.isPrimary ? 'bg-rose-500/10 border-rose-500/30' : 'bg-white/5 border-white/5'}`}>
                      <div className="flex justify-between mb-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${contact.isPrimary ? 'bg-rose-600 text-white' : 'bg-zinc-800 text-zinc-500'}`}>
                          <i className="fas fa-id-card"></i>
                        </div>
                        <button onClick={() => setConfig({...config, contacts: config.contacts.filter(c => c.id !== contact.id)})} className="text-zinc-600 hover:text-rose-500"><i className="fas fa-trash"></i></button>
                      </div>
                      <h4 className="font-black text-white text-lg">{contact.name}</h4>
                      <p className="text-xs font-mono text-zinc-400 mb-4">{contact.phone}</p>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">{contact.relation}</span>
                        {!contact.isPrimary && (
                          <button onClick={() => setConfig({...config, contacts: config.contacts.map(c => ({...c, isPrimary: c.id === contact.id}))})} className="text-[8px] font-black text-indigo-400 uppercase underline">设为首选</button>
                        )}
                        {contact.isPrimary && <span className="text-[8px] bg-rose-600 text-white px-2 py-0.5 rounded-full font-black uppercase">Primary</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}

        {/* 联络人编辑弹窗 */}
        {editingContact && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-2xl z-[100] flex items-center justify-center p-6">
            <div className="bg-zinc-950 border border-white/10 p-12 rounded-[3.5rem] w-full max-w-md shadow-2xl animate-in zoom-in duration-300">
              <h3 className="text-2xl font-black italic text-white uppercase mb-8">联络人编辑</h3>
              <div className="space-y-4">
                <input className="w-full bg-black border border-white/10 p-4 rounded-xl text-sm" placeholder="姓名" value={editingContact.name} onChange={e => setEditingContact({...editingContact, name: e.target.value})} />
                <input className="w-full bg-black border border-white/10 p-4 rounded-xl text-sm" placeholder="电话" value={editingContact.phone} onChange={e => setEditingContact({...editingContact, phone: e.target.value})} />
                <input className="w-full bg-black border border-white/10 p-4 rounded-xl text-sm" placeholder="关系" value={editingContact.relation} onChange={e => setEditingContact({...editingContact, relation: e.target.value})} />
              </div>
              <div className="flex gap-4 mt-10">
                <button onClick={() => setEditingContact(null)} className="flex-1 py-4 bg-zinc-900 rounded-xl text-xs font-black uppercase text-zinc-500">取消</button>
                <button onClick={() => {
                  setConfig({...config, contacts: [...config.contacts, editingContact]});
                  setEditingContact(null);
                }} className="flex-1 py-4 bg-indigo-600 rounded-xl text-xs font-black uppercase text-white shadow-lg shadow-indigo-600/30">保存记录</button>
              </div>
            </div>
          </div>
        )}

        {/* 日志备注编辑弹窗 */}
        {editingLogNote && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-2xl z-[100] flex items-center justify-center p-6">
            <div className="bg-zinc-950 border border-white/10 p-10 rounded-[2.5rem] w-full max-w-lg shadow-2xl animate-in zoom-in duration-300">
              <h3 className="text-xl font-black italic text-white uppercase mb-6">编辑日志备注</h3>
              <textarea 
                className="w-full h-40 bg-black border border-white/10 p-6 rounded-2xl text-sm text-zinc-200 resize-none outline-none focus:border-indigo-500 transition-all" 
                placeholder="在此输入事件描述或备注..." 
                value={editingLogNote.note} 
                onChange={e => setEditingLogNote({...editingLogNote, note: e.target.value})}
              />
              <div className="flex gap-4 mt-8">
                <button onClick={() => setEditingLogNote(null)} className="flex-1 py-4 bg-zinc-900 rounded-xl text-[10px] font-black uppercase text-zinc-500 tracking-widest">放弃修改</button>
                <button onClick={() => updateLogNote(editingLogNote.id, editingLogNote.note)} className="flex-1 py-4 bg-indigo-600 rounded-xl text-[10px] font-black uppercase text-white shadow-lg shadow-indigo-600/30 tracking-widest">保存备注</button>
              </div>
            </div>
          </div>
        )}

        {/* 紧急警报遮罩 */}
        {status === SystemStatus.ALERT && (
          <div className="fixed inset-0 bg-black/98 backdrop-blur-[100px] z-[200] flex items-center justify-center p-8 animate-in zoom-in-110">
            <div className="max-w-2xl w-full bg-zinc-950 border border-rose-600/30 p-20 rounded-[4rem] text-center shadow-2xl">
              <div className="w-24 h-24 bg-rose-600 rounded-3xl flex items-center justify-center text-white text-5xl mx-auto mb-10 shadow-xl animate-pulse">
                <i className="fas fa-warning"></i>
              </div>
              <h2 className="text-5xl font-black text-white italic mb-6 uppercase tracking-tighter">异常跌倒检测</h2>
              <div className="bg-rose-600/10 p-8 rounded-3xl mb-12 border border-rose-600/20 text-rose-400 font-black italic text-xl">
                {currentTTS}
              </div>
              <div className="text-[12rem] font-black text-white mb-16 leading-none tracking-tighter">{countdown}</div>
              <div className="grid grid-cols-2 gap-6">
                <button onClick={() => { stopSpeaking(); setStatus(SystemStatus.MONITORING); addLog("用户手动取消警报", "human", "info"); }} className="py-6 bg-zinc-900 text-zinc-600 rounded-2xl font-black uppercase text-xs tracking-widest hover:text-white transition-all">忽略误报</button>
                <button onClick={() => { stopSpeaking(); setStatus(SystemStatus.EMERGENCY); }} className="py-6 bg-rose-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-rose-600/30 hover:scale-105 transition-all">立即救援</button>
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
