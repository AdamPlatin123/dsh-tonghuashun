/**
 * 底部行情停靠面板（conversation.bottom.panel occupant）：代码量日 K 线。
 * 数据来自真实运行时会话（标准 props 的 useSession/useSessions）经
 * market-data.ts 确定性派生，Canvas 绘制蜡烛、均线与十字线。全部内容
 * 标注 LOCAL PROJECTION。
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MarketRepoStatsInjected } from './index.ts'
import { deriveMarket, type MarketCandle } from './market-data.ts'

import { fmt } from './market-fmt.ts'
import css from './MarketDock.module.css'

/** Full props of the bottom-panel occupant. */
export type MarketDockProps = PropsRuntime<'conversation.bottom.panel'>
  & PropsLocale<'ui-market'> & MarketRepoStatsInjected


/** 周期选项（对齐设计稿：分时/5日/日K/周K/月K）。 */
const PERIODS = ['分时', '5日', '日K', '周K', '月K'] as const
type Period = typeof PERIODS[number]

/** 按窗口聚合 K 线（周K=5 根、月K=20 根）。 */
function aggregate(candles: MarketCandle[], n: number): MarketCandle[] {
  const out: MarketCandle[] = []
  for (let i = 0; i < candles.length; i += n) {
    const group = candles.slice(i, i + n)
    const first = group[0]
    const last = group[group.length - 1]
    if (first === undefined || last === undefined) continue
    out.push({
      date: first.date,
      open: first.open,
      close: last.close,
      high: Math.max(...group.map(c => c.high)),
      low: Math.min(...group.map(c => c.low)),
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    })
  }
  return out
}

const UP = '#e4545b'
const DOWN = '#2fc45f'
const AXIS = '#41506b'
const GRID = 'rgba(120,140,170,0.14)'
const MA5 = '#e8c558'
const MA10 = '#b06bd6'

/** dock 高度下限（窄屏 150，对齐 demopage）。 */
function dockMin(): number {
  return window.matchMedia('(max-width: 720px)').matches ? 150 : 180
}
/** dock 高度上限：给顶栏 / 页头 / 输入区留出空间。 */
function dockMax(): number {
  return Math.max(dockMin(), Math.floor(window.innerHeight - 300))
}
/** 把请求高度钳进 [min, max]。 */
function clampDock(px: number): number {
  return Math.round(Math.min(dockMax(), Math.max(dockMin(), px)))
}

/**
 * 渲染 K 线停靠面板。
 * @param props - 插槽 props。
 * @returns 面板元素树。
 */
