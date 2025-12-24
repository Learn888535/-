
import React, { useState, useCallback, useEffect } from 'react';
import { SystemStatus, DetectionResult, ActivityLog, InferenceMode, SystemConfig, EmergencyContact } from './types';
import VideoDisplay from './components/VideoDisplay';
import StatsCard from './components/StatsCard';
import { analyzeScene, dispatchSpeak, stopSpeaking } from './services/aiService';

const VISION_PRESETS = [
  { name: '智谱 GLM-4V', url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v', desc: '国产老牌，识别稳' },
  { name: '百度 ERNIE-Vision', url: 'https://qianfan.baidubce.com/v2', model: 'ernie-vision-speed', desc: '百度千帆视觉' },
  { name: '阿里 Qwen-VL', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max', desc: '通义千问视觉' }
];

const TTS_PRESETS = [
  { name: '阿里 CosyVoice', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/audio/speech', model: 'cosyvoice-v1', desc: '需要配置跨域或后端中转' },
  { name: 'SiliconFlow', url: 'https://api.siliconflow.cn/v1/audio/speech', model: 'fishaudio/fish-speech-1.4', desc: '国产高性价比聚合' },
  { name: '百度语音 (API)', url: 'https://qianfan.baidubce.com/v2/audio/speech', model: 'tts-1', desc: '千帆标准端点' }
];

const GEMINI_VOICES = [
  { id: 'Kore', name: 'Kore (亲切女声 - 推荐)' },
  { id: 'Puck', name: 'Puck (深沉男声)' },
  { id: 'Charon', name: 'Charon (温和男声)' },
  { id: 'Zephyr', name: 'Zephyr (清爽女声)' },
];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'monitor' | 'history' | 'settings'>('monitor');
  const [status, setStatus] = useState<SystemStatus>(SystemStatus.IDLE);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [archiveFilter, setArchiveFilter] = useState<'all' | 'critical'>('critical');

  const [config, setConfig] = useState<SystemConfig>(() => {
    const saved = localStorage.getItem('guardian_config_v7');
    return saved ? JSON.parse(saved) : {
      mode: InferenceMode.CLOUD,
      localEndpoint: 'http://localhost:11434',
      localModel: 'llava:latest',
      customBaseUrl: 'https://qianfan.baidubce.com/v2',
      customApiKey: '',
      customModel: 'ernie-vision-speed',
      contacts: [{ id: '1', name: '社区监控室', phone: '010-888888', relation: '物业', isPrimary: true }],
      ttsLanguage: 'zh-CN',
      ttsRate: 0.85,
      ttsVoiceName: '',
      voiceType: 'ai',
      aiVoiceName: 'Kore',
      customTtsUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/audio/speech',
      customTtsApiKey: '',
      customTtsModel: 'cosyvoice-v1'
    };
  });
  
  const [lastDetection, setLastDetection] = useState<DetectionResult>({ isFallDetected: false, confidence: 0, reasoning: "待命", posture: "none" });
  const [logs, setLogs] = useState<ActivityLog[]>(() => {
    const saved = localStorage.getItem('guardian_logs_v7');
    return saved ? JSON.parse(saved).map((l: any) => ({ ...l, timestamp: new Date(l.timestamp) })) : [];
  });
  const [countdown, setCountdown] = useState(10);
  const [currentTTS, setCurrentTTS] = useState<string>("");

  useEffect(() => localStorage.setItem('guardian_config_v7', JSON.stringify(config)), [config]);
  useEffect(() => localStorage.setItem('guardian_logs_v7', JSON.stringify(logs)), [logs]);

  useEffect(() => {
    const loadVoices = () => setAvailableVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const addLog = useCallback((event: string, type: ActivityLog['type'] = 'human', logStatus: ActivityLog['status'] = 'info') => {
    setLogs(prev => [{ id: Math.random().toString(36).substr(2, 9), timestamp: new Date(), event, type, status: logStatus }, ...prev].slice(0, 500));
  }, []);

  const handleFrameAnalysis = useCallback(async (base64: string) => {
    if (status !== SystemStatus.MONITORING || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeScene(base64, config);
      setLastDetection(result);
      if (result.posture !== "none" && result.posture !== "unknown") {
        const isCritical = result.isFallDetected && result.confidence > 0.45;
        if (isCritical) {
          addLog(`[警告] 检测到跌倒风险: ${result.reasoning}`, 'fall', 'danger');
          setStatus(SystemStatus.ALERT);
          const primary = config.contacts.find(c => c.isPrimary) || config.contacts[0];
          const msg = `警报！系统监测到跌倒风险。${primary?.name || '紧急联络人'}已收到通知。请问您需要帮助吗？`;
          setCurrentTTS(msg);
          setCountdown(10);
          dispatchSpeak(msg, config);
        } else if (result.confidence > 0.3) {
          addLog(`日常监测: ${result.reasoning}`, 'human', 'info');
        }
      }
    } catch (e) {
      addLog("后端分析链路异常", "system", "warning");
    } finally {
      setIsAnalyzing(false);
    }
  }, [status, isAnalyzing, config, addLog]);

  const handleCancelAlert = () => {
    stopSpeaking();
    setStatus(SystemStatus.MONITORING);
    addLog("用户响应：误报，警报已解除", "human", "info");
  };

  const handleImmediateRescue = () => {
    stopSpeaking();
    setStatus(SystemStatus.EMERGENCY);
    const msg = `已确认险情，紧急救援程序已启动。正在拨打急救电话。`;
    setCurrentTTS(msg);
    dispatchSpeak(msg, config);
    addLog(`用户手动触发救援程序`, 'contact', 'danger');
  };

  useEffect(() => {
    let timer: any;
    if (status === SystemStatus.ALERT && countdown > 0) {
      timer = setInterval(() => setCountdown(prev => prev - 1), 1000);
    } else if (status === SystemStatus.ALERT && countdown === 0) {
      handleImmediateRescue();
    }
    return () => clearInterval(timer);
  }, [status, countdown]);

  return (
    <div className="flex h-screen bg-[#050505] text-zinc-300 overflow-hidden font-sans">
      <nav className="w-20 lg:w-72 border-r border-white/5 flex flex-col p-6 bg-black/50 backdrop-blur-3xl z-50">
        <div className="flex items-center gap-4 mb-12 px-2">
          <div className="w-11 h-11 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-600/30 shrink-0 rotate-3">
            <i className="fas fa-heart-pulse text-white text-xl"></i>
          </div>
          <span className="hidden lg:block text-xl font-black italic text-white tracking-widest uppercase">Guardian AI</span>
        </div>
        <div className="flex flex-col gap-3">
          <NavItem active={activeTab === 'monitor'} onClick={() => setActiveTab('monitor')} icon="fa-desktop" label="实时监控" />
          <NavItem active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon="fa-clock-rotate-left" label="警报存档" />
          <NavItem active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon="fa-sliders" label="系统设置" />
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto p-6 lg:p-12">
        {activeTab === 'monitor' && (
          <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in duration-500">
            <header className="flex justify-between items-end">
              <div>
                <h2 className="text-4xl font-black italic text-white tracking-tight">监控中心</h2>
                <p className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.3em] mt-2">智能深度感官视觉防护系统</p>
              </div>
              <button onClick={() => setStatus(status === SystemStatus.IDLE ? SystemStatus.MONITORING : SystemStatus.IDLE)} 
                className={`px-10 py-3.5 rounded-2xl font-black uppercase text-[10px] tracking-widest transition-all ${
                status === SystemStatus.IDLE ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/30 hover:scale-105' : 'bg-zinc-800 text-zinc-500 hover:text-white'
              }`}>
                {status === SystemStatus.IDLE ? '启动全时防护' : '进入待机模式'}
              </button>
            </header>
            
            <div className="grid grid-cols-12 gap-8">
              <div className="col-span-12 xl:col-span-8 space-y-8">
                <VideoDisplay isMonitoring={status === SystemStatus.MONITORING} isAnalyzing={isAnalyzing} status={status === SystemStatus.ALERT ? 'danger' : 'safe'} onFrame={handleFrameAnalysis} />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <StatsCard label="当前姿态" value={lastDetection.posture} icon="fa-street-view" color="amber" />
                  <StatsCard label="判定置信" value={`${Math.round(lastDetection.confidence * 100)}%`} icon="fa-shield-check" color="emerald" loading={isAnalyzing} />
                  <StatsCard label="系统运行" value={status} icon="fa-server" color="indigo" />
                </div>
              </div>
              <div className="col-span-12 xl:col-span-4 bg-zinc-900/40 border border-white/5 rounded-[3rem] p-8 flex flex-col h-[600px]">
                <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-6">实时动态追踪</h3>
                <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                  {logs.slice(0, 30).map(log => (
                    <div key={log.id} className="p-4 bg-white/5 rounded-2xl border border-white/5 transition-all hover:bg-white/[0.08]">
                      <div className="flex justify-between text-[8px] font-black mb-1">
                        <span className={log.status === 'danger' ? 'text-rose-500' : 'text-indigo-400 uppercase'}>{log.type}</span>
                        <span className="text-zinc-600">{log.timestamp.toLocaleTimeString()}</span>
                      </div>
                      <p className="text-xs font-bold text-zinc-200">{log.event}</p>
                    </div>
                  ))}
                  {logs.length === 0 && <p className="text-center text-zinc-700 text-xs italic mt-20">暂无活动记录</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in">
            <header className="flex justify-between items-center">
              <div>
                <h2 className="text-4xl font-black italic text-white tracking-tight">警报存档</h2>
                <p className="text-xs text-zinc-500 font-bold uppercase mt-1">系统审计的历史安全数据</p>
              </div>
              <div className="flex gap-4">
                <select className="bg-zinc-900 border border-white/10 rounded-xl px-4 py-2 text-xs font-bold outline-none" value={archiveFilter} onChange={e => setArchiveFilter(e.target.value as any)}>
                  <option value="all">显示全部记录</option>
                  <option value="critical">仅查看跌倒预警</option>
                </select>
                <button onClick={() => {
                  const csv = "时间,类型,状态,描述\n" + logs.map(l => `${l.timestamp.toLocaleString()},${l.type},${l.status},${l.event}`).join("\n");
                  const blob = new Blob(["\ufeff" + csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = "History.csv";
                  a.click();
                }} className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl text-xs font-black shadow-lg shadow-indigo-600/20">导出审计报告</button>
              </div>
            </header>

            <div className="bg-zinc-900/40 border border-white/5 rounded-[3rem] overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/5 text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                    <th className="p-8">时间戳</th>
                    <th className="p-8 text-center">风险级别</th>
                    <th className="p-8">AI 详细推理</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {logs.filter(l => archiveFilter === 'all' ? true : l.status === 'danger').map(log => (
                    <tr key={log.id} className="border-t border-white/5 hover:bg-white/5 transition-colors">
                      <td className="p-8 text-xs font-mono text-zinc-500">{log.timestamp.toLocaleString()}</td>
                      <td className="p-8 text-center">
                        <span className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase ${log.status === 'danger' ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' : 'bg-indigo-500/10 text-indigo-400'}`}>
                          {log.status === 'danger' ? '紧急预警' : '常规活动'}
                        </span>
                      </td>
                      <td className="p-8 font-bold text-zinc-200">{log.event}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {logs.length === 0 && <div className="p-20 text-center text-zinc-700 italic">空存档</div>}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 animate-in fade-in pb-20">
            {/* 左侧：联系人与语音 - 确保这两个模块始终可见 */}
            <div className="space-y-10">
              <section className="bg-zinc-900/40 border border-white/5 p-10 rounded-[3.5rem] shadow-xl">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-xl font-black text-white italic tracking-tight"><i className="fas fa-id-badge text-indigo-500 mr-2"></i> 救援响应链</h3>
                  <button onClick={() => setEditingContact({ id: Math.random().toString(36).substr(2, 9), name: '', phone: '', relation: '', isPrimary: false })}
                    className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center hover:scale-105 transition-all shadow-lg shadow-indigo-600/30">
                    <i className="fas fa-plus"></i>
                  </button>
                </div>
                <div className="space-y-4">
                  {config.contacts.map(c => (
                    <div key={c.id} className="p-6 bg-black/40 border border-white/5 rounded-[2rem] flex justify-between items-center group">
                      <div className="flex items-center gap-5">
                        <div className={`w-3 h-3 rounded-full ${c.isPrimary ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]' : 'bg-zinc-800'}`}></div>
                        <div>
                          <p className="text-sm font-black text-white">{c.name} <span className="text-[10px] text-zinc-600">({c.relation})</span></p>
                          <p className="text-xs text-zinc-500 font-mono tracking-tighter">{c.phone}</p>
                        </div>
                      </div>
                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                        <button onClick={() => setEditingContact(c)} className="w-8 h-8 rounded-lg bg-white/5 text-zinc-500 hover:text-white flex items-center justify-center"><i className="fas fa-edit text-[10px]"></i></button>
                        <button onClick={() => setConfig({...config, contacts: config.contacts.filter(item => item.id !== c.id)})} className="w-8 h-8 rounded-lg bg-white/5 text-zinc-500 hover:text-rose-500 flex items-center justify-center"><i className="fas fa-trash text-[10px]"></i></button>
                      </div>
                    </div>
                  ))}
                  {config.contacts.length === 0 && <p className="text-center text-zinc-600 text-xs py-10 italic">尚未配置紧急联络人</p>}
                </div>
              </section>

              <section className="bg-zinc-900/40 border border-white/5 p-10 rounded-[3.5rem] shadow-xl space-y-8">
                <h3 className="text-xl font-black text-white italic tracking-tight"><i className="fas fa-microphone-lines text-indigo-500 mr-2"></i> 语音播报配置</h3>
                <div className="space-y-6">
                  <div className="grid grid-cols-3 gap-2 bg-black/40 p-2 rounded-2xl border border-white/5">
                    {['ai', 'custom_api', 'local'].map(type => (
                      <button key={type} onClick={() => setConfig({...config, voiceType: type as any})}
                        className={`py-3 rounded-xl text-[9px] font-black uppercase transition-all ${config.voiceType === type ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-600 hover:text-zinc-400'}`}>
                        {type === 'custom_api' ? '国产/API' : type.toUpperCase()}
                      </button>
                    ))}
                  </div>

                  {config.voiceType === 'custom_api' && (
                    <div className="space-y-4 animate-in slide-in-from-top-4">
                      <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-2xl mb-2">
                        <p className="text-[10px] text-rose-500 font-black mb-1"><i className="fas fa-triangle-exclamation mr-1"></i> CORS 注意事项</p>
                        <p className="text-[9px] text-zinc-500 leading-relaxed">阿里云/百度等 API 默认禁止跨域。若调用失败，请使用本地中转或切换为 Gemini AI 语音。</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {TTS_PRESETS.map(preset => (
                          <button key={preset.name} onClick={() => setConfig({...config, customTtsUrl: preset.url, customTtsModel: preset.model})}
                            className={`p-3 text-left rounded-xl border transition-all ${config.customTtsModel === preset.model ? 'bg-indigo-600/20 border-indigo-500/50' : 'bg-black/40 border-white/10 hover:border-white/20'}`}>
                            <p className="text-[10px] font-black text-zinc-200">{preset.name}</p>
                            <p className="text-[8px] text-zinc-600 mt-0.5 truncate">{preset.desc}</p>
                          </button>
                        ))}
                      </div>
                      <input className="w-full bg-black border border-white/10 p-4 rounded-2xl text-[11px] font-mono focus:border-indigo-500 outline-none" placeholder="Endpoint URL" value={config.customTtsUrl} onChange={e => setConfig({...config, customTtsUrl: e.target.value})} />
                      <input className="w-full bg-black border border-white/10 p-4 rounded-2xl text-[11px] font-mono focus:border-indigo-500 outline-none" placeholder="API Key" type="password" value={config.customTtsApiKey} onChange={e => setConfig({...config, customTtsApiKey: e.target.value})} />
                      <input className="w-full bg-black border border-white/10 p-4 rounded-2xl text-[11px] font-mono focus:border-indigo-500 outline-none" placeholder="Model Name" value={config.customTtsModel} onChange={e => setConfig({...config, customTtsModel: e.target.value})} />
                    </div>
                  )}

                  {config.voiceType === 'ai' && (
                    <div className="space-y-4 animate-in slide-in-from-top-4">
                      <select className="w-full bg-black border border-white/10 p-4 rounded-2xl text-[11px] text-white outline-none focus:border-indigo-500" value={config.aiVoiceName} onChange={e => setConfig({...config, aiVoiceName: e.target.value})}>
                        {GEMINI_VOICES.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </div>
                  )}

                  <button onClick={() => dispatchSpeak("正在执行警报播报测试。音量与语调是否清晰？", config)}
                    className="w-full py-4 bg-indigo-600/10 border border-indigo-500/20 rounded-2xl text-[10px] font-black text-indigo-400 hover:bg-indigo-600/20 transition-all uppercase tracking-widest">
                    <i className="fas fa-play mr-2"></i> 测试当前引擎播报
                  </button>
                </div>
              </section>
            </div>

            {/* 右侧：推理架构 */}
            <section className="bg-zinc-900/40 border border-white/5 p-10 rounded-[3.5rem] shadow-xl space-y-8 h-fit">
              <h3 className="text-xl font-black text-white italic tracking-tight"><i className="fas fa-brain text-indigo-500 mr-2"></i> 视觉推理架构</h3>
              <div className="space-y-8">
                <div className="flex gap-3 bg-black/40 p-2 rounded-2xl border border-white/5">
                  {[InferenceMode.CLOUD, InferenceMode.LOCAL, InferenceMode.CUSTOM].map(m => (
                    <button key={m} onClick={() => setConfig({...config, mode: m})} className={`flex-1 py-4 text-[9px] font-black uppercase rounded-xl transition-all ${config.mode === m ? 'bg-indigo-600 text-white' : 'text-zinc-600'}`}>
                      {m === 'CUSTOM' ? '国产/API' : (m === 'CLOUD' ? 'Gemini' : 'Ollama')}
                    </button>
                  ))}
                </div>
                {config.mode === InferenceMode.CUSTOM && (
                  <div className="space-y-4 animate-in slide-in-from-top-4">
                    <div className="grid grid-cols-2 gap-2">
                      {VISION_PRESETS.map(preset => (
                        <button key={preset.name} onClick={() => setConfig({...config, customBaseUrl: preset.url, customModel: preset.model})}
                          className={`p-3 text-left rounded-xl border transition-all ${config.customModel === preset.model ? 'bg-indigo-600/20 border-indigo-500/50' : 'bg-black/40 border-white/10 hover:border-white/20'}`}>
                          <p className="text-[10px] font-black">{preset.name}</p>
                          <p className="text-[8px] text-zinc-600 mt-1">{preset.desc}</p>
                        </button>
                      ))}
                    </div>
                    <input className="w-full bg-black border border-white/10 p-5 rounded-[1.5rem] text-xs font-mono outline-none focus:border-indigo-500" placeholder="API Base URL" value={config.customBaseUrl} onChange={e => setConfig({...config, customBaseUrl: e.target.value})} />
                    <input className="w-full bg-black border border-white/10 p-5 rounded-[1.5rem] text-xs font-mono outline-none focus:border-indigo-500" placeholder="API Key" value={config.customApiKey} onChange={e => setConfig({...config, customApiKey: e.target.value})} type="password" />
                    <input className="w-full bg-black border border-white/10 p-5 rounded-[1.5rem] text-xs font-mono outline-none focus:border-indigo-500" placeholder="Model ID" value={config.customModel} onChange={e => setConfig({...config, customModel: e.target.value})} />
                  </div>
                )}
                {config.mode === InferenceMode.LOCAL && (
                  <div className="space-y-4 animate-in slide-in-from-top-4">
                    <input className="w-full bg-black border border-white/10 p-5 rounded-[1.5rem] text-xs font-mono outline-none focus:border-indigo-500" placeholder="Ollama URL" value={config.localEndpoint} onChange={e => setConfig({...config, localEndpoint: e.target.value})} />
                    <input className="w-full bg-black border border-white/10 p-5 rounded-[1.5rem] text-xs font-mono outline-none focus:border-indigo-500" placeholder="Model Name" value={config.localModel} onChange={e => setConfig({...config, localModel: e.target.value})} />
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* 联络人弹窗 */}
        {editingContact && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-2xl z-[100] flex items-center justify-center p-6">
            <div className="bg-zinc-950 border border-white/10 p-12 rounded-[4rem] w-full max-w-md space-y-8 shadow-2xl animate-in zoom-in duration-300">
              <h4 className="text-2xl font-black italic text-white uppercase tracking-tighter text-center">档案编辑</h4>
              <div className="space-y-4">
                <input className="w-full bg-black border border-white/10 p-5 rounded-[1.5rem] text-sm text-white outline-none focus:border-indigo-500" placeholder="姓名" value={editingContact.name} onChange={e => setEditingContact({...editingContact, name: e.target.value})} />
                <input className="w-full bg-black border border-white/10 p-5 rounded-[1.5rem] text-sm text-white font-mono outline-none focus:border-indigo-500" placeholder="电话" value={editingContact.phone} onChange={e => setEditingContact({...editingContact, phone: e.target.value})} />
                <input className="w-full bg-black border border-white/10 p-5 rounded-[1.5rem] text-sm text-white outline-none focus:border-indigo-500" placeholder="角色" value={editingContact.relation} onChange={e => setEditingContact({...editingContact, relation: e.target.value})} />
                <label className="flex items-center gap-4 cursor-pointer p-2">
                  <div className={`w-6 h-6 rounded-lg border transition-all flex items-center justify-center ${editingContact.isPrimary ? 'bg-indigo-600 border-indigo-500' : 'bg-black border-white/10'}`}>
                    {editingContact.isPrimary && <i className="fas fa-check text-xs text-white"></i>}
                  </div>
                  <input type="checkbox" className="hidden" checked={editingContact.isPrimary} onChange={e => setEditingContact({...editingContact, isPrimary: e.target.checked})} />
                  <span className="text-xs font-bold text-zinc-500 uppercase">设为首要联系人</span>
                </label>
              </div>
              <div className="flex gap-4">
                <button onClick={() => setEditingContact(null)} className="flex-1 py-5 bg-zinc-900 rounded-[1.5rem] text-xs font-black text-zinc-500 uppercase">取消</button>
                <button onClick={() => {
                  setConfig(prev => {
                    const exists = prev.contacts.find(c => c.id === editingContact.id);
                    let newContacts = exists ? prev.contacts.map(c => c.id === editingContact.id ? editingContact : c) : [...prev.contacts, editingContact];
                    if (editingContact.isPrimary) newContacts = newContacts.map(c => ({...c, isPrimary: c.id === editingContact.id}));
                    return {...prev, contacts: newContacts};
                  });
                  setEditingContact(null);
                }} className="flex-1 py-5 bg-indigo-600 text-white rounded-[1.5rem] text-xs font-black uppercase">确认保存</button>
              </div>
            </div>
          </div>
        )}

        {/* 警报遮罩层 */}
        {status === SystemStatus.ALERT && (
          <div className="fixed inset-0 bg-black/95 backdrop-blur-[60px] z-[200] flex items-center justify-center p-6 animate-in zoom-in-110">
            <div className="max-w-xl w-full bg-zinc-950 border border-rose-600/30 p-16 rounded-[5rem] text-center shadow-2xl">
              <div className="w-24 h-24 bg-rose-600 rounded-[2.5rem] flex items-center justify-center text-white text-4xl mx-auto mb-10 shadow-lg animate-pulse"><i className="fas fa-radiation"></i></div>
              <h2 className="text-4xl font-black text-white italic mb-4 uppercase tracking-tighter">异常跌倒检测!</h2>
              <div className="bg-rose-600/5 p-8 rounded-[2.5rem] mb-12 border border-rose-600/10 text-rose-400 font-bold italic text-lg">{currentTTS}</div>
              <div className="text-9xl font-black text-white mb-16 tabular-nums tracking-tighter">{countdown}</div>
              <div className="grid grid-cols-2 gap-6">
                <button onClick={handleCancelAlert} className="py-7 bg-zinc-900 text-zinc-400 rounded-[2rem] font-black uppercase text-[10px] tracking-widest">误报取消</button>
                <button onClick={handleImmediateRescue} className="py-7 bg-rose-600 text-white rounded-[2rem] font-black uppercase text-[10px] tracking-widest shadow-xl shadow-rose-600/20">立即执行救援</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

const NavItem: React.FC<{ active: boolean; onClick: () => void; icon: string; label: string }> = ({ active, onClick, icon, label }) => (
  <button onClick={onClick} className={`w-full flex items-center gap-5 p-5 rounded-[1.8rem] transition-all relative ${
    active ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/30' : 'text-zinc-600 hover:bg-white/5 hover:text-zinc-300'
  }`}>
    <div className="w-6 shrink-0 text-center"><i className={`fas ${icon} text-lg`}></i></div>
    <span className="hidden lg:block text-[11px] font-black tracking-widest uppercase">{label}</span>
    {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-7 bg-white rounded-full"></div>}
  </button>
);

export default App;
