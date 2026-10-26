-- Create function to update average cost when new stock is added (RLS-aware)
create or replace function update_average_cost()
returns trigger as $body$
begin
  if new.type = 'in' then
    -- Update product average cost
    update products set
      current_stock = current_stock + new.quantity,
      average_cost = case
        when current_stock = 0 then new.unit_cost
        else ((average_cost * (current_stock - new.quantity)) + (new.unit_cost * new.quantity)) / current_stock
      end,
      updated_at = now()
    where id = new.product_id;
  end if;
  return new;
end;
$body$ language plpgsql;

-- Create trigger on inventory_movements for average cost
create trigger inventory_movement_trigger
after insert on inventory_movements
for each row execute function update_average_cost();

-- Create function for low stock alert
create or replace function check_low_stock_alert()
returns trigger as $body$
declare
  product_row products%rowtype;
begin
  select * into product_row from products where id = new.product_id;
  
  if new.type = 'out' and product_row.current_stock < product_row.minimum_stock then
    raise notice 'Low stock alert: Product % has stock % (minimum: % )', product_row.name, product_row.current_stock, product_row.minimum_stock;
  end if;
  
  return new;
end;
$body$ language plpgsql;

-- Create trigger for low stock alert
create trigger low_stock_alert_trigger
after insert on inventory_movements
for each row execute function check_low_stock_alert();

-- Create function to recalculate average cost for a product
create or replace function recalculate_average_cost(product_id_param uuid)
returns void as $body$
declare
  total_cost decimal(10,2) := 0;
  total_quantity integer := 0;
  avg_cost decimal(10,2);
begin
  -- Calculate total cost from all incoming movements
  select coalesce(sum(quantity * unit_cost), 0), coalesce(sum(quantity), 0)
  into total_cost, total_quantity
  from inventory_movements
  where product_id = product_id_param and type = 'in';
  
  if total_quantity > 0 then
    avg_cost := total_cost / total_quantity;
    update products set average_cost = avg_cost, updated_at = now() where id = product_id_param;
  end if;
end;
$body$ language plpgsql;

-- Create function to get low stock products
create or replace function get_low_stock_products()
returns table (
  id uuid,
  name text,
  current_stock integer,
  minimum_stock integer,
  average_cost decimal(10,2)
) as $body$
begin
  return query
  select id, name, current_stock, minimum_stock, average_cost
  from products
  where current_stock < minimum_stock;
end;
$body$ language plpgsql;

-- Insert sample products for testing
insert into products (name, description, current_stock, average_cost, minimum_stock)
values 
  ('Widget A', 'A standard widget', 10, 5.99, 5),
  ('Widget B', 'A premium widget', 3, 12.49, 5),
  ('Widget C', 'A basic widget', 15, 2.99, 10);