-- The exact manifest the release key signed. The app verifies the signature
-- over this object, then checks the row's other columns agree with it.
alter table public.app_releases add column if not exists manifest jsonb not null default '{}'::jsonb;
comment on table public.app_releases is 'Signed desktop releases. Rows are written by scripts/release/publish-release.cjs; the app installs only a row whose manifest signature verifies against the public key built into it. Set enabled = false to withdraw a release.';