import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, Boxes, Code2, Database, FileWarning, FolderOpen, MessageSquare, PanelRightOpen, Puzzle, RotateCcw, Scissors, Settings2 } from 'lucide-react';
import { ProjectTicker, fmt } from './MarketPanel.jsx';
import { MarketDrawer, MarketSidebar, useNarrowSidebar } from './MarketSidebar.jsx';
import { useProject } from './project-store.js';

function Preview({ root }) {
  const { project, refresh } = useProject(root);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const narrow = useNarrowSidebar();
  const [sidebarOpen, setSidebarOpen] = useState(() => !narrow);
  const action = async kind => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/preview/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      refresh();
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  };
  return <div className="ths-preview">
    <header className="ths-preview-top"><div className="ths-preview-logo"><b>DS</b> DeepSeek Harness</div><ProjectTicker root={root} /><button className="ths-icon" type="button" title={sidebarOpen ? '收起 K 线侧栏' : '打开 K 线侧栏'} aria-label={sidebarOpen ? '收起 K 线侧栏' : '打开 K 线侧栏'} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}><PanelRightOpen size={17} /></button><a href="https://github.com/AdamPlatin123/dsh-tonghuashun" target="_blank" rel="noreferrer">同花顺皮肤 · 本地验收</a></header>
    <div className={`ths-preview-body-grid ${sidebarOpen && !narrow ? 'ths-preview-with-market' : ''}`}>
      <aside className="ths-preview-sidebar"><div className="ths-sidebar-brand"><Code2 size={24} /><div><b>deepseek</b><span>HARNESS / TERMINAL</span></div></div><nav className="ths-preview-nav" aria-label="验收页面"><div><FolderOpen size={15} />项目</div><div className="active"><Activity size={15} />行情</div><div><MessageSquare size={15} />会话</div><div><Boxes size={15} />技能</div><div><Database size={15} />数据</div><div><Puzzle size={15} />插件</div></nav><div className="ths-watch-title">当前项目<Settings2 size={12} /></div><div className="ths-watch-head"><span>名称</span><span>代码量</span></div><div className="ths-watch-row"><div><span>acceptance-project</span><small>LOCAL / VERIFIED</small></div><b className="ths-down">{fmt(project?.currentLines)}</b></div><div className="ths-sidebar-bottom">DSH 0.1.2-rc.1</div></aside>
      <main className="ths-preview-main"><section className="ths-preview-session"><div className="ths-session-tabs"><span className="active">修改记录</span><span>Token 账本</span><b>本地验收项目</b></div><div className="ths-preview-log"><div className="ths-log-row"><time>BASELINE</time><b>Scan</b><span>acceptance-project / src / ledger.js</span><em>{fmt(project?.baseline)} 行</em></div>{project?.records.slice(-7).map(row => <div key={row.id} className="ths-log-row"><time>{new Date(row.at).toLocaleTimeString('zh-CN', { hour12: false })}</time><b>{row.tool || 'Edit'}</b><span>{row.path?.replaceAll('\\', '/').split('/').slice(-2).join('/')}</span><em className={row.deleted > row.added ? 'ths-down' : 'ths-up'}>{row.added - row.deleted > 0 ? '+' : ''}{fmt(row.added - row.deleted)} 行</em></div>)}</div><div className="ths-preview-controls"><span>验收文件 · src/ledger.js</span><button className="ths-delete" disabled={busy} onClick={() => action('delete')}><Scissors size={13} />删除 10,000 行</button><button className="ths-restore" disabled={busy} onClick={() => action('restore')}><RotateCcw size={13} />恢复 10,000 行</button><button className="ths-external" disabled={busy} onClick={() => action('external')}><FileWarning size={13} />外部改动 250 行</button></div>{error && <p className="ths-preview-error" role="alert">{error}</p>}</section></main>
      {sidebarOpen && !narrow && <MarketSidebar root={root} sessionId="acceptance-session" onClose={() => setSidebarOpen(false)} />}
      {sidebarOpen && narrow && <MarketDrawer root={root} sessionId="acceptance-session" onClose={() => setSidebarOpen(false)} />}
    </div><footer className="ths-preview-footer"><span>代码总量 <b className="ths-down">{fmt(project?.currentLines)}</b></span><span>修改 <b>{project?.records.length || 0}</b> 笔</span><span>Token {fmt(project?.usage.totalTokens)}</span><span><i className="ths-online" /> 本地统计已连接</span></footer>
  </div>;
}

function App() {
  const [root, setRoot] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { fetch('/preview/config').then(res => res.json()).then(value => setRoot(value.root)).catch(cause => setError(cause.message)); }, []);
  return root ? <Preview root={root} /> : <p style={{ color: '#bbb', padding: 30 }}>{error || '正在连接本地验收项目'}</p>;
}
createRoot(document.getElementById('root')).render(<App />);
