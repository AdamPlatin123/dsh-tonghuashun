import React, { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers, ColorType } from 'lightweight-charts';
import { packLabelIndices } from './labels.js';
import { candleStyle, scaledOhlc, isAgent, UP, DOWN, DRIFT } from './candles.js';

const fmt = value => new Intl.NumberFormat('en-US').format(value);
const pad = value => String(value).padStart(2, '0');
const clock = at => { const date = new Date(at); return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`; };
const stamp = at => { const date = new Date(at); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock(at)}`; };

// 窄于这个宽度就只保留标记符号：文字必然互相挤压，完整数字改由悬停详情行提供。
const LABEL_MIN_WIDTH = 220;
// 初始可见根数按实际绘制宽度折算。空心内腔 ≈ 0.8×间距 − 2px，所以每根给足 8px 才看得清空/满。
const PIXELS_PER_BAR = 8;

function toSeconds(item) {
  if (typeof item.time === 'number') return item.time;
  const parsed = Date.parse(item.time);
  return Math.floor((Number.isFinite(parsed) ? parsed : Date.now()) / 1000);
}

// 分时轴按真实时间排布，刻度直接由轴值格式化，不再反查被伪造的序号。
function tickText(seconds, date) {
  if (seconds < 60) return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  if (seconds < 86400) return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function Chart({ items, period, bucketSeconds, scaleMode = 'absolute', baseline = 0, averages, onHover, chartRef }) {
  const element = useRef(null);
  const hoverRef = useRef(onHover);
  const periodRef = useRef(period);
  const bucketRef = useRef(bucketSeconds);
  const barsRef = useRef(new Map());
  const labelsRef = useRef([]);
  const viewRef = useRef('');
  hoverRef.current = onHover;
  periodRef.current = period;
  bucketRef.current = bucketSeconds;

  // 标记符号始终保留；文字只在屏幕空间里互不重叠时才画。缩放、平移、改尺寸都会重算。
  const paintLabels = () => {
    const ref = chartRef.current;
    if (!ref) return;
    const markers = labelsRef.current;
    const pane = ref.chart.paneSize();
    if (!markers.length || pane.width < LABEL_MIN_WIDTH) {
      ref.markers.setMarkers(markers.map(marker => ({ ...marker, text: '' })));
      return;
    }
    const candidates = markers.flatMap((marker, index) => {
      const x = ref.chart.timeScale().timeToCoordinate(marker.time);
      return typeof x === 'number' && x >= 0 && x <= pane.width ? [{ x, text: marker.text, position: marker.position, index }] : [];
    });
    const kept = packLabelIndices(candidates, { maxLabels: 6 });
    ref.markers.setMarkers(markers.map((marker, index) => ({ ...marker, text: kept.has(index) ? marker.text : '' })));
  };

  useEffect(() => {
    const chart = createChart(element.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#11151c' }, textColor: '#8993a3', fontSize: 11, fontFamily: 'Consolas, monospace', attributionLogo: true },
      grid: { vertLines: { color: '#1e252e' }, horzLines: { color: '#1e252e' } },
      rightPriceScale: { borderColor: '#30363f', scaleMargins: { top: .14, bottom: .08 } },
      timeScale: {
        borderColor: '#30363f', rightOffset: 4, barSpacing: 8, minBarSpacing: 0.1, timeVisible: true, secondsVisible: true,
        tickMarkFormatter: time => {
          // 逐步周期用等距序号当轴值，刻度文字由序号反查那一笔的真实时间。
          if (periodRef.current === 'step') {
            const item = barsRef.current.get(time);
            return item ? clock(item.at) : '';
          }
          const date = new Date(time * 1000);
          if (periodRef.current === 'event') return tickText(bucketRef.current ?? 1, date);
          const day = `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
          return periodRef.current === 'day' ? day : `${date.getUTCFullYear()}-${day}`;
        },
      },
      localization: {
        priceFormatter: fmt,
        timeFormatter: time => {
          if (periodRef.current === 'step') {
            const item = barsRef.current.get(time);
            return item ? stamp(item.at) : '';
          }
          const date = new Date(time * 1000);
          if (periodRef.current === 'event') return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
          return `${date.toISOString().slice(0, 10)} UTC`;
        },
      },
      crosshair: { vertLine: { color: '#72849c' }, horzLine: { color: '#72849c' } },
    });
    // 边框必须先开：空心柱只靠边框成形，实体填充随之四边内缩 1px。
    const series = chart.addSeries(CandlestickSeries, { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: true, priceFormat: { type: 'price', precision: 0, minMove: 1 } });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false }, 1);
    chart.panes()[1].setHeight(75);
    const ma5 = chart.addSeries(LineSeries, { color: '#e8c766', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const ma10 = chart.addSeries(LineSeries, { color: '#ac8be8', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const markers = createSeriesMarkers(series, []);
    chart.subscribeCrosshairMove(param => {
      if (!param.time) return hoverRef.current(null);
      hoverRef.current(barsRef.current.get(param.time) ?? null);
    });
    chartRef.current = { chart, series, volume, ma5, ma10, markers };
    return () => { chartRef.current = null; chart.remove(); };
  }, []);

  useEffect(() => {
    const ref = chartRef.current;
    if (!ref) return;
    // 相对基线／每笔变化只在纵轴上换口径，未归属柱与 Agent 柱同样保留，外部漂移不会被藏起来。
    const ordinal = period === 'step';
    const points = items.map((item, index) => ({ item, time: ordinal ? index + 1 : toSeconds(item) }));
    const bars = new Map();
    const candles = [];
    const volumes = [];
    for (const { item, time } of points) {
      if (item.whitespace) { candles.push({ time }); volumes.push({ time }); continue; }
      bars.set(time, item);
      const style = candleStyle(item);
      const ohlc = scaledOhlc(item, scaleMode, baseline);
      candles.push({ time, ...ohlc, color: style.fill, borderColor: style.border, wickColor: style.wick });
      volumes.push({ time, value: item.volume, color: `${style.volume}99` });
    }
    barsRef.current = bars;
    ref.series.setData(candles);
    ref.volume.setData(volumes);

    // 空槽位承接上一根收盘，均线才与「位置即真实时间」的坐标尺一致。
    const average = n => {
      const result = [];
      const window = [];
      let carried;
      for (const { item, time } of points) {
        const close = item.whitespace ? carried : scaledOhlc(item, scaleMode, baseline).close;
        if (close === undefined) continue;
        carried = close;
        window.push(close);
        if (window.length > n) window.shift();
        if (window.length === n) result.push({ time, value: window.reduce((sum, value) => sum + value, 0) / n });
      }
      return result;
    };
    ref.ma5.setData(averages ? average(5) : []);
    ref.ma10.setData(averages ? average(10) : []);

    labelsRef.current = [];
    for (const { item, time } of points) {
      if (item.whitespace || Math.abs(item.close - item.open) < 1000) continue;
      const down = item.close < item.open;
      labelsRef.current.push({ time, position: down ? 'aboveBar' : 'belowBar', color: isAgent(item) ? (down ? DOWN : UP) : DRIFT,
        shape: isAgent(item) ? (down ? 'arrowDown' : 'arrowUp') : 'circle', size: isAgent(item) ? 1 : 0,
        text: `${item.close >= item.open ? '+' : ''}${fmt(item.close - item.open)} 行${isAgent(item) ? '' : ' 未归属'}` });
    }

    const pane = ref.chart.paneSize();
    const view = `${period}:${scaleMode}:${bucketSeconds ?? ''}`;
    if (viewRef.current !== view && candles.length) {
      const total = candles.length;
      const visible = Math.max(30, Math.min(240, Math.floor(pane.width / PIXELS_PER_BAR)));
      if ((period === 'event' || ordinal) && total > visible) ref.chart.timeScale().setVisibleLogicalRange({ from: total - visible, to: total + 3 });
      else ref.chart.timeScale().fitContent();
    }
    viewRef.current = view;
    paintLabels();
  }, [items, period, scaleMode, baseline, bucketSeconds, averages]);

  // 缩放、平移、容器改尺寸都会改变柱子的屏幕坐标，标注必须跟着重排。
  useEffect(() => {
    const ref = chartRef.current;
    if (!ref) return;
    let frame = 0;
    const handler = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => paintLabels()); };
    ref.chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    window.addEventListener('resize', handler);
    return () => {
      cancelAnimationFrame(frame);
      ref.chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
      window.removeEventListener('resize', handler);
    };
  }, [items, period, scaleMode]);

  return <div className="ths-chart" ref={element} role="img" aria-label="当前项目真实代码行数 K 线图" />;
}
