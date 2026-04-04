# Cosmo Status Web App (Backend + Admin)

This project now runs as a real backend web app (Express), not just static pages.

## Features

- Team login and support registration
- Support registration without email verification
- New support users stay **pending** until manually approved by admin
- Main admin account seeded automatically:
  - Username: `mert`
  - Password: `mert`
- Admin panel permissions:
  - Approve/unapprove users
  - Assign roles (`admin` / `support`)
  - Remove users
  - Edit website content (title, subtitle, announcement)
  - Add/remove manual status items
- Main status page shows approved users with `Online now` or `Last seen`

## Run locally

```bash
npm install
npm start
```

Open:

- Main page: `http://localhost:3000/index.html`
- Auth page: `http://localhost:3000/auth.html`
- Admin page: `http://localhost:3000/admin.html`

## Notes

- User data/content are stored in `backend-db.json`
- Session cookie auth is used
- Approval is **manual only** (no auto-approval)
