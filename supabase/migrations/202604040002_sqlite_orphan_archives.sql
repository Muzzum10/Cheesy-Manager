create table if not exists public."sqlite_orphan_potd_poll_candidates" (
  "poll_id" bigint not null,
  "option_rank" bigint not null,
  "user_id" text not null,
  "match_id" text not null,
  "runs" bigint default 0 not null,
  "balls_played" bigint default 0 not null,
  "wickets" bigint default 0 not null,
  "runs_conceded" bigint default 0 not null,
  "balls_bowled" bigint default 0 not null,
  "match_mvp" double precision default 0 not null,
  "team_name_snapshot" text,
  "opponent_name_snapshot" text,
  "fixture_day_number" bigint,
  "migration_note" text not null,
  primary key ("poll_id", "option_rank")
);

create table if not exists public."sqlite_orphan_team_vice_captains" (
  "guild_id" text not null,
  "team_id" bigint not null,
  "vice_captain_discord_id" text not null,
  "migration_note" text not null,
  primary key ("guild_id", "team_id", "vice_captain_discord_id")
);
