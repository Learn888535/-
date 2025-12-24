
import React from 'react';

interface StatsCardProps {
  label: string;
  value: string | number;
  icon: string;
  color: 'indigo' | 'emerald' | 'rose' | 'amber';
  loading?: boolean;
}

const StatsCard: React.FC<StatsCardProps> = ({ label, value, icon, color, loading }) => {
  // 必须使用完整的 Tailwind 类名映射，否则 CDN 版本可能无法识别动态字符串
  const colorMap = {
    indigo: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/20' },
    emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
    rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/20' },
    amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' }
  };

  const style = colorMap[color];

  return (
    <div className={`bg-zinc-900/40 border ${style.border} p-5 rounded-3xl flex items-center gap-5 transition-all duration-300 hover:bg-zinc-900/60 shadow-xl`}>
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${style.bg} ${style.text} text-2xl shrink-0`}>
        <i className={`${icon} ${loading ? 'animate-pulse' : ''}`}></i>
      </div>
      <div className="min-w-0">
        <p className="text-zinc-500 text-[10px] uppercase tracking-[0.2em] font-black mb-1">{label}</p>
        <p className={`text-xl font-black text-zinc-100 truncate transition-opacity ${loading ? 'opacity-50' : 'opacity-100'}`}>
          {value}
        </p>
      </div>
    </div>
  );
};

export default StatsCard;
