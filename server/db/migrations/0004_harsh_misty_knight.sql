CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`role` text,
	`appearance` text NOT NULL,
	`personality` text,
	`age` integer,
	`gender` text,
	`base_image` text,
	`expressions` text,
	`views` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `generated_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`scene_id` text,
	`task_id` text,
	`video_path` text,
	`audio_path` text,
	`duration` real,
	`resolution` text,
	`aspect_ratio` text,
	`fps` integer DEFAULT 24,
	`has_audio` integer DEFAULT true,
	`file_size` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `video_tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`script_id` text,
	`order_index` integer NOT NULL,
	`title` text,
	`description` text NOT NULL,
	`setting` text,
	`characters` text,
	`dialogues` text,
	`duration` integer DEFAULT 8,
	`narration` text,
	`shot_type` text,
	`camera_movement` text,
	`camera_note` text,
	`transition_in` text,
	`transition_out` text,
	`transition_duration` real,
	`first_frame` text,
	`last_frame` text,
	`video_url` text,
	`storyboard` text,
	`scene_visual` text,
	`status` text DEFAULT 'pending',
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`script_id`) REFERENCES `scripts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scripts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`title` text,
	`raw_text` text NOT NULL,
	`parsed_data` text,
	`total_duration` integer DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `system_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `video_tasks` (
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
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`style_id` text NOT NULL,
	`aspect_ratio` text DEFAULT '16:9' NOT NULL,
	`status` text DEFAULT 'draft',
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "name", "description", "style_id", "aspect_ratio", "status", "created_at", "updated_at") SELECT "id", "name", "description", "style_id", "aspect_ratio", "status", "created_at", "updated_at" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
PRAGMA foreign_keys=ON;