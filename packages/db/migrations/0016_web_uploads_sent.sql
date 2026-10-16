ALTER TABLE `web_uploads` ADD `sent_message_id` varchar(32);--> statement-breakpoint
ALTER TABLE `web_uploads` ADD `sent_attachment_id` varchar(32);--> statement-breakpoint
ALTER TABLE `web_uploads` ADD `sent_url` varchar(1000);--> statement-breakpoint
ALTER TABLE `web_uploads` ADD `sent_content_type` varchar(150);--> statement-breakpoint
ALTER TABLE `web_uploads` ADD `sent_at` datetime;