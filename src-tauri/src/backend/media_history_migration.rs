use super::*;

/// Copy old history once. Keep the original tables/data for rollback, but never
/// query them during normal operation or recreate deleted unified records.
pub(super) fn migrate(conn: &Connection) -> Result<(), ApiError> {
    let run = || -> rusqlite::Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS media_parser_migrations (name TEXT PRIMARY KEY);",
        )?;
        let tx =
            rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)?;
        let migrated = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM media_parser_migrations WHERE name='legacy-history-v1')",
            [],
            |row| row.get::<_, bool>(0),
        )?;
        if migrated {
            return Ok(());
        }
        for (table, key, platform, source, profile) in [
            (
                "douyin_history",
                "'抖音:' || aweme_id",
                "douyin",
                "real_url",
                DOUYIN_PROFILE,
            ),
            (
                "xiaohongshu_history",
                "'小红书:' || note_id",
                "xiaohongshu",
                "source_url",
                XHS_PROFILE,
            ),
            (
                "wx_channels_history",
                "'视频号:' || share_url",
                "wxChannels",
                "share_url",
                WX_PROFILE,
            ),
        ] {
            let exists = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                params![table],
                |row| row.get::<_, bool>(0),
            )?;
            if !exists {
                continue;
            }
            if table == "douyin_history" {
                let mut stmt = tx.prepare("PRAGMA table_info(douyin_history)")?;
                let columns = stmt
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<Result<Vec<_>, _>>()?;
                for (name, definition) in [
                    ("media_type", "TEXT NOT NULL DEFAULT 'video'"),
                    ("image_urls_json", "TEXT NOT NULL DEFAULT '[]'"),
                ] {
                    if !columns.iter().any(|column| column == name) {
                        tx.execute_batch(&format!(
                            "ALTER TABLE douyin_history ADD COLUMN {name} {definition};"
                        ))?;
                    }
                }
            }
            // All interpolated identifiers/expressions are fixed constants above.
            tx.execute_batch(&format!("INSERT OR IGNORE INTO media_parser_history
                (id,item_key,platform,source_url,profile_json,downloaded_path,downloaded_filename,download_dir,size_bytes,parsed_at,downloaded_at,updated_at)
                SELECT id,{key},'{platform}',{source},{profile},downloaded_path,downloaded_filename,download_dir,size_bytes,parsed_at,downloaded_at,updated_at FROM {table};"))?;
        }
        tx.execute(
            "INSERT INTO media_parser_migrations(name) VALUES ('legacy-history-v1')",
            [],
        )?;
        tx.commit()
    };
    run().map_err(|error| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("迁移媒体解析历史失败: {error}"),
        )
    })
}

const DOUYIN_PROFILE: &str = "json_object(
    'historyId',id,'platform','douyin','platformName','抖音','mediaId',aweme_id,
    'title',title,'sourceUrl',real_url,'coverUrl',cover_url,'videoUrl',video_url,'mediaType',media_type,
    'imageUrls',json(CASE WHEN json_valid(image_urls_json) THEN image_urls_json ELSE '[]' END),
    'videoUrls',json(CASE WHEN video_url != '' THEN json_array(video_url) ELSE '[]' END))";
const XHS_PROFILE: &str = "json_object(
    'historyId',id,'platform','xiaohongshu','platformName','小红书','mediaId',note_id,
    'title',title,'description',description,'sourceUrl',source_url,'coverUrl',cover_url,
    'videoUrl','','mediaType','image','imageUrls',json(CASE WHEN json_valid(image_urls_json) THEN image_urls_json ELSE '[]' END),
    'videoUrls',json('[]'),'author',author,'authorIcon',author_icon,'createTime',create_time)";
const WX_PROFILE: &str = "json_object(
    'historyId',id,'platform','wxChannels','platformName','视频号','mediaId','',
    'title',description,'description',description,'sourceUrl',share_url,'coverUrl',cover_url,
    'videoUrl',CASE WHEN trim(origin_video_url) != '' THEN origin_video_url ELSE video_url END,
    'mediaType','video','imageUrls',json('[]'),
    'videoUrls',json_array(CASE WHEN trim(origin_video_url) != '' THEN origin_video_url ELSE video_url END),
    'author',author,'authorIcon',author_icon,'createTime',create_time)";

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(super::super::media_tools::HISTORY_SCHEMA)
            .unwrap();
        conn.execute_batch(include_str!("fixtures/media-history-legacy.sql"))
            .unwrap();
        conn.execute_batch("INSERT INTO douyin_history (id,aweme_id,real_url,title,downloaded_path,parsed_at,updated_at)
            VALUES ('dy_old','123','https://v.douyin.com/old','旧抖音','/downloads/old.mp4','2026-01-01','2026-01-02');
            INSERT INTO xiaohongshu_history (id,note_id,source_url,title,image_urls_json,parsed_at,updated_at)
            VALUES ('xhs_old','456','https://xhslink.com/old','旧小红书','invalid-json','2026-01-01','2026-01-03');
            INSERT INTO wx_channels_history (id,share_url,description,video_url,origin_video_url,parsed_at,updated_at)
            VALUES ('wx_old','https://weixin.qq.com/sph/old','旧视频号','https://cdn/encoded','https://cdn/original.mp4','2026-01-01','2026-01-04');").unwrap();
        conn
    }

    #[test]
    fn migrates_all_legacy_histories_once_without_losing_downloads() {
        let conn = database();
        // Older Douyin databases predate image support.
        conn.execute_batch(
            "ALTER TABLE douyin_history DROP COLUMN media_type;
            ALTER TABLE douyin_history DROP COLUMN image_urls_json;",
        )
        .unwrap();
        migrate(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM media_parser_history", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 3);
        let path: String = conn
            .query_row(
                "SELECT downloaded_path FROM media_parser_history WHERE id='dy_old'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(path, "/downloads/old.mp4");
        let raw: String = conn
            .query_row(
                "SELECT profile_json FROM media_parser_history WHERE id='wx_old'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let profile: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(profile["videoUrl"], "https://cdn/original.mp4");
        assert_eq!(profile["platformName"], "视频号");
        let raw: String = conn
            .query_row(
                "SELECT profile_json FROM media_parser_history WHERE id='xhs_old'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&raw).unwrap()["imageUrls"],
            json!([])
        );
        conn.execute("DELETE FROM media_parser_history WHERE id='wx_old'", [])
            .unwrap();
        migrate(&conn).unwrap();
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM media_parser_history", [], |row| row
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            2
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM wx_channels_history", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn migration_keeps_newer_unified_records_and_rolls_back_failures() {
        let conn = database();
        conn.execute("INSERT INTO media_parser_history(id,item_key,platform,source_url,profile_json,parsed_at,updated_at)
            VALUES ('new','抖音:123','douyin','https://v.douyin.com/new','{}','new','new')",[]).unwrap();
        migrate(&conn).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT source_url FROM media_parser_history WHERE item_key='抖音:123'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "https://v.douyin.com/new"
        );

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(super::super::media_tools::HISTORY_SCHEMA)
            .unwrap();
        conn.execute_batch("CREATE TABLE wx_channels_history (id TEXT);")
            .unwrap();
        assert!(migrate(&conn).is_err());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM media_parser_migrations", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );
        conn.execute_batch("DROP TABLE wx_channels_history;")
            .unwrap();
        migrate(&conn).unwrap();
    }
}
