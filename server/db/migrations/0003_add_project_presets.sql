-- 添加项目预设字段：风格和视频比例
ALTER TABLE `projects` ADD `style_id` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `projects` ADD `aspect_ratio` text NOT NULL DEFAULT '16:9';
