      CREATE TABLE IF NOT EXISTS douyin_history (
        id TEXT PRIMARY KEY,
        aweme_id TEXT NOT NULL UNIQUE,
        real_url TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        cover_url TEXT NOT NULL DEFAULT '',
        video_url TEXT NOT NULL DEFAULT '',
        media_type TEXT NOT NULL DEFAULT 'video',
        image_urls_json TEXT NOT NULL DEFAULT '[]',
        downloaded_path TEXT,
        downloaded_filename TEXT,
        download_dir TEXT,
        size_bytes INTEGER,
        parsed_at TEXT NOT NULL,
        downloaded_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS xiaohongshu_history (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL UNIQUE,
        source_url TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '',
        author_icon TEXT NOT NULL DEFAULT '',
        create_time INTEGER,
        cover_url TEXT NOT NULL DEFAULT '',
        image_urls_json TEXT NOT NULL DEFAULT '[]',
        downloaded_path TEXT,
        downloaded_filename TEXT,
        download_dir TEXT,
        size_bytes INTEGER,
        parsed_at TEXT NOT NULL,
        downloaded_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wx_channels_history (
        id TEXT PRIMARY KEY,
        share_url TEXT NOT NULL UNIQUE,
        author TEXT NOT NULL DEFAULT '',
        author_icon TEXT NOT NULL DEFAULT '',
        cover_url TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        video_url TEXT NOT NULL DEFAULT '',
        origin_video_url TEXT NOT NULL DEFAULT '',
        create_time INTEGER,
        downloaded_path TEXT,
        downloaded_filename TEXT,
        download_dir TEXT,
        size_bytes INTEGER,
        parsed_at TEXT NOT NULL,
        downloaded_at TEXT,
        updated_at TEXT NOT NULL
      );
