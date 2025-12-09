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
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'draft',
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
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
	`first_frame` text,
	`last_frame` text,
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
	`updated_at` text NOT NULL,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade
);
