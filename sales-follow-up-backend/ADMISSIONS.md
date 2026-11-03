# SYB Student Admissions: setup and operations

The admissions module tracks each student from first enquiry to visa result. It runs inside this API and the existing web app. It is **off for every business** until you switch it on.

## 1. Switch it on for SYB

```bash
cd sales-follow-up-backend
npm run admissions:enable -- owner@your-business.com
```

This runs the startup migrations, sets `features.admissions = true` on that owner's business, and seeds the default eight stages, checklists, document types and lead sources. Run it against the database you mean to change: the script uses `MONGO_URI` from `.env`. It is safe to run twice.

Admins (business owners) then fine-tune everything in **Admissions → Settings**.

## 2. Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `STORAGE_DRIVER` | `local` | `local` (private folder on the server) or `s3` (any S3-compatible bucket, e.g. Cloudflare R2). **Use `s3` on Render**: Render's disk is wiped on every deploy. |
| `STORAGE_LOCAL_DIR` | `storage/private` | Folder for the local driver. Already in `.gitignore`. |
| `S3_ENDPOINT` | none | R2: `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` | `auto` for R2; the bucket region for AWS. |
| `S3_BUCKET` | none | Bucket name. **Must not** allow public access. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | none | An API token limited to this bucket (read and write objects). |
| `S3_FORCE_PATH_STYLE` | `false` | Set `true` for MinIO-style endpoints. |
| `UPLOAD_MAX_MB` | `10` | Largest file accepted. |
| `ADMISSIONS_JOB_INTERVAL_SECONDS` | `60` | How often reminders and stuck alerts are checked. |
| `JWT_SECRET` | none | Already required. Also signs the 60-second file links. **Replace the placeholder value** before going live. |

### Cloudflare R2 in five steps
1. Cloudflare dashboard → R2 → **Create bucket** (for example `syb-admissions-docs`). Leave public access **off**.
2. R2 → **Manage API tokens** → create a token with *Object Read & Write* on that bucket only.
3. Copy the account ID, access key ID and secret.
4. On Render, add `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
5. Redeploy. Uploads now go to the bucket, and downloads use 60-second presigned links.

## 3. Reminders and stuck alerts

A background job inside the API process (`src/jobs/admissionsReminderJob.js`) runs every minute. Reminders are rows in MongoDB, so a reminder that was due while the server slept (Render free plan) is sent as soon as the server wakes. Each reminder and notification has a unique key, so none is ever sent twice, even if two instances run.

- On the **free plan**, reminders can be late by however long the server slept. A paid Render instance (always on) removes that delay.
- Reminder timing is set in Settings → *Reminders and time*.

## 4. Backups

- **Database:** use MongoDB Atlas backups (cloud backup on M10+ clusters, or scheduled `mongodump` on free/shared tiers). Admissions data is ordinary collections in the same database: `admissionapplications`, `admissionconfigs`, `admissiondocuments`, `admissionfees`, `admissionactivities`, `universities`, `reminders`, `notifications`, `migrations`.
- **Files:** turn on **object versioning** or lifecycle snapshots for the bucket (R2 and S3 both support it), or schedule a copy to a second bucket. The database stores only file metadata and random storage keys; restoring the database without the bucket loses the files.
- The local driver is for development only and has no backup.

## 5. Security notes

- Every admissions endpoint checks sign-in, the business's module switch and the record's scope. Records outside scope answer 404.
- Admin = `OWNER`. `SALES_MANAGER` sees their own and their salespeople's students. `SALESPERSON` sees only their own. Only the owner changes settings, overrides stage requirements or leaves a student unassigned.
- Uploads: PDF, JPEG, PNG and WEBP only, checked by file content (not by name), at most `UPLOAD_MAX_MB`, stored under random names. File contents and links are never logged.
- **No malware scanner is configured.** `scanFile()` in `src/services/storage/fileValidation.js` is the hook for ClamAV or a cloud scanning API.
- Exports never include files and neutralise spreadsheet formulas.

## 6. Trying it locally without real data

```bash
npm run dev:memory           # port 5001 (stop the normal backend first)
PORT=5002 npm run dev:memory # or alongside it
```

This starts the API on a throwaway in-memory database with 20 synthetic students and signs in as `admin@syb.test` / `Password123` (also `manager@`, `anu@`, `rahul@`, `divya@` with the same password). It never reads `MONGO_URI`.

## 7. Tests

```bash
npm test
```

The tests run on an in-memory MongoDB and cover permissions and scoping, unauthorised record and file access, required and conditional checklist rules, stage moves and override history, payments and balances, reminder deduplication, stage duration and stuck alerts, dashboard totals against list counts, and exports.

## 8. Known limitations (v1)

- Times typed into date/time fields are read in the browser's timezone; display uses the module timezone (default Asia/Kolkata).
- No currency conversion: totals are always shown per currency.
- No WhatsApp/email sending, website/Instagram lead capture or parent contacts yet. Activity types and the notification `channel` field leave room for them.
- Reminders are in-app only.
