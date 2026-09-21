-- Signed desktop update archives. Public to download (the archive is useless
-- without a matching signed row in app_releases); only the admin uploads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('releases', 'releases', true, 52428800, array['application/zip', 'application/x-zip-compressed', 'application/octet-stream'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;