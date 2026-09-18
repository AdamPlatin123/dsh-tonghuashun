import React, { useEffect, useRef, useState } from 'react';
import { MarketPanel } from './MarketPanel.jsx';

// 宿主需为左栏和会话保留至少 1060px，余下空间不足时改用抽屉。
export function useNarrowSidebar() {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1359px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1359px)');
    const update = () => setNarrow(media.matches);
    media.addEventListener('change', update);
    update();
    return () => media.removeEventListener('change', update);
  }, []);
  return narrow;
}

export function MarketSidebar(props) {
  return <aside className="ths-market-sidebar" aria-label="K 线侧栏"><MarketPanel {...props} sidebar /></aside>;
}

export function MarketDrawer({ onClose, ...props }) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="ths-market-drawer" aria-label="K 线侧栏" onCancel={event => { event.preventDefault(); onClose(); }}>
    <MarketSidebar {...props} onClose={onClose} />
  </dialog>;
}
