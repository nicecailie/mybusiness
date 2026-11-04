DO $$
DECLARE
  definition text;
  original text;
BEGIN
  SELECT pg_get_functiondef('provision_business_onboarding(text,text,jsonb)'::regprocedure)
    INTO definition;
  original := definition;
  definition := replace(
    definition,
    'IF coalesce(input->>''acceptLegal'',''false'') <> ''true'' OR coalesce(input->>''subscriptionAgreementUrl'','''') !~ ''^https://[^[:space:]]+$'' OR coalesce(input->>''privacyPolicyUrl'','''') !~ ''^https://[^[:space:]]+$'' OR position(''#'' IN coalesce(input->>''subscriptionAgreementUrl'','''')) > 0 OR position(''#'' IN coalesce(input->>''privacyPolicyUrl'','''')) > 0 THEN RAISE EXCEPTION ''LEGAL_ACCEPTANCE_REQUIRED'' USING ERRCODE=''42501''; END IF;',
    'IF coalesce(input->>''acceptLegal'',''false'') <> ''true'' THEN RAISE EXCEPTION ''LEGAL_ACCEPTANCE_REQUIRED'' USING ERRCODE=''42501''; END IF;'
  );
  IF definition = original
     OR position('acceptLegal' IN definition) = 0
     OR position('subscriptionAgreementUrl' IN definition) = 0
     OR position('privacyPolicyUrl' IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected legal acceptance check was not found; review migration manually.';
  END IF;
  EXECUTE definition;
END;
$$;
