-- Full rebuild: clear match_participants + player_lp_events, then rerun refresh job.

begin;

delete from public.player_lp_events;
delete from public.match_participants;

commit;
