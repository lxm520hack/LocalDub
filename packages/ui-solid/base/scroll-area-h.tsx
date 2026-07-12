import { cn } from '@repo/shared/lib/utils';
import { JSX, createSignal, onCleanup, onMount } from 'solid-js'

interface ScrollAreaHProps {
  children: JSX.Element
  class?: string
  scrollbarSize?: number
}

export function ScrollAreaH(props: ScrollAreaHProps) {
  const sbSize = props.scrollbarSize ?? 6

  let outerRef!: HTMLDivElement
  let contentRef!: HTMLDivElement
  let thumbRef!: HTMLDivElement

  const [show, setShow] = createSignal(false)
  const [hover, setHover] = createSignal(false)
  const [thumbLeft, setThumbLeft] = createSignal(0)
  const [thumbW, setThumbW] = createSignal(0)

  let hideTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      if (!hover()) setShow(false)
    }, 1500)
  }

  function update() {
    const el = contentRef
    const { scrollLeft, scrollWidth, clientWidth } = el
    if (scrollWidth <= clientWidth) {
      setShow(false)
      return
    }
    setThumbW(Math.max(20, clientWidth * clientWidth / scrollWidth))
    setThumbLeft(scrollLeft / scrollWidth * clientWidth)
    setShow(true)
    scheduleHide()
  }

  function handleScroll() { update() }

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
  let dragStartX = 0
  let dragScroll = 0

  function onThumbDown(e: PointerEvent) {
    e.preventDefault()
    dragging = true
    dragStartX = e.clientX
    dragScroll = contentRef.scrollLeft
    thumbRef.setPointerCapture(e.pointerId)
  }

  function onThumbMove(e: PointerEvent) {
    if (!dragging) return
    const delta = e.clientX - dragStartX
    contentRef.scrollLeft = dragScroll + delta / contentRef.clientWidth * contentRef.scrollWidth
  }

  function onThumbUp() { dragging = false }

  function onTrackDown(e: PointerEvent) {
    if (e.target === thumbRef) return
    const rect = outerRef.getBoundingClientRect()
    contentRef.scrollLeft = ((e.clientX - rect.left) / rect.width) * contentRef.scrollWidth
  }

  return (
    <div
      ref={outerRef!}
      class={cn("relative w-full h-full min-w-0", props.class)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); scheduleHide() }}
    >
      <style>{`.scroll-area-content-h::-webkit-scrollbar { display: none; }`}</style>
      <div
        ref={contentRef!}
        style={{ "scrollbar-width": "none" }}
        class="scroll-area-content-h overflow-x-auto overflow-y-hidden h-full"
        onScroll={handleScroll}
      >
        {props.children}
      </div>
      <div
        class="absolute bottom-0 left-0 w-full"
        style={{
          height: sbSize + 'px',
          "pointer-events": show() ? 'auto' : 'none',
          opacity: show() ? 1 : 0,
          transition: 'opacity 0.15s',
        }}
        onPointerDown={onTrackDown}
      >
        <div
          ref={thumbRef!}
          class="absolute h-full cursor-pointer bg-accent/70"
          style={{
            width: thumbW() + 'px',
            transform: `translateX(${thumbLeft()}px)`,
          }}
          onPointerDown={onThumbDown}
          onPointerMove={onThumbMove}
          onPointerUp={onThumbUp}
        />
      </div>
    </div>
  )
}
