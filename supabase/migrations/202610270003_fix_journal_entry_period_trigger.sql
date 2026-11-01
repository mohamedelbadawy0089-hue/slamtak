-- Fix journal entry period trigger
CREATE OR REPLACE TRIGGER check_journal_period
BEFORE INSERT ON journal_entries
FOR EACH ROW
EXECUTE FUNCTION validate_journal_period();