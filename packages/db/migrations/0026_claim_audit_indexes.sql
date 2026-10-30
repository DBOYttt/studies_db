CREATE INDEX `idx_admin_audit_action` ON `admin_audit` (`action`,`id`);--> statement-breakpoint
CREATE INDEX `idx_bot_requests_status_kind_id` ON `bot_requests` (`status`,`kind`,`id`);