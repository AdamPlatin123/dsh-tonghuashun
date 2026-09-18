import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BarChart3, ChevronDown, Download, FileCode2, Maximize2, Minus, PanelRightClose, Plus, RefreshCw, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { deriveBars, deriveCandles, intradaySeries, recordUsage, createProject } from '../core/metrics.js';
import { isAgent, SCALE_LABELS } from './candles.js';
import { useProject } from './project-store.js';
import { Chart } from './Chart.jsx';

export const fmt = value => value === null || value === undefined ? '--' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
const signed = value => `${value > 0 ? '+' : ''}${fmt(value)}`;
const direction = value => value < 0 ? 'ths-down' : value > 0 ? 'ths-up' : '';
const projectName = root => root.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || root;
const time = at => new Date(at).toLocaleTimeString('zh-CN', { hour12: false });
const PERIODS = [['step', '逐步'], ['event', '分时'], ['day', '日 K'], ['week', '周 K'], ['month', '月 K']];
const EMPTY = [];
const TICK_MS = 5000;

// 当前状态锚点随时间推进，图表右端才会持续停在真实总量上。
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function ToolButton({ title, children, ...props }) {
  return <button type="button" className="ths-icon" title={title} aria-label={title} {...props}>{children}</button>;
}

// 宿主的 headerUtilities 是 flex:none，插件无法让它收缩，只能让自己的内容更短：
// 按可用宽度分级显示，始终保留代码总量与状态点，其余字段依次让位。
const TICKER_LEVELS = [[1680, 4], [1440, 3], [1120, 2]];
function tickerLevel(width) {
  for (const [min, level] of TICKER_LEVELS) if (width >= min) return level;
  return 1;
}
function useTickerLevel() {
  const [level, setLevel] = useState(() => tickerLevel(globalThis.innerWidth ?? 0));
  useEffect(() => {
    const update = () => setLevel(tickerLevel(globalThis.innerWidth ?? 0));
    globalThis.addEventListener('resize', update);
    return () => globalThis.removeEventListener('resize', update);
  }, []);
  return level;
}

export function ProjectTicker({ root, apiBase = '' }) {
  const { project, error } = useProject(root, apiBase);
  const level = useTickerLevel();
  const last = project?.records.at(-1);
  const delta = last ? last.close - last.open : 0;
  return <div className="ths-ticker" data-ths-compact={level}>
    {level >= 4 && <span className="ths-ticker-brand"><Activity size={16} /> DSH 行情</span>}
    <span><small>代码总量</small><b className={direction(delta)}>{fmt(project?.currentLines)}</b></span>
    {level >= 2 && <span><small>最近修改</small><b className={direction(delta)}>{signed(delta)}</b></span>}
    {level >= 3 && <span><small>Token 累计</small><b>{fmt(project?.usage.totalTokens)}</b></span>}
    <i className={error ? 'ths-offline' : 'ths-online'} title={error || '已连接统计宿主'} />
  </div>;
}

export function MarketPanel(props) {
  return <ProjectMarketPanel key={`${props.root}\0${props.sessionId || ''}`} {...props} />;
}

