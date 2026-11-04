ALTER TABLE businesses
  ADD COLUMN legal_accepted_at timestamptz,
  ADD COLUMN subscription_agreement_url text,
  ADD COLUMN privacy_policy_url text;

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
    '  IF operation_key !~ ''^[A-Za-z0-9_-]{16,100}$'' THEN',
    '  IF coalesce(input->>''acceptLegal'',''false'') <> ''true'' OR coalesce(input->>''subscriptionAgreementUrl'','''') !~ ''^https://[^[:space:]]+$'' OR coalesce(input->>''privacyPolicyUrl'','''') !~ ''^https://[^[:space:]]+$'' OR position(''#'' IN coalesce(input->>''subscriptionAgreementUrl'','''')) > 0 OR position(''#'' IN coalesce(input->>''privacyPolicyUrl'','''')) > 0 THEN RAISE EXCEPTION ''LEGAL_ACCEPTANCE_REQUIRED'' USING ERRCODE=''42501''; END IF;' || E'\n  IF operation_key !~ ''^[A-Za-z0-9_-]{16,100}$'' THEN'
  );
  definition := replace(
    definition,
    'industry_id,contact_name,country,phone,company_size,primary_interest)',
    'industry_id,contact_name,country,phone,company_size,primary_interest,legal_accepted_at,subscription_agreement_url,privacy_policy_url)'
  );
  definition := replace(
    definition,
    'input->>''phone'',input->>''companySize'',input->>''primaryInterest'');',
    'input->>''phone'',input->>''companySize'',input->>''primaryInterest'',now(),input->>''subscriptionAgreementUrl'',input->>''privacyPolicyUrl'');'
  );
  IF definition = original
     OR position('legal_accepted_at,subscription_agreement_url,privacy_policy_url' IN definition) = 0
     OR position('input->>''subscriptionAgreementUrl''' IN definition) = 0 THEN
    RAISE EXCEPTION 'Expected onboarding function sections were not found; review migration manually.';
  END IF;
  EXECUTE definition;
END;
$$;
