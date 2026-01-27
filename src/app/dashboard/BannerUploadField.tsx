'use client'

import { useMemo, useState } from 'react'

type BannerUploadFieldProps = {
  name: string
  previewUrl?: string | null
  placeholder?: string
  helperText?: string
}

export default function BannerUploadField({ name, previewUrl, placeholder, helperText }: BannerUploadFieldProps) {
  const [file, setFile] = useState<File | null>(null)

  const livePreview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])

  return (
    <div>
      {livePreview || previewUrl ? (
        <div className="relative mb-4 h-32 w-full overflow-hidden rounded-none border-2 border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={livePreview ?? previewUrl ?? ''} alt="Banner Preview" className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="mb-4 flex h-24 items-center justify-center rounded-none border-2 border-dashed border-slate-200 bg-white text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          {placeholder ?? 'No banner set'}
        </div>
      )}

      <div>
        <input
          type="file"
          name={name}
          accept="image/png,image/jpeg,image/webp"
          required
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="block w-full text-sm text-slate-500 file:mr-4 file:rounded-none file:border-0 file:bg-slate-100 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200 dark:text-slate-400 dark:file:bg-slate-800 dark:file:text-slate-200 dark:hover:file:bg-slate-700"
        />
        {helperText ? <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{helperText}</p> : null}
      </div>
    </div>
  )
}

