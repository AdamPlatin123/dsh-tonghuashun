import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PanelRightOpen } from 'lucide-react';
import { ProjectTicker } from './MarketPanel.jsx';
import { MarketDrawer, MarketSidebar, useNarrowSidebar } from './MarketSidebar.jsx';
import { bindThemeOverrides, createSkinState } from './theme.js';

export const inject = ['slots', 'theme', 'layout'];

function useProjectRoot({ sessionId, useSessions, useWorkspaces }) {
  const cwd = useSessions(state => state.byId[sessionId]?.cwd);
  const workspacePath = useWorkspaces(state =>
    state.items.find(workspace => workspace.sessionIds.includes(sessionId))?.path);
  return cwd || workspacePath || '';
}

function ProjectPanel(props) {
  const root = useProjectRoot(props);
  const selection = props.useStore?.(state => state.selection);
  const previousSelection = useRef(selection);
  useEffect(() => {
    if (selection && selection !== previousSelection.current) props.onShowTools();
    previousSelection.current = selection;
  }, [selection, props.onShowTools]);
  if (!root) return <div className="ths-project-required">请选择项目</div>;
  return <MarketSidebar root={root} sessionId={props.sessionId} onClose={props.onClose} onShowTools={props.onShowTools} />;
}

function ProjectHeader(props) {
  const enabled = useSyncExternalStore(props.skin.subscribe, props.skin.getSnapshot);
  const root = useProjectRoot(props);
  const narrow = useNarrowSidebar();
  const [open, setOpen] = useState(() => !narrow);
  const close = () => { setOpen(false); props.layout.closeDetails(); };
  useEffect(() => {
    if (!enabled || !root || !open) return;
    if (narrow) { props.layout.closeDetails(); return; }
    return props.mountSidebar({
      onClose: close,
      onShowTools: () => { setOpen(false); props.layout.openDetails(); },
    });
  }, [enabled, root, props.sessionId, open, narrow]);
  if (!enabled || !root) return null;
  return <div className="ths-slot-header"><ProjectTicker root={root} apiBase="" />
    <button type="button" className="ths-icon ths-sidebar-toggle" title={open ? '收起 K 线侧栏' : '打开 K 线侧栏'} aria-label={open ? '收起 K 线侧栏' : '打开 K 线侧栏'} aria-expanded={open} onClick={() => open ? close() : setOpen(true)}><PanelRightOpen size={17} /></button>
    {open && narrow && <MarketDrawer root={root} sessionId={props.sessionId} onClose={close} />}
  </div>;
}

function SkinSetting({ skin }) {
  const enabled = useSyncExternalStore(skin.subscribe, skin.getSnapshot);
  return <label className="ths-skin-setting">
    <span>同花顺风格皮肤</span>
    <input type="checkbox" role="switch" checked={enabled}
      onChange={event => skin.setEnabled(event.target.checked)} />
  </label>;
}

export function apply(ctx) {
  const skin = createSkinState();
  ctx.effect(() => bindThemeOverrides(ctx.theme, skin));
  const mountSidebar = callbacks => {
    // 复用宿主详情的会话状态，工具选择变化时归还详情栏。
    const store = ctx.slots.entriesOfSlot('details')[0]?.store;
    const dispose = ctx.slots.register({ name: 'details', priority: -100, ...(store ? { store } : {}), inject: () => callbacks }, ProjectPanel);
    const frame = requestAnimationFrame(() => ctx.layout.openDetails());
    return () => { cancelAnimationFrame(frame); dispose(); };
  };
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id: 'tonghuashun-ticker', order: 100,
    inject: () => ({ skin, layout: ctx.layout, mountSidebar }),
  }, ProjectHeader));
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'tonghuashun-skin', order: 30,
    inject: () => ({ skin }),
  }, SkinSetting));
}
