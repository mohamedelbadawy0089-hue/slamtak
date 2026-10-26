CREATE OR REPLACE FUNCTION set_product_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.user_id := auth.uid();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_product_user_id_trigger ON products;

CREATE TRIGGER set_product_user_id_trigger
    BEFORE INSERT OR UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION set_product_user_id();
