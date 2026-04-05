"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDB = initDB;
exports.getDB = getDB;
exports.getDBKind = getDBKind;
const sqlite3_1 = __importDefault(require("sqlite3"));
const sqlite_1 = require("sqlite");
const path_1 = __importDefault(require("path"));
let db;
let dbKind = 'sqlite';
async function initDB() {
    const postgresUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
    if (postgresUrl) {
        const { createPostgresCompatDb } = require('./database-postgres');
        db = await createPostgresCompatDb({
            connectionString: postgresUrl,
            schemaPath: path_1.default.join(__dirname, 'supabase', 'migrations', '202604040001_init_from_sqlite.sql')
        });
        dbKind = 'postgres';
        console.log('PostgreSQL database initialized via Supabase.');
        return;
    }
    dbKind = 'sqlite';
    db = await (0, sqlite_1.open)({
        filename: './auction_v2.sqlite',
        driver: sqlite3_1.default.Database
    });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS sets (
            guild_id TEXT NOT NULL,
            set_name TEXT NOT NULL,
            base_price_lakhs INTEGER NOT NULL,
            increment_lakhs INTEGER NOT NULL DEFAULT 20,
            set_order INTEGER,
            PRIMARY KEY (guild_id, set_name)
        );

        CREATE TABLE IF NOT EXISTS teams (
            guild_id TEXT NOT NULL,
            team_id INTEGER PRIMARY KEY AUTOINCREMENT,
            team_name TEXT NOT NULL,
            owner_discord_id TEXT NOT NULL,
            purse_lakhs INTEGER NOT NULL,
            max_roster_size INTEGER NOT NULL DEFAULT 15,
            role_id TEXT,
            name_change_count INTEGER NOT NULL DEFAULT 0,
            UNIQUE(guild_id, team_name),
            UNIQUE(guild_id, owner_discord_id)
        );

        CREATE TABLE IF NOT EXISTS auction_players (
            guild_id TEXT NOT NULL,
            discord_id TEXT NOT NULL,
            ign TEXT NOT NULL,
            set_name TEXT,
            status TEXT NOT NULL DEFAULT 'AVAILABLE',
            sold_to_team_id INTEGER,
            sold_for_lakhs INTEGER,
            PRIMARY KEY (guild_id, discord_id),
            FOREIGN KEY (guild_id, set_name) REFERENCES sets(guild_id, set_name),
            FOREIGN KEY (sold_to_team_id) REFERENCES teams(team_id)
        );

        CREATE TABLE IF NOT EXISTS auction_ledger (
            guild_id TEXT NOT NULL PRIMARY KEY,
            player_id TEXT NOT NULL,
            current_bid_lakhs INTEGER NOT NULL,
            current_holder_team_id INTEGER,
            FOREIGN KEY (guild_id, player_id) REFERENCES auction_players(guild_id, discord_id),
            FOREIGN KEY (current_holder_team_id) REFERENCES teams(team_id)
        );

        CREATE TABLE IF NOT EXISTS guild_settings (
            guild_id TEXT PRIMARY KEY,
            timezone TEXT DEFAULT 'IST',
            sales_log_channel_id TEXT,
            admin_audit_log_channel_id TEXT,
            admin_audit_logs_enabled INTEGER DEFAULT 1,
            community_roster_log_channel_id TEXT,
            community_player_log_channel_id TEXT,
            community_player_logs_enabled INTEGER DEFAULT 1,
            stadium_channel_id TEXT,
            schedule_season TEXT,
            fixture_announcement_channel_id TEXT,
            ping_restricted_channel_id TEXT,
            auction_stats_season TEXT,
            auction_bid_timer_seconds INTEGER DEFAULT 15,
            auction_call_timer_seconds INTEGER DEFAULT 2,
            team_name_change_limit INTEGER DEFAULT 3,
            team_rename_window_open INTEGER DEFAULT 1,
            team_rename_window_expires_at INTEGER,
            regteam_command_channel_id TEXT,
            community_roster_manage_open INTEGER DEFAULT 1,
            community_join_requests_open INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS scheduled_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            target_role_id TEXT NOT NULL,
            target_type TEXT DEFAULT 'ROLE',
            message_content TEXT NOT NULL,
            scheduled_time INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING',
            author_id TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS potd_settings (
            guild_id TEXT PRIMARY KEY,
            channel_id TEXT,
            results_channel_id TEXT,
            ping_role_id TEXT,
            window_start_minute INTEGER NOT NULL DEFAULT 1200,
            window_end_minute INTEGER NOT NULL DEFAULT 180,
            window_end_day_offset INTEGER NOT NULL DEFAULT 1,
            allow_multiple_votes INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS potd_polls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            season_name TEXT NOT NULL,
            label_text TEXT NOT NULL,
            option_count INTEGER NOT NULL,
            allow_multiple_votes INTEGER NOT NULL DEFAULT 0,
            source_window_start_at INTEGER,
            source_window_end_at INTEGER,
            created_at INTEGER NOT NULL,
            closes_at INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'OPEN',
            result_message_id TEXT,
            UNIQUE(guild_id, message_id)
        );

        CREATE TABLE IF NOT EXISTS potd_poll_candidates (
            poll_id INTEGER NOT NULL,
            option_rank INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            match_id TEXT NOT NULL,
            runs INTEGER DEFAULT 0,
            balls_played INTEGER DEFAULT 0,
            wickets INTEGER DEFAULT 0,
            runs_conceded INTEGER DEFAULT 0,
            balls_bowled INTEGER DEFAULT 0,
            match_mvp REAL DEFAULT 0,
            team_name_snapshot TEXT,
            opponent_name_snapshot TEXT,
            fixture_day_number INTEGER,
            PRIMARY KEY (poll_id, option_rank),
            FOREIGN KEY (poll_id) REFERENCES potd_polls(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS ipl_prediction_settings (
            guild_id TEXT PRIMARY KEY,
            channel_id TEXT,
            announcement_channel_id TEXT,
            announcement_role_ids_json TEXT,
            reminder_role_id TEXT,
            reminder_panel_channel_id TEXT,
            reminder_panel_message_id TEXT
        );

        CREATE TABLE IF NOT EXISTS ipl_prediction_matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            fixture_key TEXT NOT NULL,
            fixture_number INTEGER NOT NULL,
            match_label TEXT NOT NULL,
            team_a TEXT NOT NULL,
            team_b TEXT NOT NULL,
            match_date_label TEXT NOT NULL,
            match_day_label TEXT,
            match_time_label TEXT NOT NULL,
            starts_at INTEGER NOT NULL,
            deadline_at INTEGER NOT NULL,
            announce_channel_id TEXT,
            announce_message_id TEXT,
            status TEXT NOT NULL DEFAULT 'ANNOUNCED',
            winner_team TEXT,
            announced_by TEXT,
            announced_at INTEGER NOT NULL,
            settled_at INTEGER,
            UNIQUE(guild_id, fixture_key)
        );

        CREATE TABLE IF NOT EXISTS ipl_prediction_entries (
            match_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            predicted_team TEXT NOT NULL,
            predicted_at INTEGER NOT NULL,
            PRIMARY KEY (match_id, user_id),
            FOREIGN KEY (match_id) REFERENCES ipl_prediction_matches(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS ipl_prediction_panels (
            match_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            prompt_message_id TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (match_id, user_id),
            FOREIGN KEY (match_id) REFERENCES ipl_prediction_matches(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS ipl_top4_entries (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            slot_1_team TEXT NOT NULL,
            slot_2_team TEXT NOT NULL,
            slot_3_team TEXT NOT NULL,
            slot_4_team TEXT NOT NULL,
            submitted_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS ipl_top4_results (
            guild_id TEXT PRIMARY KEY,
            slot_1_team TEXT NOT NULL,
            slot_2_team TEXT NOT NULL,
            slot_3_team TEXT NOT NULL,
            slot_4_team TEXT NOT NULL,
            settled_by TEXT NOT NULL,
            settled_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS command_usage_stats (
            guild_id TEXT NOT NULL,
            command_name TEXT NOT NULL,
            usage_count INTEGER NOT NULL DEFAULT 0,
            first_used_at INTEGER NOT NULL,
            last_used_at INTEGER NOT NULL,
            PRIMARY KEY (guild_id, command_name)
        );

        CREATE TABLE IF NOT EXISTS admin_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            command_name TEXT NOT NULL,
            summary TEXT NOT NULL,
            target_summary TEXT,
            channel_id TEXT,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS support_server_configs (
            guild_id TEXT PRIMARY KEY,
            role_ids_json TEXT NOT NULL DEFAULT '{}',
            channel_ids_json TEXT NOT NULL DEFAULT '{}',
            panel_message_ids_json TEXT NOT NULL DEFAULT '{}',
            log_channel_ids_json TEXT NOT NULL DEFAULT '{}',
            misc_json TEXT NOT NULL DEFAULT '{}',
            ticket_counter INTEGER NOT NULL DEFAULT 0,
            suggestion_counter INTEGER NOT NULL DEFAULT 0,
            bug_counter INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS support_tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            ticket_number INTEGER NOT NULL,
            channel_id TEXT UNIQUE,
            opener_id TEXT NOT NULL,
            ticket_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'OPEN',
            priority TEXT NOT NULL DEFAULT 'medium',
            subject TEXT NOT NULL,
            details_text TEXT NOT NULL,
            claimed_by TEXT,
            request_status TEXT,
            internal_notes TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            closed_at INTEGER,
            closed_by TEXT,
            transcript_message_id TEXT,
            UNIQUE(guild_id, ticket_number)
        );

        CREATE TABLE IF NOT EXISTS support_ticket_members (
            ticket_id INTEGER NOT NULL,
            user_id TEXT NOT NULL,
            added_by TEXT,
            added_at INTEGER NOT NULL,
            PRIMARY KEY (ticket_id, user_id),
            FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS support_suggestions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            suggestion_number INTEGER NOT NULL,
            author_id TEXT NOT NULL,
            channel_id TEXT,
            message_id TEXT,
            content TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            note_text TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(guild_id, suggestion_number)
        );

        CREATE TABLE IF NOT EXISTS support_bug_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            bug_number INTEGER NOT NULL,
            author_id TEXT NOT NULL,
            channel_id TEXT,
            message_id TEXT,
            title TEXT NOT NULL,
            description_text TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            severity TEXT NOT NULL DEFAULT 'medium',
            note_text TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(guild_id, bug_number)
        );

        CREATE TABLE IF NOT EXISTS support_warnings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            moderator_id TEXT NOT NULL,
            reason_text TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS hc_cricket_saved_embeds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            source_channel_id TEXT NOT NULL,
            source_message_id TEXT NOT NULL,
            source_author_id TEXT NOT NULL,
            embed_index INTEGER NOT NULL DEFAULT 0,
            embed_title TEXT,
            embed_description TEXT,
            note_text TEXT,
            embed_json TEXT NOT NULL,
            source_created_at INTEGER NOT NULL,
            saved_by TEXT NOT NULL,
            saved_at INTEGER NOT NULL,
            UNIQUE(guild_id, source_message_id, embed_index)
        );

        CREATE TABLE IF NOT EXISTS hc_analysis_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            started_by TEXT NOT NULL,
            note_text TEXT,
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            started_at INTEGER NOT NULL,
            ended_at INTEGER,
            UNIQUE(guild_id, channel_id, status)
        );

        CREATE TABLE IF NOT EXISTS hc_analysis_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            source_message_id TEXT NOT NULL,
            source_author_id TEXT NOT NULL,
            content_text TEXT,
            embed_count INTEGER NOT NULL DEFAULT 0,
            payload_json TEXT NOT NULL,
            source_created_at INTEGER NOT NULL,
            captured_at INTEGER NOT NULL,
            UNIQUE(session_id, source_message_id),
            FOREIGN KEY (session_id) REFERENCES hc_analysis_sessions(id)
        );

        CREATE TABLE IF NOT EXISTS hc_auto_matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'ACTIVE',
            started_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            ended_at INTEGER,
            finalized_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS hc_auto_message_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER NOT NULL,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            source_message_id TEXT NOT NULL,
            source_author_id TEXT NOT NULL,
            content_text TEXT,
            embed_count INTEGER NOT NULL DEFAULT 0,
            payload_json TEXT NOT NULL,
            payload_hash TEXT NOT NULL,
            source_created_at INTEGER NOT NULL,
            observed_at INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            UNIQUE(match_id, source_message_id, payload_hash),
            FOREIGN KEY (match_id) REFERENCES hc_auto_matches(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS hc_matchup_match_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER NOT NULL,
            guild_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            batter_norm TEXT NOT NULL,
            bowler_norm TEXT NOT NULL,
            batter_display_name TEXT NOT NULL,
            bowler_display_name TEXT NOT NULL,
            runs INTEGER NOT NULL DEFAULT 0,
            balls INTEGER NOT NULL DEFAULT 0,
            dismissals INTEGER NOT NULL DEFAULT 0,
            matches INTEGER NOT NULL DEFAULT 1,
            faced_matches INTEGER NOT NULL DEFAULT 0,
            innings_faced INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            UNIQUE(match_id, batter_norm, bowler_norm),
            FOREIGN KEY (match_id) REFERENCES hc_auto_matches(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS hc_global_matchups (
            batter_norm TEXT NOT NULL,
            bowler_norm TEXT NOT NULL,
            batter_display_name TEXT NOT NULL,
            bowler_display_name TEXT NOT NULL,
            runs INTEGER NOT NULL DEFAULT 0,
            balls INTEGER NOT NULL DEFAULT 0,
            dismissals INTEGER NOT NULL DEFAULT 0,
            matches INTEGER NOT NULL DEFAULT 0,
            faced_matches INTEGER NOT NULL DEFAULT 0,
            innings_faced INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (batter_norm, bowler_norm)
        );

        CREATE TABLE IF NOT EXISTS role_captains (
            guild_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            captain_id TEXT NOT NULL,
            PRIMARY KEY (guild_id, role_id)
        );

        CREATE TABLE IF NOT EXISTS stats_seasons (
            guild_id TEXT NOT NULL,
            season_name TEXT NOT NULL,
            is_active INTEGER DEFAULT 0,
            season_num INTEGER,
            layout_size INTEGER,
            format_type TEXT,
            group_limit TEXT,
            PRIMARY KEY (guild_id, season_name)
        );

        CREATE TABLE IF NOT EXISTS stats_matches (
            match_id TEXT NOT NULL,
            guild_id TEXT NOT NULL,
            season_name TEXT NOT NULL,
            user_id TEXT NOT NULL,
            runs INTEGER DEFAULT 0,
            balls_played INTEGER DEFAULT 0,
            runs_conceded INTEGER DEFAULT 0,
            balls_bowled INTEGER DEFAULT 0,
            wickets INTEGER DEFAULT 0,
            not_out INTEGER DEFAULT 0,
            match_mvp REAL DEFAULT 0,
            timestamp INTEGER NOT NULL,
            message_id TEXT NOT NULL,
            PRIMARY KEY (match_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS stats_match_context (
            guild_id TEXT NOT NULL,
            match_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            season_name TEXT NOT NULL,
            source_message_id TEXT NOT NULL,
            source_channel_id TEXT,
            match_timestamp INTEGER NOT NULL,
            team_id INTEGER,
            opponent_team_id INTEGER,
            team_name_snapshot TEXT,
            opponent_name_snapshot TEXT,
            fixture_day_number TEXT,
            PRIMARY KEY (guild_id, match_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS stats_players (
            guild_id TEXT NOT NULL,
            season_name TEXT NOT NULL,
            user_id TEXT NOT NULL,
            runs INTEGER DEFAULT 0,
            balls_played INTEGER DEFAULT 0,
            runs_conceded INTEGER DEFAULT 0,
            balls_bowled INTEGER DEFAULT 0,
            wickets INTEGER DEFAULT 0,
            not_out_count INTEGER DEFAULT 0,
            innings_bat INTEGER DEFAULT 0,
            innings_bowl INTEGER DEFAULT 0,
            matches_played INTEGER DEFAULT 0,
            thirties INTEGER DEFAULT 0,
            fifties INTEGER DEFAULT 0,
            hundreds INTEGER DEFAULT 0,
            ducks INTEGER DEFAULT 0,
            highscore INTEGER DEFAULT 0,
            best_bowling_runs INTEGER DEFAULT 0,
            best_bowling_wkts INTEGER DEFAULT 0,
            three_fer INTEGER DEFAULT 0,
            five_fer INTEGER DEFAULT 0,
            total_mvp REAL DEFAULT 0,
            runs_1_5 INTEGER DEFAULT 0,
            runs_6_9 INTEGER DEFAULT 0,
            low_sr_60 INTEGER DEFAULT 0,
            low_sr_80 INTEGER DEFAULT 0,
            zero_wkts_2overs INTEGER DEFAULT 0,
            high_eco_18 INTEGER DEFAULT 0,
            high_eco_16 INTEGER DEFAULT 0,
            PRIMARY KEY (guild_id, season_name, user_id)
        );

        CREATE TABLE IF NOT EXISTS role_pingers (
            guild_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            pinger_id TEXT NOT NULL,
            command_name TEXT NOT NULL,
            PRIMARY KEY (guild_id, command_name)
        );

        CREATE TABLE IF NOT EXISTS team_captains (
            guild_id TEXT NOT NULL,
            team_id INTEGER NOT NULL,
            captain_discord_id TEXT NOT NULL,
            PRIMARY KEY (guild_id, team_id),
            FOREIGN KEY (guild_id, team_id) REFERENCES teams(guild_id, team_id)
        );

        CREATE TABLE IF NOT EXISTS team_vice_captains (
            guild_id TEXT NOT NULL,
            team_id INTEGER NOT NULL,
            vice_captain_discord_id TEXT NOT NULL,
            PRIMARY KEY (guild_id, team_id),
            FOREIGN KEY (guild_id, team_id) REFERENCES teams(guild_id, team_id)
        );

        CREATE TABLE IF NOT EXISTS match_reservations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            season_name TEXT,
            team_a_id INTEGER NOT NULL,
            team_b_id INTEGER NOT NULL,
            reserved_by_captain_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING',
            scheduled_time INTEGER,
            created_at INTEGER NOT NULL,
            agreement_time TEXT,
            stadium_channel_id TEXT,
            fixture_day_number TEXT,
            reserve_day_number INTEGER,
            reserve_team_id INTEGER,
            FOREIGN KEY (team_a_id) REFERENCES teams(team_id),
            FOREIGN KEY (team_b_id) REFERENCES teams(team_id)
        );

        CREATE TABLE IF NOT EXISTS reserve_limits (
            guild_id TEXT PRIMARY KEY,
            limit_count INTEGER NOT NULL DEFAULT 2
        );

        CREATE TABLE IF NOT EXISTS playoff_matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            season INTEGER NOT NULL,
            stage TEXT NOT NULL,
            team_a TEXT NOT NULL,
            score_a TEXT,
            team_b TEXT NOT NULL,
            score_b TEXT,
            winner TEXT,
            match_number INTEGER,
            timestamp INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pt_settings (
            guild_id TEXT PRIMARY KEY,
            current_season INTEGER DEFAULT 1,
            layout_size INTEGER DEFAULT 6,
            format_type TEXT DEFAULT 'LEAGUE',
            group_limit TEXT DEFAULT 'A'
        );

        CREATE TABLE IF NOT EXISTS pt_team_aliases (
            guild_id TEXT NOT NULL,
            full_name TEXT NOT NULL,
            alias TEXT NOT NULL,
            PRIMARY KEY (guild_id, alias)
        );

        CREATE TABLE IF NOT EXISTS pt_matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            season INTEGER NOT NULL,
            team_a TEXT NOT NULL,
            score_a_runs INTEGER NOT NULL,
            score_a_wickets INTEGER NOT NULL,
            team_b TEXT NOT NULL,
            score_b_runs INTEGER NOT NULL,
            score_b_wickets INTEGER NOT NULL,
            winner TEXT,
            timestamp INTEGER NOT NULL,
            match_number INTEGER DEFAULT 0,
            group_letter TEXT DEFAULT 'LEAGUE'
        );

        CREATE TABLE IF NOT EXISTS fixture_settings (
            guild_id TEXT PRIMARY KEY,
            min_players TEXT DEFAULT '6v6',
            max_players TEXT DEFAULT '9v9',
            max_reserve INTEGER DEFAULT 2,
            rep_rules TEXT DEFAULT '3 Rep max ; 1 rep = 30 runs , 2 rep = 25 runs , 3 rep = 20 runs',
            match_format TEXT DEFAULT '20 Overs Elite with catch',
            deadline TEXT,
            title_text TEXT DEFAULT 'Cinematic Showdown',
            sponsor_text TEXT,
            max_matches_per_day INTEGER DEFAULT 1,
            auto_announce_time TEXT,
            auto_announce_enabled INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS team_reservations (
            guild_id TEXT NOT NULL,
            season_name TEXT NOT NULL,
            team_id INTEGER NOT NULL,
            used_count INTEGER DEFAULT 0,
            PRIMARY KEY (guild_id, season_name, team_id)
        );

        CREATE TABLE IF NOT EXISTS team_join_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            team_id INTEGER NOT NULL,
            requester_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING',
            note TEXT,
            created_at INTEGER NOT NULL,
            responder_id TEXT,
            responded_at INTEGER,
            FOREIGN KEY (team_id) REFERENCES teams(team_id)
        );

        CREATE TABLE IF NOT EXISTS team_stadiums (
            guild_id TEXT NOT NULL,
            team_id INTEGER NOT NULL,
            channel_id TEXT NOT NULL,
            rename_count INTEGER DEFAULT 0,
            PRIMARY KEY (guild_id, team_id)
        );

        CREATE TABLE IF NOT EXISTS generated_fixtures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            season_name TEXT NOT NULL,
            day_number INTEGER NOT NULL,
            team_a_id INTEGER NOT NULL,
            team_b_id INTEGER NOT NULL,
            stadium_id TEXT,
            status TEXT DEFAULT 'PENDING',
            group_letter TEXT DEFAULT 'LEAGUE'
        );

        CREATE TABLE IF NOT EXISTS team_groups (
            guild_id TEXT NOT NULL,
            season_name TEXT NOT NULL,
            team_id INTEGER NOT NULL,
            group_letter TEXT NOT NULL,
            PRIMARY KEY (guild_id, season_name, team_id)
        );

        CREATE TABLE IF NOT EXISTS fixture_setup_state (
            guild_id TEXT PRIMARY KEY,
            step TEXT NOT NULL,
            data TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS public_pings (
            guild_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            alias TEXT,
            cooldown_seconds INTEGER DEFAULT 3600,
            last_ping_timestamp INTEGER DEFAULT 0,
            restricted_channel_id TEXT,
            PRIMARY KEY (guild_id, role_id)
        );

        CREATE TABLE IF NOT EXISTS trade_settings (
            guild_id TEXT PRIMARY KEY,
            is_open INTEGER DEFAULT 0,
            log_channel_id TEXT
        );

        CREATE TABLE IF NOT EXISTS global_managers (
            user_id TEXT PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS disabled_global_manager_servers (
            guild_id TEXT PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS global_log_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            channel_id TEXT
        );

        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            initiator_id TEXT NOT NULL,
            target_owner_id TEXT NOT NULL,
            player_a_id INTEGER NOT NULL,
            player_b_id INTEGER NOT NULL,
            status TEXT DEFAULT 'PENDING', -- PENDING, ACCEPTED, APPROVED, REJECTED
            created_at INTEGER
        );
    `);

    // Migration for existing databases
    try {
        await db.exec('ALTER TABLE pt_matches ADD COLUMN match_number INTEGER DEFAULT 0');
        console.log('Migrated pt_matches table: Added match_number');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (pt_matches match_number): ' + e.message);
        }
    }
    try {
        await db.exec("ALTER TABLE pt_matches ADD COLUMN group_letter TEXT DEFAULT 'LEAGUE'");
        console.log('Migrated pt_matches table: Added group_letter');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (pt_matches group_letter): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE stats_players ADD COLUMN thirties INTEGER DEFAULT 0');
        console.log('Migrated stats_players table: Added thirties');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (thirties): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE stats_players ADD COLUMN runs_1_5 INTEGER DEFAULT 0');
        await db.exec('ALTER TABLE stats_players ADD COLUMN runs_6_9 INTEGER DEFAULT 0');
        await db.exec('ALTER TABLE stats_players ADD COLUMN low_sr_60 INTEGER DEFAULT 0');
        await db.exec('ALTER TABLE stats_players ADD COLUMN low_sr_80 INTEGER DEFAULT 0');
        await db.exec('ALTER TABLE stats_players ADD COLUMN zero_wkts_2overs INTEGER DEFAULT 0');
        await db.exec('ALTER TABLE stats_players ADD COLUMN high_eco_18 INTEGER DEFAULT 0');
        await db.exec('ALTER TABLE stats_players ADD COLUMN high_eco_16 INTEGER DEFAULT 0');
        console.log('Migrated stats_players table: Added impact tracking columns');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (impact columns): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE teams ADD COLUMN max_roster_size INTEGER NOT NULL DEFAULT 15');
        console.log('Migrated teams table: Added max_roster_size');
    }
    catch (e) {
        // Ignore error if column already exists
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check: ' + e.message);
        }
    }

    try {
        await db.exec("ALTER TABLE scheduled_messages ADD COLUMN target_type TEXT DEFAULT 'ROLE'");
        console.log('Migrated scheduled_messages table: Added target_type');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check: ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE public_pings ADD COLUMN restricted_channel_id TEXT');
        console.log('Migrated public_pings table: Added restricted_channel_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check: ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN fixture_announcement_channel_id TEXT');
        console.log('Migrated guild_settings table: Added fixture_announcement_channel_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (fixture_announcement_channel_id): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN sales_log_channel_id TEXT');
        console.log('Migrated guild_settings table: Added sales_log_channel_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check: ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN stadium_channel_id TEXT');
        console.log('Migrated guild_settings table: Added stadium_channel_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (stadium_channel_id): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN ping_restricted_channel_id TEXT');
        console.log('Migrated guild_settings table: Added ping_restricted_channel_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (ping_restricted_channel_id): ' + e.message);
        }
    }

    // Migration for stats_matches primary key fix
    try {
        const tableInfo = await db.all("PRAGMA table_info(stats_matches)");
        const pkCount = tableInfo.filter(c => c.pk > 0).length;
        if (pkCount === 1) {
            console.log('Migrating stats_matches table to composite primary key...');
            let transactionActive = false;
            try {
                await db.run('BEGIN TRANSACTION');
                transactionActive = true;
                await db.run('CREATE TABLE stats_matches_new AS SELECT * FROM stats_matches');
                await db.run('DROP TABLE stats_matches');
                await db.run(`
                    CREATE TABLE stats_matches (
                        match_id TEXT NOT NULL,
                        guild_id TEXT NOT NULL,
                        season_name TEXT NOT NULL,
                        user_id TEXT NOT NULL,
                        runs INTEGER DEFAULT 0,
                        balls_played INTEGER DEFAULT 0,
                        runs_conceded INTEGER DEFAULT 0,
                        balls_bowled INTEGER DEFAULT 0,
                        wickets INTEGER DEFAULT 0,
                        not_out INTEGER DEFAULT 0,
                        match_mvp REAL DEFAULT 0,
                        timestamp INTEGER NOT NULL,
                        message_id TEXT NOT NULL,
                        match_number INTEGER DEFAULT 0,
                        PRIMARY KEY (match_id, user_id)
                    )
                `);
                await db.run('INSERT INTO stats_matches SELECT *, 0 FROM stats_matches_new');
                await db.run('DROP TABLE stats_matches_new');
                await db.run('COMMIT');
                transactionActive = false;
                console.log('Successfully migrated stats_matches table.');
            } catch (err) {
                if (transactionActive) await db.run('ROLLBACK');
                throw err;
            }
        }
    } catch (e) {
        console.error('Migration error (stats_matches):', e.message);
    }

    try {
        await db.exec('ALTER TABLE stats_matches ADD COLUMN match_number INTEGER DEFAULT 0');
        console.log('Migrated stats_matches table: Added match_number');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (match_number): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE match_reservations ADD COLUMN stadium_channel_id TEXT');
        console.log('Migrated match_reservations table: Added stadium_channel_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (match_reservations stadium_channel_id): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE team_stadiums ADD COLUMN rename_count INTEGER DEFAULT 0');
        console.log('Migrated team_stadiums table: Added rename_count');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (team_stadiums rename_count): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE fixture_settings ADD COLUMN auto_announce_time TEXT');
        console.log('Migrated fixture_settings table: Added auto_announce_time');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (fixture_settings auto_announce_time): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE fixture_settings ADD COLUMN auto_announce_enabled INTEGER DEFAULT 0');
        console.log('Migrated fixture_settings table: Added auto_announce_enabled');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (fixture_settings auto_announce_enabled): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE fixture_settings ADD COLUMN sponsor_text TEXT');
        console.log('Migrated fixture_settings table: Added sponsor_text');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (fixture_settings sponsor_text): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN schedule_season TEXT');
        console.log('Migrated guild_settings table: Added schedule_season');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (guild_settings.schedule_season): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE match_reservations ADD COLUMN season_name TEXT');
        console.log('Migrated match_reservations table: Added season_name');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (match_reservations.season_name): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE stats_players ADD COLUMN highscore_not_out INTEGER DEFAULT 0');
        console.log('Migrated stats_players table: Added highscore_not_out');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (highscore_not_out): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE teams ADD COLUMN role_id TEXT');
        console.log('Migrated teams table: Added role_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (teams role_id): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE teams ADD COLUMN name_change_count INTEGER NOT NULL DEFAULT 0');
        console.log('Migrated teams table: Added name_change_count');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (teams name_change_count): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE public_pings ADD COLUMN alias TEXT');
        console.log('Migrated public_pings table: Added alias column');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (public_pings alias): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN auction_stats_season TEXT');
        console.log('Migrated guild_settings table: Added auction_stats_season');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (auction_stats_season): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN auction_bid_timer_seconds INTEGER DEFAULT 15');
        console.log('Migrated guild_settings table: Added auction_bid_timer_seconds');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (auction_bid_timer_seconds): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN auction_call_timer_seconds INTEGER DEFAULT 2');
        console.log('Migrated guild_settings table: Added auction_call_timer_seconds');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (auction_call_timer_seconds): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN team_name_change_limit INTEGER DEFAULT 3');
        console.log('Migrated guild_settings table: Added team_name_change_limit');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (team_name_change_limit): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN team_rename_window_open INTEGER DEFAULT 1');
        console.log('Migrated guild_settings table: Added team_rename_window_open');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (team_rename_window_open): ' + e.message);
        }
    }

    try {
        await db.run('UPDATE guild_settings SET team_name_change_limit = 3 WHERE team_name_change_limit IS NULL OR team_name_change_limit = 2');
    } catch (e) {
        console.log('Database check (team_name_change_limit default sync): ' + e.message);
    }

    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN team_rename_window_expires_at INTEGER');
        console.log('Migrated guild_settings table: Added team_rename_window_expires_at');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (team_rename_window_expires_at): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN regteam_command_channel_id TEXT');
        console.log('Migrated guild_settings table: Added regteam_command_channel_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (regteam_command_channel_id): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN community_roster_log_channel_id TEXT');
        console.log('Migrated guild_settings table: Added community_roster_log_channel_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (community_roster_log_channel_id): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN admin_audit_log_channel_id TEXT');
        console.log('Migrated guild_settings table: Added admin_audit_log_channel_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (admin_audit_log_channel_id): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN admin_audit_logs_enabled INTEGER DEFAULT 1');
        console.log('Migrated guild_settings table: Added admin_audit_logs_enabled');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (admin_audit_logs_enabled): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN community_player_log_channel_id TEXT');
        console.log('Migrated guild_settings table: Added community_player_log_channel_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (community_player_log_channel_id): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN community_player_logs_enabled INTEGER DEFAULT 1');
        console.log('Migrated guild_settings table: Added community_player_logs_enabled');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (community_player_logs_enabled): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN community_roster_manage_open INTEGER DEFAULT 1');
        console.log('Migrated guild_settings table: Added community_roster_manage_open');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (community_roster_manage_open): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE guild_settings ADD COLUMN community_join_requests_open INTEGER DEFAULT 1');
        console.log('Migrated guild_settings table: Added community_join_requests_open');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (community_join_requests_open): ' + e.message);
        }
    }
    try {
        await db.run(`UPDATE guild_settings
            SET community_player_log_channel_id = community_roster_log_channel_id
            WHERE community_player_log_channel_id IS NULL
              AND community_roster_log_channel_id IS NOT NULL`);
    } catch (e) {
        console.log('Database check (community_player_log_channel_id backfill): ' + e.message);
    }

    try {
        await db.exec('ALTER TABLE potd_settings ADD COLUMN allow_multiple_votes INTEGER NOT NULL DEFAULT 0');
        console.log('Migrated potd_settings table: Added allow_multiple_votes');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (potd_settings allow_multiple_votes): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE potd_settings ADD COLUMN results_channel_id TEXT');
        console.log('Migrated potd_settings table: Added results_channel_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (potd_settings results_channel_id): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE potd_settings ADD COLUMN ping_role_id TEXT');
        console.log('Migrated potd_settings table: Added ping_role_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (potd_settings ping_role_id): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE ipl_prediction_settings ADD COLUMN reminder_role_id TEXT');
        console.log('Migrated ipl_prediction_settings table: Added reminder_role_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (ipl_prediction_settings reminder_role_id): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE ipl_prediction_settings ADD COLUMN announcement_channel_id TEXT');
        console.log('Migrated ipl_prediction_settings table: Added announcement_channel_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (ipl_prediction_settings announcement_channel_id): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE ipl_prediction_settings ADD COLUMN announcement_role_ids_json TEXT');
        console.log('Migrated ipl_prediction_settings table: Added announcement_role_ids_json');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (ipl_prediction_settings announcement_role_ids_json): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE ipl_prediction_settings ADD COLUMN reminder_panel_channel_id TEXT');
        console.log('Migrated ipl_prediction_settings table: Added reminder_panel_channel_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (ipl_prediction_settings reminder_panel_channel_id): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE ipl_prediction_settings ADD COLUMN reminder_panel_message_id TEXT');
        console.log('Migrated ipl_prediction_settings table: Added reminder_panel_message_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (ipl_prediction_settings reminder_panel_message_id): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE potd_polls ADD COLUMN source_window_start_at INTEGER');
        console.log('Migrated potd_polls table: Added source_window_start_at');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (potd_polls source_window_start_at): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE potd_polls ADD COLUMN source_window_end_at INTEGER');
        console.log('Migrated potd_polls table: Added source_window_end_at');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (potd_polls source_window_end_at): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE sets ADD COLUMN set_order INTEGER');
        console.log('Migrated sets table: Added set_order');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (sets set_order): ' + e.message);
        }
    }

    try {
        await db.exec("ALTER TABLE pt_settings ADD COLUMN format_type TEXT DEFAULT 'LEAGUE'");
        console.log('Migrated pt_settings table: Added format_type');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (pt_settings format_type): ' + e.message);
        }
    }

    try {
        await db.exec("ALTER TABLE pt_settings ADD COLUMN group_limit TEXT DEFAULT 'A'");
        console.log('Migrated pt_settings table: Added group_limit');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (pt_settings group_limit): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE fixture_settings ADD COLUMN max_matches_per_day INTEGER DEFAULT 1');
        console.log('Migrated fixture_settings table: Added max_matches_per_day');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (fixture_settings max_matches_per_day): ' + e.message);
        }
    }

    try {
        await db.exec("ALTER TABLE generated_fixtures ADD COLUMN group_letter TEXT DEFAULT 'LEAGUE'");
        console.log('Migrated generated_fixtures table: Added group_letter');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (generated_fixtures group_letter): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE match_reservations ADD COLUMN reserve_day_number INTEGER');
        console.log('Migrated match_reservations table: Added reserve_day_number');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (match_reservations reserve_day_number): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE match_reservations ADD COLUMN fixture_day_number TEXT');
        console.log('Migrated match_reservations table: Added fixture_day_number');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (match_reservations fixture_day_number): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE match_reservations ADD COLUMN reserve_team_id INTEGER');
        console.log('Migrated match_reservations table: Added reserve_team_id');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (match_reservations reserve_team_id): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE stats_seasons ADD COLUMN season_num INTEGER');
        console.log('Migrated stats_seasons table: Added season_num');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (stats_seasons season_num): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE stats_seasons ADD COLUMN layout_size INTEGER');
        console.log('Migrated stats_seasons table: Added layout_size');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (stats_seasons layout_size): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE stats_seasons ADD COLUMN format_type TEXT');
        console.log('Migrated stats_seasons table: Added format_type');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (stats_seasons format_type): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE stats_seasons ADD COLUMN group_limit TEXT');
        console.log('Migrated stats_seasons table: Added group_limit');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (stats_seasons group_limit): ' + e.message);
        }
    }

    try {
        await db.exec('ALTER TABLE hc_cricket_saved_embeds ADD COLUMN note_text TEXT');
        console.log('Migrated hc_cricket_saved_embeds table: Added note_text');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (hc_cricket_saved_embeds note_text): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE hc_auto_matches ADD COLUMN finalized_at INTEGER');
        console.log('Migrated hc_auto_matches table: Added finalized_at');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (hc_auto_matches finalized_at): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE hc_matchup_match_log ADD COLUMN faced_matches INTEGER NOT NULL DEFAULT 0');
        console.log('Migrated hc_matchup_match_log table: Added faced_matches');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (hc_matchup_match_log faced_matches): ' + e.message);
        }
    }
    try {
        await db.exec('ALTER TABLE hc_global_matchups ADD COLUMN faced_matches INTEGER NOT NULL DEFAULT 0');
        console.log('Migrated hc_global_matchups table: Added faced_matches');
    } catch (e) {
        if (!e.message.includes('duplicate column name')) {
            console.log('Database check (hc_global_matchups faced_matches): ' + e.message);
        }
    }

    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_sched_messages_status_time ON scheduled_messages(status, scheduled_time);
        CREATE INDEX IF NOT EXISTS idx_match_res_status_time ON match_reservations(status, scheduled_time);
        CREATE INDEX IF NOT EXISTS idx_stats_players_guild_season ON stats_players(guild_id, season_name);
        CREATE INDEX IF NOT EXISTS idx_auction_players_status_set ON auction_players(guild_id, status, set_name);
        CREATE INDEX IF NOT EXISTS idx_pt_matches_guild_season ON pt_matches(guild_id, season);
        CREATE INDEX IF NOT EXISTS idx_stats_match_context_window ON stats_match_context(guild_id, season_name, match_timestamp);
        CREATE INDEX IF NOT EXISTS idx_potd_polls_status_time ON potd_polls(status, closes_at);
        CREATE INDEX IF NOT EXISTS idx_potd_polls_window_lookup ON potd_polls(guild_id, season_name, label_text, source_window_start_at, source_window_end_at);
        CREATE INDEX IF NOT EXISTS idx_potd_poll_candidates_poll_rank ON potd_poll_candidates(poll_id, option_rank);
        CREATE INDEX IF NOT EXISTS idx_ipl_prediction_matches_guild_status_time ON ipl_prediction_matches(guild_id, status, starts_at);
        CREATE INDEX IF NOT EXISTS idx_ipl_prediction_entries_match_team ON ipl_prediction_entries(match_id, predicted_team);
        CREATE INDEX IF NOT EXISTS idx_ipl_prediction_panels_match_user ON ipl_prediction_panels(match_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_ipl_top4_entries_guild_user ON ipl_top4_entries(guild_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_command_usage_command ON command_usage_stats(command_name, usage_count DESC, last_used_at DESC);
        CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_guild_time ON admin_audit_logs(guild_id, created_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_support_tickets_guild_status ON support_tickets(guild_id, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_support_tickets_channel ON support_tickets(channel_id);
        CREATE INDEX IF NOT EXISTS idx_support_suggestions_guild_status ON support_suggestions(guild_id, status, suggestion_number DESC);
        CREATE INDEX IF NOT EXISTS idx_support_bug_reports_guild_status ON support_bug_reports(guild_id, status, bug_number DESC);
        CREATE INDEX IF NOT EXISTS idx_support_warnings_guild_user ON support_warnings(guild_id, user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sets_guild_order ON sets(guild_id, set_order, set_name);
        CREATE INDEX IF NOT EXISTS idx_hc_auto_matches_guild_channel_status ON hc_auto_matches(guild_id, channel_id, status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_hc_auto_matches_finalized_at ON hc_auto_matches(finalized_at, ended_at);
        CREATE INDEX IF NOT EXISTS idx_hc_auto_message_versions_match_time ON hc_auto_message_versions(match_id, observed_at ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_hc_auto_message_versions_guild_channel ON hc_auto_message_versions(guild_id, channel_id, observed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_hc_matchup_match_log_pair ON hc_matchup_match_log(batter_norm, bowler_norm, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_hc_matchup_match_log_match ON hc_matchup_match_log(match_id);
        CREATE INDEX IF NOT EXISTS idx_hc_global_matchups_updated_at ON hc_global_matchups(updated_at DESC);
    `);

    const guildsNeedingSetOrder = await db.all('SELECT DISTINCT guild_id FROM sets');
    for (const row of guildsNeedingSetOrder) {
        const sets = await db.all('SELECT set_name, set_order FROM sets WHERE guild_id = ? ORDER BY CASE WHEN set_order IS NULL THEN 1 ELSE 0 END, set_order ASC, set_name ASC', row.guild_id);
        let needsUpdate = false;
        for (let i = 0; i < sets.length; i++) {
            if (sets[i].set_order !== i + 1) {
                needsUpdate = true;
                break;
            }
        }
        if (!needsUpdate)
            continue;
        let transactionActive = false;
        try {
            await db.run('BEGIN TRANSACTION');
            transactionActive = true;
            for (let i = 0; i < sets.length; i++) {
                await db.run('UPDATE sets SET set_order = ? WHERE guild_id = ? AND set_name = ?', i + 1, row.guild_id, sets[i].set_name);
            }
            await db.run('COMMIT');
            transactionActive = false;
        } catch (err) {
            if (transactionActive)
                await db.run('ROLLBACK');
            throw err;
        }
    }

    console.log('Database v2 initialized with Multi-Server support.');
}
function getDB() {
    if (!db) {
        throw new Error('Database not initialized!');
    }
    return db;
}
function getDBKind() {
    return dbKind;
}
