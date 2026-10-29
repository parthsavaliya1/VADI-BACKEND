# Play review access and release verification

One customer demo account is supported. Normal customers and drivers use SMS OTP; sellers keep their password login. The review account uses a username/password without SMS. Fixed production OTP bypasses are removed.

## Test files

Keep the regression tests. They are development checks, not app screens or production request handlers. Backend tests run only with `npm run test:release`. App tests run only with `npm run test:session` or `npm run check:release`. The final Android source map confirms that these test files are absent from the shipped bundle.

Backend coverage includes normal customer/driver OTP, seller password login, payment verification, account isolation, review access and Firebase compatibility. App coverage includes saved sessions, expiry, driver/customer separation, wrong demo credentials, temporary server failures, delayed failures after a newer login, and development/production API selection. The tests use mock SMS/payment services and do not send SMS or charge money.

## Demo account

Run `npm run create:review-accounts` using the intended database. It creates/updates only the reserved demo customer and refuses to overwrite an existing real account. Credentials are stored in the ignored `.review-credentials.local.json` file. Existing old demo seller/driver records are not deleted, but the review-login endpoint no longer accepts those roles.

Run `npm run verify:review-accounts` to exercise the local revised server against the configured database. Demo login, wallet/orders and cross-account isolation were verified successfully. This is not a deployed-server test.

For Play Console App access, use username `review-user` and the user password from the local credentials file. Instructions: Open customer login, choose **Test account sign-in (no OTP)**, enter the credentials, accept the privacy policy, and tap **Sign in without OTP**. No SMS or location permission is needed for this sign-in. Payments/orders use the labelled sandbox; no real charge or delivery is created.

The customer demo does not grant driver/seller login. If Google needs to review those restricted roles, provide separately authorized test access. Google requires reusable credentials and access to restricted functionality: https://support.google.com/googleplay/android-developer/answer/15748846 .

## Verification completed on 29 October 2026

- All 24 backend tests passed, including modular Firebase Admin notification/config compatibility.
- All 8 app session/network tests passed.
- `npm run check:release` passed: TypeScript, lint, app tests and Expo dependency compatibility. Lint has zero errors and 38 warnings; warnings were not disabled to hide failures.
- Final Android production JavaScript/Hermes export with source maps succeeded. Native Expo configuration introspection succeeded. The blocked background-location, broad-storage/media and overlay permissions are marked for removal in the generated manifest.
- Backend `npm audit` reports zero vulnerabilities after compatible updates and the tested Firebase Admin migration.
- App audit decreased from 21 to 8 advisories. These remaining advisories originate in Expo CLI's `zod` and `deepmerge` dependency trees (3 high, 5 low). The final Android source map contains no `zod`, `deepmerge`, or `@expo/cli` modules. npm proposes an incompatible Expo downgrade to address them; that downgrade was not applied. They remain build-tool advisories, not a clean overall app audit.
- Android SDK/emulator/adb are not installed on this computer. A native signed AAB and physical-device test have not been completed. A successful JavaScript export does not substitute for those checks.

## Runtime fixes

- Fixed public product reads being rejected after customer login and corrected legacy category filtering.
- Replaced render-time animation refs with stable lazy state values compatible with the React Compiler, fixed callback dependencies and scheduled effect-driven updates. Existing login forms remain customer/driver OTP and seller password login.
- Expired customer sessions now clear the saved login; driver authentication failures do not clear a customer login. Temporary backend errors and late failures from an older sign-in do not invalidate a newer session.
- Cart/address/order providers remount per customer identity, preventing older in-flight results from updating a new account's caches.
- Concurrent checkout attempts cannot replace an unresolved payment. Closing the payment host rejects its pending promise instead of leaving it hanging.
- Production networking ignores local HTTP overrides and retains Remote Config's HTTPS endpoint. Development HTTP overrides still work. Network requests have a finite 60-second timeout to accommodate cold starts.
- Removed the unused Firebase Auth helper/dependency. Backend OTP and native notification configuration remain in use.

## Deployment still required

The live Render root returned 200, but both `/privacy-policy` and `/account-deletion` returned **404**. Those routes pass local tests and need deployment. No production deployment or Play submission was performed.

The revised backend requires **Node 22 or newer**, declared in `package.json` and `.nvmrc`. Firebase Admin now uses its supported modular APIs. Keep the existing `JWT_SECRET` stable. Supply database/SMS/payment/Firebase secrets in the deployment environment, and set `ENABLE_REVIEW_ACCOUNTS=true` for reviewer access. Do not commit local credentials.

Coordinate the app/backend rollout. The new protected backend endpoints require a session token. Older installed app versions that do not store/send that token are incompatible with the new backend; merely deploying the backend will not migrate them. After installing the updated app, legacy customers without a session token need OTP sign-in once. Never silently exchange a stored user ID for an authenticated token.

The production EAS environment must have its Google Maps key configured; production configuration intentionally refuses a build without it. Configure Firebase native files as needed for push notifications. Local introspection had no Maps key and does not verify production EAS secrets.

Before Play submission, deploy the backend with the proper runtime/environment, verify live policy/deletion and demo login, build/install the production AAB through internal testing, and exercise customer signup/login, driver OTP/handover/location, seller password/product upload, addresses, checkout and invoices. Review the pre-launch report and Data safety declarations. Zero crashes or Play approval cannot be promised without these deployment/device checks.

## Cleanup backups

Removed the unreferenced reCAPTCHA helper and unrelated backend `assets/home-banners` directory and banner-publishing script. Originals are in the sibling `HISAB/vadi-cleanup-backup-20261029` directory. Published remote banners were not deleted. Further source backups, including the unused Firebase helper, are in `HISAB/vadi-stability-backup-20261029`.

Session security, verified-payment checks, policy/deletion routes, native configuration and route compatibility fixes remain because they are referenced by app/server flows. The package lockfiles remain synchronized with their manifests.
