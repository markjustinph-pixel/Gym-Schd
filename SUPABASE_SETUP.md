# Complete setup guide: login, email verification, Vercel, installation, and syncing

This app is a static website. Vercel serves the site, and Supabase handles accounts and private workout data.

## Important: what this setup includes

- Account creation, one-time email-code verification, password sign-in, workout plans, macro goals, profile names, daily tasks, workout progress, and macro food logs are implemented.
- Daily tasks, workout progress, and macro food logs are saved privately to the signed-in account and update across its signed-in devices. You must run the updated database schema in Step 2 and deploy the updated app code.
- The single administrator panel can manage accounts and global app settings, and can access users' private workout and nutrition records. Complete Step 9 and disclose this access to users before registration.
- Live food-photo scanning and exercise-video lookup also need the server-side API keys in Step 8. Without those keys, simulated food scans and YouTube search links remain available, but the live integrations will not work.

## Before you start

You will need:

- A Supabase account and project.
- A Vercel account and this repository pushed to GitHub.
- An SMTP email provider for reliable verification-code delivery. If using Resend, you also need a domain you control and can verify; registering a domain may have a cost. Users can receive the code at Gmail addresses—the sender domain is separate.

## 1. Create your Supabase project

1. Sign in to [Supabase](https://supabase.com/) and create a project.
2. Save your database password somewhere private. You will not need to put it in this website.
3. Wait until the project finishes setting up.

## 2. Create the app's database tables

1. In Supabase, open **SQL Editor** and choose **New query**.
2. Open [`supabase/schema.sql`](./supabase/schema.sql) in this repository.
3. Copy the whole file, paste it into the SQL Editor, and click **Run**.
4. Confirm the query succeeds. It creates per-user settings and app-data tables, shared app settings, account status controls, their access policies, signup enforcement, and live updates for shared settings and app data.

If you already ran an earlier version of this schema, run the **whole updated file again**. It preserves existing settings and adds the app-data table.

## 3. Turn on sign-up email verification

1. In Supabase, open **Authentication** and find the **Email** provider under **Sign In / Providers**.
2. Enable email sign-ups and require email confirmation.
3. Open **Authentication → Email Templates → Confirm signup**.
4. Make sure the email body includes this placeholder so Supabase sends a one-time code:

   ```text
   Your MJM Workout Planner verification code is: {{ .Token }}
   ```

New accounts enter this code once to finish registration. After that, they sign in with their email and password.

## 4. Set up SMTP email delivery

Supabase's built-in email sender is for testing: it only sends to authorized team addresses and has strict, changeable rate limits. It will not reliably send signup codes to all 20 users. Set up a custom SMTP provider before inviting your group. The example below uses Resend; other providers work too, but use the exact SMTP values shown in their own dashboard.

### A. Prepare Resend

1. Create an account at [Resend](https://resend.com/).
2. Add a domain you own in Resend and follow its instructions to add the required DNS records at your domain provider. Wait until Resend shows the domain as verified. You need to control this domain to send reliably; a Gmail address by itself is not a domain you can verify here.
3. Choose a sender address on that verified domain, such as `no-reply@yourdomain.com`. People can receive the code at Gmail or another email provider; the sender address is the one you own.
4. Create an API key in Resend for sending email. Keep it private. Resend uses this API key as the SMTP password.

See Resend's [SMTP guide](https://resend.com/docs/send-with-smtp), [domain setup](https://resend.com/docs/add-a-domain.md), and [API key guide](https://resend.com/docs/create-an-api-key.md) for its current screens and requirements.

### B. Enter the SMTP details in Supabase

1. Open your Supabase project and go to **Authentication → SMTP Settings** (the exact menu label may vary).
2. Enable custom SMTP.
3. Enter these Resend values:

   | Supabase field | Value |
   | --- | --- |
   | Sender email | The verified sender address, e.g. `no-reply@yourdomain.com` |
   | Sender name | `MJM Workout Planner` |
   | Host | `smtp.resend.com` |
   | Port | `465` (SSL/TLS) or `587` (STARTTLS) |
   | Username | `resend` |
   | Password | Your Resend API key |

4. Save the settings. Do not put the API key in `supabase-config.js`, website code, or GitHub; enter it only in Supabase's SMTP password field.
5. In Supabase, open **Authentication → Rate Limits** and check the email sending limit before inviting everyone. Limits can change, and both Supabase and your email provider enforce their own quotas. Keep the limit appropriate for your group and provider plan.

If you use Brevo, SendGrid, or another provider instead, verify its sender domain and enter the host, port, username, and SMTP password it gives you. Do not assume its API key and SMTP password are interchangeable; follow that provider's instructions.

### C. Confirm the verification email is a code

1. Follow Step 3 and check that the **Confirm signup** template includes `{{ .Token }}`.
2. After deploying the site, sign up using an email address you can access, including a Gmail address if you like.
3. Confirm the message arrives with a numeric code, enter it in the app, and verify that registration completes.
4. If it does not arrive, check the provider's sending/activity logs, Supabase Auth logs, your spam folder, and the sender-domain verification status.

## 5. Add your public Supabase details to the website

1. In Supabase project settings, find the **Project URL** and a **Publishable key**. If your project shows the older `anon` key instead, that is also suitable.
2. Open [`supabase-config.js`](./supabase-config.js).
3. Replace the two placeholder values:

   ```js
   window.MJM_SUPABASE_CONFIG = {
     url: "https://YOUR_PROJECT_ID.supabase.co",
     anonKey: "YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY"
   };
   ```

   Use your real Project URL and Publishable/`anon` key, keeping the quotes.

The Publishable/`anon` key is designed for browser apps. **Never use a `service_role` or secret key here.** The database policies from Step 2 protect each user's data.

## 6. Set the website URL in Supabase

1. In Supabase Authentication, open **URL Configuration**.
2. Set **Site URL** to your Vercel production URL, for example `https://your-project.vercel.app`.
3. Add that same URL to the allowed redirect URLs. If you also test on a local web server, add its exact local URL there too.

## 7. Deploy the site to Vercel

1. Save your changes to `supabase-config.js`.
2. Push the repository to GitHub. Do not commit any SMTP password or `service_role` key.
3. In Vercel, choose **Add New → Project** and import this GitHub repository. If it is already connected, pushing to GitHub should start a new deployment.
4. This project has no build step. Choose **Other** if Vercel asks for a framework, and leave the build command empty.
5. Click **Deploy**, then open the Vercel URL when the deployment finishes.

Use the Vercel URL for testing; opening `index.html` directly as a `file://` URL is not a valid sign-in test.

## 8. Configure food scanning and exercise-video lookup

These features run through Vercel serverless API routes, so their provider keys belong in Vercel—not in browser JavaScript or `supabase-config.js`.

1. Get a `GEMINI_API_KEY` from Google AI Studio. This is required for live food-photo scanning.
2. In Google Cloud Console, enable **YouTube Data API v3** and create an API key named `YOUTUBE_API_KEY`. Restrict it to the YouTube Data API v3. This is required for automatic exercise-video lookup; without it, the app can still offer a YouTube search link.
3. Optional: get a `USDA_API_KEY` from USDA FoodData Central or `FATSECRET_CLIENT_ID` and `FATSECRET_CLIENT_SECRET` from FatSecret. These provide additional nutrition-data lookups; the app can use its included food data and other fallback sources without them.
4. In Vercel, open your project **Settings → Environment Variables**. Add the exact variable names above with their values. Select **Production**; also select **Preview** if you want to test preview deployments. Add only the optional variables for providers you have configured.
5. Save the variables and redeploy the project. Vercel functions will not see newly added variables until a new deployment is made.
6. On the deployed site, open Macros and try **Snap & Scan** with camera permission enabled. Also open a workout and try its video lookup. If the keys are missing or invalid, check the Vercel function logs.

Keep all API keys private and out of GitHub. Check each provider's current quota, billing requirements, and usage limits before sharing the app; the optional providers are not required for sign-in, workout planning, progress sync, or manual/simulated food logging.

## 9. Set up the administrator panel

The app supports one administrator account. Admin access is assigned by the user's Supabase account UUID—not by an email address or a browser-side role setting. The admin panel can read users' private plans, progress, tasks, macro goals, and food logs, and can suspend or permanently delete accounts. Tell users about this access before they register; the sign-in page also displays a notice.

1. In Supabase, run the current [`supabase/schema.sql`](./supabase/schema.sql) from Step 2. It creates the shared app settings and account suspension controls. The app needs this schema before the admin panel works.
2. Create and verify your own account through the deployed app, then sign in once.
3. In Supabase, open **Authentication → Users**, find your account, and copy its **User UID**. Confirm that it is your account; this UUID grants administrator privileges.
4. In Vercel, open **Settings → Environment Variables** and add these server-side values:

   | Variable | Value |
   | --- | --- |
   | `SUPABASE_URL` | Your Supabase Project URL |
   | `SUPABASE_ANON_KEY` | The same Publishable/`anon` key used in `supabase-config.js` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase `service_role` secret key |
   | `ADMIN_USER_ID` | Your account's exact Supabase User UID |

   Select **Production** (and **Preview** if needed). The service-role key bypasses database row security, so add it only as a Vercel environment variable. Never put it in website code, `supabase-config.js`, or GitHub.
5. Save the variables and redeploy from Vercel. Then sign in using the account whose UUID you configured; an **Admin panel** link should appear in the navigation.
6. In the panel, you can review user accounts and private records, suspend/restore accounts, delete accounts, show an announcement, enable maintenance mode, disable sign-ups, and set default workout/macro JSON for future accounts. Defaults do not overwrite existing users' personal plans or goals.
7. Test the panel with a separate non-admin account before inviting the group. Confirm it cannot open the panel or access admin actions. Test a suspension and restoration with a test user; use account deletion only when you intend to permanently remove that user's account and saved data.

The admin API checks the signed-in Supabase token and the configured UUID on every request. If the panel reports that it is not configured, confirm all four Vercel values and redeploy. If the settings table is missing, rerun the updated schema.

## 10. Let a friend install it on a PC

The friend does not need your project folder or source code to use the app. Share your deployed Vercel URL. The site includes a web-app manifest and service worker, so a supported browser can install it as an app.

1. Make sure the Vercel deployment is working over its `https://` URL.
2. Send your friend that production URL.
3. On their PC, have them open it in a current version of Chrome or Microsoft Edge.
4. In Chrome, use the install icon in the address bar, or open the browser menu and choose **Install MJM Workout Planner** / **Install page as app**. In Edge, open **Settings and more → Apps → Install this site as an app**. The exact wording can vary slightly by browser version.
5. Confirm the installation. They can then open MJM Workout Planner from the Start menu; the browser may also offer a desktop shortcut.
6. Have your friend create their own account. Each account gets its own workout plan, progress, tasks, food logs, and macro goal. If you sign in to the same account on multiple devices, those devices share that account's data.

The installed app still needs an internet connection for sign-in, email verification, and Supabase-saved data. This installs the website as a browser app; it is not a standalone Windows `.exe` and does not download the source code.

## 11. Test registration and sign-in

1. On the deployed site, choose **Sign up**.
2. Enter a display name, an email address you can access, and a password.
3. Check that email inbox (and its spam folder) for the verification code.
4. Enter the code in the app. A successful verification should open the dashboard.
5. Sign out, then sign in again with the same email and password. Sign-in does not ask for another code.
6. Add a workout and a macro goal, reload the site, and confirm those settings remain saved to your account.

## 12. Test syncing across devices

1. Sign in to the same account on two devices, using the deployed HTTPS site. A person's devices must use the same account to share that person's data.
2. On the first device, add a daily task, mark an exercise done, and add a food log.
3. Keep the second device signed in and open to the matching page. The changes should appear there automatically while connected; if not, reload the page and check the Supabase project is active.
4. Sign in with a different account and confirm it cannot see the first account's tasks, progress, or food logs. Each friend should create their own account; do not share one login among everyone.

The first time an account is used on a browser that already has local tasks, exercise progress, or food logs, the app asks whether to merge that browser's saved data into the account. This prompt can appear once on each browser/device with old local data. Choose **OK** only if the data belongs to that account. Choosing **Cancel** keeps the old data only on that browser and leaves any data already in the account unchanged. Local data is not deleted by either choice.

Workout plans, macro goals, display names, tasks, exercise progress, and food logs are account-specific. Daily tasks, exercise progress, and food logs sync between devices signed in to the same account; a separate account cannot access them. Syncing needs an internet connection.

## 13. Share it with your group

1. Send each person the deployed Vercel URL.
2. Have each person sign up with their own email and verify it with the code they receive.
3. If one person uses the app on multiple devices, have them sign in to the same account on each device.
4. Do not share account passwords. Separate accounts keep each person's plans, tasks, progress, and food logs private.

Twenty people using the app normally should be a reasonable fit for the free plans, but that is not a guaranteed simultaneous-user limit. Check Supabase and Vercel usage dashboards as the group starts using it. A Supabase Free project may pause after one week without activity; resume it in Supabase if the app stops connecting.

## If something does not work

- **Sign-in is disabled:** check that both placeholders in `supabase-config.js` were replaced, then redeploy.
- **No code arrives:** check spam, confirm the **Confirm signup** template contains `{{ .Token }}`, and check your SMTP provider's delivery logs.
- **The email contains a link but no code:** update the Supabase **Confirm signup** template to include `{{ .Token }}`.
- **Saving a plan, task, progress, or food log fails:** confirm Step 2 ran successfully, the updated site is deployed, the Supabase project is active, and the browser is signed in to the intended account.
- **Changes do not appear automatically on another device:** confirm the whole updated schema ran successfully, then reload both devices and check the browser console for Realtime errors.
- **Live plate scanning fails:** confirm `GEMINI_API_KEY` is set in Vercel for the deployed environment, redeploy after adding it, and check the Vercel function logs. **Simulate scan** does not require the key.
- **Automatic exercise-video lookup fails:** confirm `YOUTUBE_API_KEY` is set, YouTube Data API v3 is enabled for its Google Cloud project, and the Vercel deployment was rebuilt. The YouTube search link can still be used as a fallback.
