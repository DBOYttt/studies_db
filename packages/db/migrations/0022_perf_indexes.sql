CREATE INDEX `idx_admin_audit_target` ON `admin_audit` (`target`,`action`,`id`);--> statement-breakpoint
CREATE INDEX `idx_bot_requests_kind_target` ON `bot_requests` (`kind`,`target`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `idx_materials_recent` ON `materials` (`deleted_at`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_materials_status` ON `materials` (`status`);