'use client'

import { useState } from 'react'
import BannerUploadField from '@/app/dashboard/BannerUploadField'

export function BannerUploadSection({ leaderboardId, bannerUrl }: { leaderboardId: string; bannerUrl: string | null }) {
  const [hasValidationError, setHasValidationError] = useState(false)

  return (
    <>
      <input type="hidden" name="leaderboard_id" value={leaderboardId} />
      <BannerUploadField
        name="banner"
        previewUrl={bannerUrl}
        placeholder="No banner set"
        helperText="PNG/JPG/WEBP • Max 4MB • Recommended 1600×400"
        onValidationChange={setHasValidationError}
      />

      <button
        type="submit"
        disabled={hasValidationError}
        className="rounded-none bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
      >
        Upload & Save Banner
      </button>
    </>
  )
}
