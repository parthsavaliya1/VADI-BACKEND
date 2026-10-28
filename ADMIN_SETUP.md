# Automatic admin setup

Set these in the backend deployment environment or its untracked `.env` file:

```env
MONGO_URI=<your database connection string>
ADMIN_NAME=Super Admin
ADMIN_EMAIL=<your admin email>
ADMIN_PASSWORD=<a unique password of at least 12 characters>
```

Do not commit real credentials. ADMIN_PASSWORD accepts at most 72 UTF-8 bytes.
After a merge, deploy the backend and restart it (for PM2, use --update-env when
updating process environment variables). Startup connects to MongoDB and ensures
the configured admin exists before accepting requests. With both admin variables
absent, setup is skipped. Partial or invalid settings stop startup with an error.

Sign in at the admin site's /admin/login using ADMIN_EMAIL and ADMIN_PASSWORD.
Existing accounts keep their current passwords; changing these variables does
not reset a password. The same setup runs with npm run dev for local testing.
Use a development MONGO_URI for local work.

The legacy createAdmin.js script is separate and is not run automatically.