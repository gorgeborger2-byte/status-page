# Cosmo Status Site

This version uses a frontend admin/auth system (no backend required to run pages).

## Pages

- `auth.html` - login/register page
- `admin.html` - admin panel (approve users, roles, ban, remove, content edits, manual items)
- `index.html` - protected main status page
- `presentation.html` - protected support guide page

## Auth Rules

- Privileged accounts are auto-seeded in `auth-local.js`
- Support users register from `auth.html`
- New users stay pending until admin approves in `admin.html`
- Pending or banned users cannot access protected pages

## Storage

All auth/admin data is stored in browser `localStorage` via `auth-local.js`.
