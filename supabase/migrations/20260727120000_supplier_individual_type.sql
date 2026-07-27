-- Suppliers can be private individuals (for example an owner selling personal
-- equipment to the company). Identity classification is separate from VAT.
ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS suppliers_supplier_type_check;

ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_supplier_type_check
  CHECK (supplier_type IN (
    'individual', 'swedish_business', 'eu_business', 'non_eu_business'
  ));

NOTIFY pgrst, 'reload schema';
