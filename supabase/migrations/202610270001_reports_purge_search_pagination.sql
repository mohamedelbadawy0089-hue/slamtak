-- Reports purge and search pagination
CREATE INDEX idx_reports_date ON reports(created_at);
CREATE INDEX idx_reports_search ON reports(search_vector);