import React from 'react';
import { LayoutDashboard, Users, Upload, FileText, Settings, Anchor, Bot, Building2 } from 'lucide-react';
import { bridgeMemory } from '../services/bridgeMemory';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'contacts', label: 'Universe', icon: Users },
    { id: 'chat', label: 'Assistant', icon: Bot },
    { id: 'organization', label: 'Organization', icon: Building2 },
    { id: 'upload', label: 'Ingestion', icon: Upload },
    { id: 'thesis', label: 'Thesis & Rules', icon: FileText },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  // Get real stats from bridgeMemory
  const stats = bridgeMemory.getStats();

  return (
    <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-full">
      <div className="p-6 border-b border-slate-800 flex items-center gap-3">
        <div className="bg-blue-600 p-2 rounded-lg">
          <Anchor className="text-white" size={20} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white tracking-tight">BRIDGE</h1>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest">Project Leviathan</p>
        </div>
      </div>

      <nav className="flex-1 py-6 px-3 space-y-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 group ${isActive
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
            >
              <Icon size={18} className={isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'} />
              <span className="font-medium text-sm">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800">
        <div className="bg-slate-800 rounded p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-xs text-slate-300 font-mono">SYSTEM ONLINE</span>
          </div>
          <p className="text-[10px] text-slate-500">
            Knowledge Chunks: {stats.totalChunks.toLocaleString()}<br />
            Sources: {stats.sources}
          </p>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
