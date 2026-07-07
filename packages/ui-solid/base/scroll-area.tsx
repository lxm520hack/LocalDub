import { cn } from '@repo/shared/lib/utils';
import { JSX, createSignal, createEffect, onCleanup, onMount } from 'solid-js'

interface ScrollAreaProps {
  children: JSX.Element
  class?: string
  scrollbarSize?: number
  thumbClass?: number
}

export function ScrollArea(props: ScrollAreaProps) {
  const scrollbarSize = props.scrollbarSize ?? 6

  let outerRef!: HTMLDivElement
  let contentRef!: HTMLDivElement
  let thumbRef!: HTMLDivElement

  const [show, setShow] = createSignal(false)
  const [thumbTop, setThumbTop] = createSignal(0)
  const [thumbH, setThumbH] = createSignal(0)
  const [hover, setHover] = createSignal(false)

  let hideTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (!hover()) setShow(false)
    }, 1500)
  }

  function update() {
    const el = contentRef
    const { scrollTop, scrollHeight, clientHeight } = el
    if (scrollHeight <= clientHeight) {
      setShow(false)
      return
    }
    const h = Math.max(20, clientHeight * clientHeight / scrollHeight)
    setThumbH(h)
    setThumbTop(scrollTop / scrollHeight * clientHeight)
    setShow(true)
    scheduleHide()
  }

  function handleScroll() {
    update()
  }

  let ro: ResizeObserver | null = null

  onMount(() => {
    ro = new ResizeObserver(() => update())
    ro.observe(contentRef)
  })

  onCleanup(() => {
    ro?.disconnect()
    if (hideTimer) clearTimeout(hideTimer)
  })

  let dragging = false
  let dragStartY = 0
  let dragStartScroll = 0

  function onThumbDown(e: PointerEvent) {
    e.preventDefault()
    dragging = true
    dragStartY = e.clientY
    dragStartScroll = contentRef.scrollTop
    thumbRef.setPointerCapture(e.pointerId)
  }

  function onThumbMove(e: PointerEvent) {
    if (!dragging) return
    const delta = e.clientY - dragStartY
    const ratio = delta / contentRef.clientHeight
    contentRef.scrollTop = dragStartScroll + ratio * contentRef.scrollHeight
  }

  function onThumbUp() {
    dragging = false
  }

  function onTrackDown(e: PointerEvent) {
    if (e.target === thumbRef) return
    const rect = outerRef.getBoundingClientRect()
    const y = e.clientY - rect.top
    contentRef.scrollTop = (y / rect.height) * contentRef.scrollHeight
  }

  return (
    <div
      ref={outerRef!}
      class={cn("relative h-full min-h-0",props.class)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); scheduleHide() }}
    >
      <style>{`
        .scroll-area-content::-webkit-scrollbar { display: none; }
      `}</style>
      <div
        ref={contentRef!}
        style={{
          "scrollbar-width": 'none',
        }}
        class={cn("scroll-area-content overflow-auto h-full ")}
        onScroll={handleScroll}
      >
        {props.children}
      </div>
      <div
        class={cn("absolute top-0 right-0 h-full")}
        style={{
          width: scrollbarSize + 'px',
          "pointer-events": show() ? 'auto' : 'none',
          opacity: show() ? 1 : 0,
          transition: 'opacity 0.15s',
        }}
        onPointerDown={onTrackDown}
      >
        <div
          ref={thumbRef!}
          class={cn("absolute w-full cursor-pointer bg-accent/70", props.thumbClass)}
          style={{
            height: thumbH() + 'px',
            transform: `translateY(${thumbTop()}px)`,
            // "border-radius": scrollbarSize / 2 + 'px',
          }}
          onPointerDown={onThumbDown}
          onPointerMove={onThumbMove}
          onPointerUp={onThumbUp}
        />
      </div>
    </div>
  )
}
