SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       pg_get_function_result(p.oid) AS returns
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('p_sale_create','p_proc_receive_goods','p_proc_create_po','p_proc_record_payment','p_sale_create_return')
 ORDER BY p.proname;
