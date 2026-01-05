'use client'

import { useLayoutEffect, useRef, useState } from 'react'

type FitTextProps = {
  text: string
  className?: string
  minScale?: number
  title?: string
}

export default function FitText({ text, className, minScale = 0.75, title }: FitTextProps) {
  const spanRef = useRef<HTMLSpanElement>(null)
  const [fontSize, setFontSize] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = spanRef.current
    if (!el) return

    let frame = 0
    const measure = () => {
      const element = spanRef.current
      if (!element) return
      const container = element.parentElement
      if (!container) return

      const prevInline = element.style.fontSize
      element.style.fontSize = ''
      const baseSize = parseFloat(getComputedStyle(element).fontSize)
      const available = container.clientWidth
      const needed = element.scrollWidth
      element.style.fontSize = prevInline

      if (!available || !needed || !baseSize) return

      if (needed > available) {
        const scale = Math.max(minScale, available / needed)
        const nextSize = Math.floor(baseSize * scale)
        setFontSize((prev) => (prev === nextSize ? prev : nextSize))
      } else {
        setFontSize((prev) => (prev === null ? prev : null))
      }
    }

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    })

    observer.observe(el)
    if (el.parentElement) observer.observe(el.parentElement)

    measure()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [text, minScale])

  return (
    <span
      ref={spanRef}
      className={className}
      style={fontSize ? { fontSize: `${fontSize}px` } : undefined}
      title={title ?? text}
    >
      {text}
    </span>
  )
}