function ProjectMarketPanel({ root, sessionId, apiBase = '', compact = false, sidebar = false, onClose, onShowTools }) {
  const { project, loading, error, refresh, preview } = useProject(root, apiBase);
  const [period, setPeriod] = useState('event');
  const [scope, setScope] = useState('project');
  const [averages, setAverages] = useState(true);
  const [hover, setHover] = useState(null);
  const [tab, setTab] = useState('changes');
  const [scale, setScale] = useState('absolute');
  const [agentOnly, setAgentOnly] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearError, setClearError] = useState('');
  const [clearing, setClearing] = useState(false);
  const chartRef = useRef(null);
  const now = useNow();
  const scoped = scope === 'session' ? sessionId : undefined;
  const bars = useMemo(() => project ? deriveBars(project, { now, sessionId: scoped }) : EMPTY, [project, now, scoped]);
  // 逐步：每一笔变化各占一根，等距排列，既不合并也不折叠，逐笔可数。
  // 分时：按真实时间分槽，同一槽位内的记录合并，横向位置对应真实时间。
  // agentOnly：只看 Agent 归属。外部校准动辄几百万行，会把几十行的真实改动压成 0 像素。
  const visible = useMemo(() => agentOnly ? bars.filter(bar => isAgent(bar)) : bars, [bars, agentOnly]);
  const intraday = useMemo(() => intradaySeries(visible), [visible]);
  const items = useMemo(() => {
    if (period === 'event') return intraday.series;
    return deriveCandles(visible.filter(bar => !bar.whitespace), period === 'step' ? 'event' : period);
  }, [visible, intraday, period]);
  const records = useMemo(() => bars.filter(isAgent), [bars]);
  const candles = useMemo(() => items.filter(item => !item.whitespace), [items]);
  const scopeBaseline = scoped && records.length ? records[0].open : project?.baseline ?? 0;
  const usage = useMemo(() => {
    if (scope !== 'session' || !project) return project?.usage;
    return project.usageRecords.filter(row => row.sessionId === sessionId).reduce((state, event) => recordUsage(state, event), createProject(root, 0, 0)).usage;
  }, [project, scope, sessionId, root]);
  const selected = (hover && hover.id ? candles.find(row => row.id === hover.id) : null) || candles.at(-1);
  useEffect(() => { setHover(null); }, [root, sessionId, scope, period]);
  const latest = records.at(-1);
  const delta = latest ? latest.close - latest.open : 0;
  const drift = bars.filter(bar => !isAgent(bar) && bar.kind !== 'current').reduce((sum, bar) => sum + bar.volume, 0);
  const volume = records.reduce((sum, row) => sum + row.volume, 0);
  const exportData = () => {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), project }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `${projectName(root)}-statistics.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  const clear = async () => {
    setClearing(true); setClearError('');
    try {
      const response = await fetch(`${apiBase}/tonghuashun/ledger?root=${encodeURIComponent(root)}`, { method: 'DELETE', headers: { 'X-THS-Confirm': 'clear-project-statistics' } });
      if (!response.ok) throw new Error((await response.json()).error);
      setConfirmClear(false); refresh();
    } catch (cause) { setClearError(cause.message); }
    finally { setClearing(false); }
  };
  const zoom = factor => {
    const scale = chartRef.current?.chart.timeScale();
    const range = scale?.getVisibleLogicalRange();
    if (range) { const half = (range.to - range.from) * factor / 2; const center = (range.to + range.from) / 2; scale.setVisibleLogicalRange({ from: center - half, to: center + half }); }
  };

  return <section className={`ths-market ${compact ? 'ths-compact' : ''} ${sidebar ? 'ths-sidebar-market' : ''} ${expanded ? 'ths-expanded' : ''}`} aria-label="项目行情">
    <div className="ths-market-title">
      <div><BarChart3 size={15} /><strong>{projectName(root)}</strong><span className="ths-symbol">CODE / LOC</span></div>
      <span className="ths-live"><i className={error ? 'ths-offline' : 'ths-online'} />{error ? '连接异常' : preview ? '本地验收项目' : '实时'}</span>
      {onShowTools && <ToolButton title="查看工具详情" onClick={onShowTools}><FileCode2 size={15} /></ToolButton>}
      {sidebar ? <ToolButton title="收起 K 线侧栏" onClick={onClose}><PanelRightClose size={16} /></ToolButton> : <ToolButton title={expanded ? '收起行情' : '展开行情'} onClick={() => setExpanded(!expanded)}>{expanded ? <X size={15} /> : <Maximize2 size={15} />}</ToolButton>}
    </div>
    <div className="ths-market-grid">
      <div className="ths-chart-column">
        <div className="ths-toolbar">
          <div className="ths-periods" role="tablist" aria-label="K 线周期">{PERIODS.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={period === value} onClick={() => { setPeriod(value); setHover(null); }}>{label}</button>)}</div>
          <select aria-label="统计范围" value={scope} onChange={event => { setScope(event.target.value); setHover(null); }}><option value="project">当前项目</option>{sessionId && <option value="session">当前会话</option>}</select>
          <div className="ths-toolbar-spacer" />
          <div className="ths-scale" role="tablist" aria-label="纵轴口径">{Object.entries(SCALE_LABELS).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={scale === value} onClick={() => { setScale(value); setHover(null); }}>{label}</button>)}</div>
          <label className="ths-ma-toggle ths-agent-only" title="只画 Agent 归属改动：外部校准动辄几百万行，会把几十行的真实改动压成 0 像素"><input type="checkbox" checked={agentOnly} onChange={event => { setAgentOnly(event.target.checked); setHover(null); }} />仅 Agent</label>
          <label className="ths-ma-toggle" title="显示 MA5 / MA10 均线"><input type="checkbox" checked={averages} onChange={event => setAverages(event.target.checked)} />MA</label>
          <ToolButton title="放大" onClick={() => zoom(.7)}><Plus size={15} /></ToolButton>
          <ToolButton title="缩小" onClick={() => zoom(1.4)}><Minus size={15} /></ToolButton>
          <ToolButton title="显示全部" onClick={() => chartRef.current?.chart.timeScale().fitContent()}><Maximize2 size={14} /></ToolButton>
          <ToolButton title="刷新统计" onClick={refresh}><RefreshCw size={14} /></ToolButton>
        </div>
        <div className="ths-ohlc" aria-live="polite"><span>{selected ? selected.kind === 'current' ? '当前状态' : period === 'step' || period === 'event' ? `${new Date(selected.at).toLocaleDateString('zh-CN')} ${time(selected.at)}` : `${selected.time} UTC` : '等待修改记录'}</span><span>开 <b>{fmt(selected?.open)}</b></span><span>高 <b>{fmt(selected?.high)}</b></span><span>低 <b>{fmt(selected?.low)}</b></span><span>收 <b className={selected ? direction(selected.close - selected.open) : ''}>{fmt(selected?.close)}</b></span><span>变更 <b>{fmt(selected?.volume)}</b></span>{selected && !isAgent(selected) && selected.kind !== 'current' && <span className="ths-drift-tag">未归属</span>}</div>
        <div className="ths-chart-stage"><Chart items={items} period={period} bucketSeconds={period === 'event' ? intraday.seconds : undefined} scaleMode={scale} baseline={scopeBaseline} averages={averages} onHover={setHover} chartRef={chartRef} />
          {!candles.length && <div className="ths-empty"><BarChart3 size={25} /><strong>{loading ? '正在读取统计' : '暂无已验证修改'}</strong><span>{project ? `代码基线 ${fmt(project.currentLines)} 行` : '等待宿主建立项目基线'}</span></div>}
        </div>
        <div className="ths-chart-footer"><span><i className="ths-ma5" />MA5</span><span><i className="ths-ma10" />MA10</span><span title="实心柱＝Agent 归属改动，空心柱＝未归属变化（外部校准、补齐的漂移）"><i className="ths-hollow" />未归属（空心） <b>{fmt(drift)} 行</b></span><span>累计变更 <b>{fmt(volume)} 行</b></span><span className="ths-toolbar-spacer" /><span>{records.length} 笔</span><span>{period === 'event' ? `槽位 ${intraday.seconds}s${intraday.compressed ? ' · 空闲已折叠' : ''}` : period === 'step' ? '每笔一根' : '周期 UTC'}</span><span>{`纵轴 ${SCALE_LABELS[scale]}`}{agentOnly ? ' · 仅 Agent' : ''}</span></div>
      </div>
      <aside className="ths-details" aria-label="项目统计详情">
        <div className="ths-quote"><span>项目代码总量</span><strong className={direction(delta)}>{fmt(project?.currentLines)}</strong><div className={direction(delta)}><b>{signed(delta)}</b><span>{latest?.open ? `${(delta / latest.open * 100).toFixed(2)}%` : '--'}</span><span>最近一笔</span></div></div>
        <dl className="ths-stat-grid"><div><dt>基线</dt><dd>{fmt(project?.baseline)}</dd></div><div><dt>修改笔数</dt><dd>{records.length}</dd></div><div><dt>新增行</dt><dd className="ths-up">{fmt(records.reduce((sum, row) => sum + row.added, 0))}</dd></div><div><dt>删除行</dt><dd className="ths-down">{fmt(records.reduce((sum, row) => sum + row.deleted, 0))}</dd></div></dl>
        <div className="ths-detail-tabs" role="tablist" aria-label="统计详情"><button role="tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}>逐步修改</button><button role="tab" aria-selected={tab === 'tokens'} onClick={() => setTab('tokens')}>Token 账本</button></div>
        {tab === 'changes' ? <div className="ths-trades"><div className="ths-trade-head"><span>时间 / 文件</span><span>净变化</span></div>{records.slice(-30).reverse().map(row => <div key={row.id} className="ths-trade" title={`${row.path || root}\n${row.tool || ''} / ${row.sessionId || ''}`}><div><time>{time(row.at)}</time><span>{projectName(row.path || row.tool || '修改')}</span></div><b className={direction(row.close - row.open)}>{signed(row.close - row.open)}<small>{row.kind === 'restore' ? '恢复' : row.source === 'external' ? '外部' : row.tool || 'Agent'}</small></b></div>)}{!records.length && <p className="ths-no-rows">暂无修改</p>}</div> : <div className="ths-token-ledger"><div className="ths-token-total"><span>累计 Token</span><strong>{fmt(usage?.totalTokens)}</strong></div><dl>{[['inputTokens', '未缓存输入'], ['cacheReadTokens', '缓存读取'], ['cacheWriteTokens', '缓存写入'], ['outputTokens', '输出'], ['reasoningTokens', '其中推理']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{fmt(usage?.[key])}</dd></div>)}</dl>{usage?.totalTokens === null && <p>已有记录的已知小计 {fmt(usage?.known?.totalTokens)}，总量不完整</p>}<span className="ths-token-count">{usage?.sampleCount || 0} 次请求记录</span></div>}
        <div className="ths-detail-actions"><ToolButton title="导出项目统计" onClick={exportData} disabled={!project}><Download size={15} /></ToolButton><ToolButton title="清理项目统计" onClick={() => setConfirmClear(true)} disabled={!project}><Trash2 size={15} /></ToolButton><span>{error || project?.status === 'error' ? '保存状态异常' : project ? '历史已保存' : '等待统计'}</span></div>
      </aside>
    </div>
    {error && <div className="ths-status-error" role="status">{error} <button onClick={refresh}>重试</button></div>}
    {project?.error && <div className="ths-status-error" role="status">统计保存异常：{project.error}</div>}
    {!!project?.reconciliations?.length && <details className="ths-warnings"><summary><SlidersHorizontal size={12} />外部变化校准 {project.reconciliations.length} 次<ChevronDown size={12} /></summary>{project.reconciliations.slice(-5).reverse().map(item => <p key={item.id}>{new Date(item.at).toLocaleString('zh-CN')}：{fmt(item.beforeTotal)} → {fmt(item.afterTotal)} 行（未归属 Agent）</p>)}</details>}
    {!!project?.warnings?.length && <details className="ths-warnings"><summary><SlidersHorizontal size={12} />数据状态 <ChevronDown size={12} /></summary>{project.warnings.map((warning, i) => <p key={i}>{typeof warning === 'string' ? warning : warning.message || JSON.stringify(warning)}</p>)}</details>}
    {confirmClear && <div className="ths-modal-backdrop"><div className="ths-modal" role="alertdialog" aria-modal="true" aria-labelledby="ths-clear-title"><h3 id="ths-clear-title">清理 {projectName(root)} 的统计？</h3><p>将清除该项目已保存的 K 线和 Token 统计，重新建立代码基线。不会修改代码或会话。</p>{clearError && <p role="alert">{clearError}</p>}<div><button onClick={() => setConfirmClear(false)} disabled={clearing}>取消</button><button className="ths-danger" onClick={clear} disabled={clearing}>{clearing ? '正在清理' : '确认清理'}</button></div></div></div>}
  </section>;
}
