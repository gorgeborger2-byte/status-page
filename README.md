# Cosmo Status Mirror

This site auto-syncs product statuses from:

- `https://support.cosmotickets.com/status/status.php`

It only displays products that are currently in:

- `Updating`
- `Testing`

## How auto-updates work

- GitHub Actions runs every 5 minutes (24/7 schedule).
- It logs in to the protected status page using your password secret.
- It updates `data/status.json` in this repository.
- The website reads that file and refreshes the UI automatically.

## One-time setup in GitHub

1. Open your repo: `https://github.com/gorgeborger2-byte/my-website`
2. Go to **Settings -> Secrets and variables -> Actions**
3. Click **New repository secret**
4. Name: `STATUS_PASSWORD`
5. Value: your status site password (for example: `support`)
6. Save the secret

## Turn on GitHub Pages

1. Go to **Settings -> Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` and folder `/(root)`
4. Save

## Run first sync manually

1. Go to **Actions** tab in your repo
2. Open workflow: **Update status feed**
3. Click **Run workflow**
4. After it finishes, refresh your website

Your live URL is:

- `https://gorgeborger2-byte.github.io/my-website/`
