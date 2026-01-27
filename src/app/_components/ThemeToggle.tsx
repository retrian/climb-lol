"use client"

import { useEffect, useState } from "react"

type ThemePreference = "light" | "dark"

const STORAGE_KEY = "theme-preference"
const OPTIONS: ThemePreference[] = ["dark", "light"]

const normalizePreference = (value: string | null): ThemePreference => {
  if (value === "dark" || value === "light") {
    return value
  }
  return "dark"
}

const applyPreference = (preference: ThemePreference) => {
  const root = document.documentElement
  const isDark = preference === "dark"
  root.classList.toggle("dark", isDark)
  root.dataset.theme = isDark ? "dark" : "light"
  root.style.colorScheme = isDark ? "dark" : "light"
  return isDark
}

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>("dark")
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    let saved: ThemePreference = "dark"
    try {
      saved = normalizePreference(localStorage.getItem(STORAGE_KEY))
    } catch {
      saved = "dark"
    }

    setPreference(saved)
    setIsDark(applyPreference(saved))

    const onChange = () => {
      const nextPref = normalizePreference(localStorage.getItem(STORAGE_KEY))
      setPreference(nextPref)
      setIsDark(applyPreference(nextPref))
    }

    onChange()

    window.addEventListener("storage", onChange)

    return () => {
      window.removeEventListener("storage", onChange)
    }
  }, [])

  const cycle = () => {
    const idx = OPTIONS.indexOf(preference)
    const next = OPTIONS[(idx + 1) % OPTIONS.length]
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Ignore storage failures (private mode, etc.)
    }
    setPreference(next)
    setIsDark(applyPreference(next))
  }

  const modeLabel = preference === "dark" ? "Dark" : "Light"
  const actionLabel = isDark ? "Light" : "Dark"

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${modeLabel}. Switch to ${actionLabel} mode.`}
      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
    >
      <span className="text-[10px]">{modeLabel}</span>
    </button>
  )
}
