import { createClient } from '@/lib/supabase/server'

export const TABS = ['home', 'members', 'leaderboards', 'highlights'] as const
export type ClubTab = (typeof TABS)[number]

export type ClubRow = {
  id: string
  name: string
  slug: string
  description: string | null
  visibility: string | null
  created_at: string | null
  updated_at: string | null
  owner_user_id: string | null
  banner_url: string | null
}

export type MemberRow = {
  id: string
  user_id: string | null
  role: string | null
  joined_at: string | null
  player_puuid: string | null
  game_name: string | null
  tag_line: string | null
}

export type ClubLeaderboardRow = {
  id: string
  leaderboard_id: string
  created_at: string | null
  added_by_user_id: string | null
}

export type HighlightRow = {
  id: string
  club_id: string
  user_id: string | null
  url: string
  duration_seconds: number | null
  created_at: string | null
}

export type LeaderboardRow = {
  id: string
  name: string
  slug: string
  leaderboard_code: number
  description: string | null
  updated_at: string | null
  banner_url: string | null
  visibility: string | null
}

export type ClubShowdownRow = {
  id: string
  requester_club_id: string
  target_club_id: string
  status: string | null
  created_at: string | null
}

export type ClubNameRow = {
  id: string
  name: string
}

export type AttachedLeaderboard = {
  linkId: string
  addedAt: string | null
  leaderboard: LeaderboardRow | null
}

export type SupabaseClient = Awaited<ReturnType<typeof createClient>>
