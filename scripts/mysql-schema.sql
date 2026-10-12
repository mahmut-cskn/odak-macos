CREATE TABLE IF NOT EXISTS odak_tasks (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  kind VARCHAR(32) NULL,
  title TEXT NOT NULL,
  label VARCHAR(255) NOT NULL,
  color VARCHAR(32) NOT NULL,
  notes LONGTEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  completed_at BIGINT NULL,
  estimate_min INT UNSIGNED NULL,
  scheduled_date DATE NULL,
  start_at BIGINT NULL,
  end_at BIGINT NULL,
  due_at BIGINT NULL,
  recurrence_rule JSON NULL,
  series_id VARCHAR(191) NULL,
  subtasks JSON NOT NULL,
  created_at BIGINT NOT NULL,
  priority TINYINT UNSIGNED NULL,
  pomodoro_min INT UNSIGNED NULL,
  payload JSON NOT NULL,
  row_hash CHAR(64) NOT NULL,
  synced_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_odak_tasks_status (status),
  INDEX idx_odak_tasks_scheduled_date (scheduled_date),
  INDEX idx_odak_tasks_series_id (series_id),
  CONSTRAINT chk_odak_tasks_priority
    CHECK (priority IS NULL OR priority BETWEEN 1 AND 5)
);

CREATE TABLE IF NOT EXISTS odak_sessions (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  task_id VARCHAR(191) NULL,
  session_type VARCHAR(32) NOT NULL,
  started_at BIGINT NOT NULL,
  ended_at BIGINT NOT NULL,
  planned_min INT UNSIGNED NOT NULL,
  actual_min DECIMAL(14,6) NOT NULL,
  label VARCHAR(255) NOT NULL,
  outcome VARCHAR(32) NULL,
  payload JSON NOT NULL,
  row_hash CHAR(64) NOT NULL,
  synced_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_odak_sessions_task_id (task_id),
  INDEX idx_odak_sessions_started_at (started_at)
);

CREATE TABLE IF NOT EXISTS odak_meta (
  meta_key VARCHAR(191) NOT NULL PRIMARY KEY,
  payload JSON NOT NULL,
  row_hash CHAR(64) NOT NULL,
  synced_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6)
);

CREATE TABLE IF NOT EXISTS odak_labels (
  name VARCHAR(255) NOT NULL PRIMARY KEY,
  color VARCHAR(32) NOT NULL,
  synced_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6)
);

CREATE TABLE IF NOT EXISTS odak_sync_state (
  singleton_id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  schema_version INT UNSIGNED NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  source_device VARCHAR(191) NOT NULL,
  source_updated_at BIGINT NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  task_count INT UNSIGNED NOT NULL,
  session_count INT UNSIGNED NOT NULL,
  synced_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT chk_odak_sync_singleton CHECK (singleton_id = 1)
);

CREATE TABLE IF NOT EXISTS odak_backup_snapshots (
  revision BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  exported_at BIGINT NOT NULL,
  source_device VARCHAR(191) NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
