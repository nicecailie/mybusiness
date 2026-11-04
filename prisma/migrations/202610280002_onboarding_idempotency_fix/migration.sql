DO $$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef('provision_business_onboarding(text,text,jsonb)'::regprocedure)
    INTO definition;
  IF position('SELECT payload_hash,result INTO saved_hash,saved_result' IN definition) = 0
     OR position('FROM onboarding_submissions WHERE user_id=actor AND idempotency_key=operation_key FOR UPDATE;' IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected onboarding function source was not found; review migration manually.';
  END IF;
  definition := replace(
    definition,
    'SELECT payload_hash,result INTO saved_hash,saved_result',
    'SELECT s.payload_hash,s.result INTO saved_hash,saved_result'
  );
  definition := replace(
    definition,
    'FROM onboarding_submissions WHERE user_id=actor AND idempotency_key=operation_key FOR UPDATE;',
    'FROM onboarding_submissions AS s WHERE s.user_id=actor AND s.idempotency_key=operation_key FOR UPDATE;'
  );
  EXECUTE definition;
END;
$$;