export function MarketDock({ useSession, sessionId, useSessions, repoStats, t }: MarketDockProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [period, setPeriod] = useState<Period>('日K')
  const [hover, setHover] = useState<number | null>(null)
  // 行情区可调高度（对齐 demopage market-resizer）：pointer 拖动与键盘都写同一
  // dockHeight 状态；canvas 经自身的 ResizeObserver 在高度变化时自动重绘。
  const [dockHeight, setDockHeight] = useState(() => Math.min(340, Math.max(220, Math.round(window.innerHeight * 0.32))))
  const dragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)
  const onResizerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.focus()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, startY: e.clientY, startHeight: dockHeight }
  }
  const onResizerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== e.pointerId) return
    setDockHeight(clampDock(drag.startHeight + drag.startY - e.clientY))
  }
  const onResizerEnd = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== e.pointerId) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    dragRef.current = null
  }
  const onResizerKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    let next = dockHeight
    if (e.key === 'ArrowUp') next += 16
    else if (e.key === 'ArrowDown') next -= 16
    else if (e.key === 'Home') next = dockMin()
    else if (e.key === 'End') next = dockMax()
    else return
    e.preventDefault()
    setDockHeight(clampDock(next))
  }

  const sessions = useSessions(s => s)
  const session = useSession(s => s)
  const subscribe = (fn: () => void): (() => void) => repoStats.subscribe(fn)
  const stats = useSyncExternalStore(subscribe, () => repoStats.getSnapshot().snapshot)
  const facts = {
    nodeCount: session.nodes.length,
    turnTimings: session.turnTimings,
    runningCalls: session.runningCalls.length,
  }
  const projection = deriveMarket(
    Object.values(sessions.byId).map(row => ({
      id: row.id,
      displayTitle: row.displayTitle,
      updatedAt: row.updatedAt,
      running: row.running,
      blank: row.blank,
    })),
    facts,
    sessionId,
    stats,
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const draw = (): void => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      if (rect.width < 40 || rect.height < 40) return
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      const ctx = canvas.getContext('2d')
      if (ctx === null) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const W = rect.width
      const H = rect.height
      ctx.clearRect(0, 0, W, H)
      // 真实记录缺失：无 git 聚合数据时留空并提示（不画伪序列）。
      if (projection.kline.length === 0) {
        ctx.fillStyle = AXIS
        ctx.font = '11px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.fillText('等待真实代码数据（git 聚合）…', W / 2, H / 2 - 6)
        ctx.fillStyle = 'rgba(122,138,166,0.7)'
        ctx.font = '9px ui-monospace, monospace'
        ctx.fillText('LOCAL PROJECTION', W / 2, H / 2 + 14)
        return
      }
      const padL = 46
      const padR = 8
      const padT = 8
      const padB = 14
      const plotW = W - padL - padR
      // 主图 78%，下方 22% 为成交量副图（对齐设计稿）。
      const volH = Math.round(H * 0.22)
      const plotH = H - padT - padB - volH - 6
      const volTop = padT + plotH + 6

      // 周期窗口：分时=折线，5日/日K/周K/月K=蜡烛（聚合）。
      const lineMode = period === '分时'
      const candles: MarketCandle[] = lineMode
        ? []
        : period === '5日'
          ? projection.kline.slice(-5)
          : period === '周K'
            ? aggregate(projection.kline, 5)
            : period === '月K'
              ? aggregate(projection.kline, 20)
              : projection.kline
      const closes = candles.map(c => c.close)
      const ticks = projection.ticks
      const min = lineMode
        ? Math.min(...ticks.map(t => t.value), projection.prevClose) * 0.995
        : Math.min(...candles.map(c => c.low)) * 0.995
      const max = lineMode
        ? Math.max(...ticks.map(t => t.value), projection.indexValue) * 1.005
        : Math.max(...candles.map(c => c.high)) * 1.005
      const n = lineMode ? Math.max(1, ticks.length) : candles.length
      const X = (i: number): number => padL + (i + 0.5) * (plotW / n)
      const Y = (v: number): number => padT + (1 - (v - min) / (max - min || 1)) * plotH

      ctx.strokeStyle = GRID
      ctx.lineWidth = 1
      for (let g = 1; g < 5; g++) {
        const y = padT + (plotH / 5) * g
        ctx.beginPath()
        ctx.moveTo(padL, y)
        ctx.lineTo(W - padR, y)
        ctx.stroke()
      }
      ctx.fillStyle = AXIS
      ctx.font = '9px ui-monospace, monospace'
      ctx.textAlign = 'right'
      for (let g = 0; g <= 4; g++) {
        const v = max - ((max - min) / 4) * g
        ctx.fillText(fmt(Math.round(v)), W - padR - 2, padT + (plotH / 4) * g + 3)
      }

      if (lineMode) {
        // 分时折线：真实 turn 序列。
        ctx.strokeStyle = UP
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ticks.forEach((tick, i) => {
          const x = X(i)
          const y = Y(tick.value)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
        ctx.fillStyle = 'rgba(228,84,91,0.08)'
        ctx.beginPath()
        ticks.forEach((tick, i) => { const x = X(i); const y = Y(tick.value); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y) })
        ctx.lineTo(X(Math.max(0, ticks.length - 1)), padT + plotH)
        ctx.lineTo(X(0), padT + plotH)
        ctx.closePath()
        ctx.fill()
      } else {
        const bw = Math.max(2, Math.min(9, plotW / candles.length * 0.55))
        candles.forEach((c, i) => {
          const x = X(i)
          const up = c.close >= c.open
          const col = up ? UP : DOWN
          ctx.strokeStyle = col
          ctx.fillStyle = col
          ctx.beginPath()
          ctx.moveTo(x, Y(c.high))
          ctx.lineTo(x, Y(c.low))
          ctx.stroke()
          const top = Y(Math.max(c.open, c.close))
          const hgt = Math.max(1, Math.abs(Y(c.open) - Y(c.close)))
          ctx.fillRect(x - bw / 2, top, bw, hgt)
        })

        const drawMA = (arr: number[], col: string): void => {
          ctx.strokeStyle = col
          ctx.lineWidth = 1.1
          ctx.beginPath()
          let started = false
          arr.forEach((v, i) => {
            if (v === 0) return
            if (!started) { ctx.moveTo(X(i), Y(v)); started = true } else { ctx.lineTo(X(i), Y(v)) }
          })
          ctx.stroke()
        }
        const ma = (n: number): number[] => closes.map((_, i) => {
          if (i < n - 1) return 0
          let sum = 0
          for (let j = 0; j < n; j++) {
            const prev = closes[i - j]
            if (prev !== undefined) sum += prev
          }
          return sum / n
        })
        drawMA(ma(5), MA5)
        drawMA(ma(10), MA10)
      }

      // 成交量副图：真实变更行（repo-stats 日聚合），无数据日不出现。
      const volMax = candles.length === 0 ? 1 : Math.max(...candles.map(c => c.volume))
      candles.forEach((c, i) => {
        const v = c.volume
        const hgt = Math.max(2, (v / volMax) * (volH - 6))
        const col = c.close >= c.open ? UP : DOWN
        ctx.fillStyle = col
        ctx.globalAlpha = 0.55
        ctx.fillRect(X(i) - 2, volTop + volH - hgt, 4, hgt)
        ctx.globalAlpha = 1
      })
      ctx.fillStyle = AXIS
      ctx.font = '8px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillText('VOL', padL + 2, volTop + 8)

      if (hover !== null && !lineMode) {
        const c = candles[hover]
        if (c === undefined) return
        const x = X(hover)
        ctx.strokeStyle = 'rgba(230,238,250,0.5)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x, padT)
        ctx.lineTo(x, padT + plotH)
        ctx.stroke()
        ctx.fillStyle = 'rgba(11,16,23,0.85)'
        ctx.fillRect(x - 40, padT + 2, 80, 16)
        ctx.fillStyle = c.close >= c.open ? UP : DOWN
        ctx.font = '9px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.fillText(`${c.date} ${fmt(c.close)}`, x, padT + 13)
      }
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => { observer.disconnect() }
  }, [projection, period, hover])

  const candleCount = period === '分时' ? Math.max(1, projection.ticks.length)
    : period === '5日' ? Math.min(5, projection.kline.length)
      : period === '周K' ? Math.ceil(projection.kline.length / 5)
        : period === '月K' ? Math.ceil(projection.kline.length / 20)
          : projection.kline.length
  const onMove = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    const rel = event.clientX - rect.left - 46
    const i = Math.floor((rel / Math.max(1, rect.width - 54)) * candleCount)
    setHover(i >= 0 && i < candleCount ? i : null)
  }
  const last = projection.kline[projection.kline.length - 1]

  return (
    <section className={css.root} style={{ height: dockHeight }} data-screen-label="market-dock" aria-label={t('dock.label')}>
      <div
        className={css.resizer} role="separator" aria-label="上下拖动调整 K 线面板高度"
        aria-orientation="horizontal" aria-controls="marketDock" aria-valuemin={dockMin()} aria-valuemax={dockMax()}
        aria-valuenow={dockHeight} tabIndex={0}
        onPointerDown={onResizerDown} onPointerMove={onResizerMove}
        onPointerUp={onResizerEnd} onPointerCancel={onResizerEnd} onKeyDown={onResizerKey}
      >
        <span className={css.resizerGrip} aria-hidden="true" />
      </div>
      <div className={css.dockBody}>
        <div className={css.head}>
        <span className={css.brand}><i className={css.dot} />{t('dock.title')}</span>
        <span className={css.local}>{t('common.local')}</span>
        <span className={css.grow} />
        <div className={css.tabs} role="tablist" aria-label={t('dock.period')}>
          {PERIODS.map(p => (
            <button
              key={p} type="button" role="tab" aria-selected={period === p}
              className={clsx(css.tab, period === p && css.active)} onClick={() => { setPeriod(p) }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className={css.body}>
        <div className={css.ohlc}>
          <b>{last?.date ?? ''}</b>
          <span>开:{fmt(projection.open)}</span>
          <span>收:<b className={projection.delta >= 0 ? css.up : css.down}>{fmt(projection.indexValue)}</b></span>
          <span className={projection.delta >= 0 ? css.up : css.down}>{projection.deltaPct >= 0 ? '+' : ''}{projection.deltaPct}%</span>
          <span>代码量:<b className={projection.delta >= 0 ? css.up : css.down}>{fmt(projection.changedLines)}</b></span>
        </div>
        <canvas
          ref={canvasRef} className={css.canvas} role="img"
          aria-label={t('dock.chartAria')} onMouseMove={onMove} onMouseLeave={() => { setHover(null) }}
        />
      </div>
      </div>
    </section>
  )
}
