PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_video_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`scene_id` text,
	`status` text DEFAULT 'pending',
	`progress` integer DEFAULT 0,
	`config` text,
	`video_data` text,
	`audio_data` text,
	`metadata` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_video_tasks`("id", "scene_id", "status", "progress", "config", "video_data", "audio_data", "metadata", "error", "created_at", "updated_at") SELECT "id", "scene_id", "status", "progress", "config", "video_data", "audio_data", "metadata", "error", "created_at", "updated_at" FROM `video_tasks`;--> statement-breakpoint
DROP TABLE `video_tasks`;--> statement-breakpoint
ALTER TABLE `__new_video_tasks` RENAME TO `video_tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `scenes` ADD `video_url` text;