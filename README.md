# Dream backend and admin

Rebuild of the lost control plane. The existing client frontend keeps using the same three HTTP routes. Files stay on the VPS. Supabase stores metadata only.

## What you get

| App | Path | Port |
|---|---|---|
| Node API | `server/` | `5000` |
| Next.js admin | `admin/` | `3000` |

Public routes (compatible with the current client):

- `POST /register`
- `POST /file-upload`
- `POST /content-upload`

Socket.IO is attached to the API server but has **no business events yet**.

## 1. Create Supabase

1. Create a new project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run `schema.sql` from this repo.
3. Copy **Project URL** and **service_role** key (Settings → API).  
   Use the service role only on the Node server. Never put it in the admin app.

## 2. Configure env

```bash
cp server/.env.example server/.env
cp admin/.env.example admin/.env.local
```

Edit `server/.env`:

```
PORT=5000
HOST=0.0.0.0
PUBLIC_BASE_URL=http://YOUR_VPS_IP:5000
UPLOAD_DIR=/var/www/dream/uploads
MAX_FILE_SIZE_BYTES=10737418240
CORS_ORIGIN=*
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
JWT_SECRET=long-random-string
```

Edit `admin/.env.local`:

```
NEXT_PUBLIC_API_URL=http://YOUR_VPS_IP:5000
```

`NEXT_PUBLIC_API_URL` is baked in at `next build`. Set it before building.

## 3. Create the first admin

There is no register page. From `server/`:

```bash
npm install
npm run create-admin -- you@example.com your-password
```

Password must be at least 8 characters.

## 4. Run locally

Terminal 1:

```bash
cd server
npm install
npm run dev
```

Terminal 2:

```bash
cd admin
npm install
npm run dev
```

- API: http://127.0.0.1:5000/health
- Admin: http://127.0.0.1:3000/login

Point the existing client at `PUBLIC_BASE_URL`.

## Ubuntu VPS

Needs Node.js 20+, enough disk for uploads (files can be up to 10GB).

```bash
sudo mkdir -p /var/www/dream/uploads
sudo chown -R $USER:$USER /var/www/dream
```

Put the project in `/var/www/dream`, set `UPLOAD_DIR=/var/www/dream/uploads`, then:

```bash
cd /var/www/dream/server && npm install --omit=dev
cd /var/www/dream/admin && npm install && npm run build
```

Process manager (PM2):

```bash
sudo npm i -g pm2
cd /var/www/dream
pm2 start server/src/index.js --name dream-api --cwd /var/www/dream/server
pm2 start npm --name dream-admin --cwd /var/www/dream/admin -- start
pm2 save
pm2 startup
```

Nginx in front (10GB uploads):

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;
    client_max_body_size 10G;
    proxy_read_timeout 3600;
    proxy_send_timeout 3600;
    proxy_request_buffering off;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /api/ {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

The existing client should still call the API on port `5000` (or the `/api/` reverse proxy if you change its base URL). Keep `PUBLIC_BASE_URL` matching whatever the client actually uses.

## API behavior

- `/register` upserts by `username` and updates `custom_id` / last seen. Same payload on every client start is OK.
- `customId` and `client_id` are the same value, different field names.
- `/file-upload` with `isUpload=false` writes nothing and still returns `{ "state": "success" }`.
- Re-uploading the same user + folder + file name replaces the previous file.
- Disk layout: `{UPLOAD_DIR}/{username}/{folder}/{fileName}` using Node `path`, so it is safe on Ubuntu.

## Admin

- Login: email + password
- Overview, clients, folder explorer, text contents
- Download streams from disk (works for large files)
- Delete file, bulk delete, delete whole folder (DB row + disk file)
