-- M1 fix: asset_files.uploaded_by no tenía default y el INSERT del front
-- fallaba con 23502 (null value in column "uploaded_by").
-- Default a auth.uid() para clientes autenticados; el front también envía el valor.
ALTER TABLE public.asset_files
    ALTER COLUMN uploaded_by SET DEFAULT auth.uid();

COMMENT ON COLUMN public.asset_files.uploaded_by IS
    'Usuario que subió el documento. Default auth.uid(); el front lo envía explícito.';
