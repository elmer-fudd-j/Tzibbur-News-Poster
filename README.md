Beware this was made mainly with ai, and is incomplete right now (It works, but is not set up well). After working on this for a while, i went to eat lunch and just left it as is :).
# Tzibbur News Poster Bot

A small Google Apps Script that posts the latest Israel news headlines to a [Tzibbur](https://tzibbur.me) group every few hours, automatically. It pulls headlines from public RSS feeds, skips ones it already posted, keeps its login alive by itself, and emails you if something breaks.

> **Heads up:** This uses Tzibbur's website API, which is not an official, documented bot API. It was reverse-engineered from the website and could stop working if Tzibbur changes things. Use it responsibly, only in groups where you're allowed to post, and check Tzibbur's terms. This is a hobby project with no affiliation or guarantee.

---

## What you need

- A Google account (free)
- A Tzibbur account that can post in the target group
- A computer with Chrome (or Edge/Firefox) to grab one login cookie
- About 15 minutes

---

## Setup

### Step 1: Create the script

1. Go to [script.google.com](https://script.google.com) and click **New project**.
2. Delete everything in the editor.
3. Open `Code.gs` from this repo, copy all of it, and paste it into the editor.
4. Click the disk icon (or press Ctrl+S) to save. Name the project anything you like.

### Step 2: Find your Group ID

1. Open [tzibbur.me](https://tzibbur.me) in Chrome and go to the group you want to post in.
2. Press **F12** to open DevTools and click the **Network** tab.
3. Post any message in the group (for example "test").
4. In the request list, click the request named `messages`.
5. Look at the **Request URL**. It looks like this:
   `https://api.tzibbur.me/v1/groups/`**`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`**`/messages`
6. Copy the long ID between `/groups/` and `/messages`.
7. In the script, replace `PASTE_YOUR_GROUP_ID_HERE` with that ID (keep the quotes):

```javascript
const GROUP_ID = 'your-group-id-here';
```

### Step 3: Get your refresh cookie (the tricky part)

The bot needs a long-lived login "key" called the **refresh cookie**. It then renews its own short-term access by itself. You only do this step once (and again if the bot ever emails you that it's broken).

**Important:** Use a **separate** login just for the bot. If you also use the same login in your normal browser, the two will invalidate each other.

1. Open a **private/incognito window**: **Ctrl + Shift + N** in Chrome or Edge (**Cmd + Shift + N** on Mac), or **Ctrl + Shift + P** in Firefox. You don't need to be signed in to Chrome.
2. Go to [tzibbur.me](https://tzibbur.me) but **don't log in yet**.
3. Press **F12**, open the **Network** tab, and tick **Preserve log**.
4. Log in with your phone number and the code you receive.
5. In the Network tab's filter box, type `verify`, then click the `verify` request (`auth/verify`).
6. Open the **Headers** tab and scroll to **Response Headers**. Find the line starting with `set-cookie: tzibbur_refresh=`.
7. Copy **only the value** between `tzibbur_refresh=` and the first `;`.
   Example line: `tzibbur_refresh=AbC123...; Path=/v1/sessions; Expires=...`
   You want just `AbC123...`
   (You can also try the request's **Cookies** sub-tab, which lists the same value.)
8. Keep the value somewhere for the next step. **Do NOT reload the page, click around, or log out** in that window. Close it when you're done.

If you can't find `tzibbur_refresh` on `verify`, check the requests right after it (for example `sessions` or `sessions/refresh`) and look at their response cookies.

### Step 4: Store the cookie safely

Don't paste the cookie into the code. Store it in the script's private settings instead:

1. In the Apps Script editor, click the **gear icon (Project Settings)** on the left.
2. Scroll down to **Script Properties** and click **Edit script properties**.
3. Click **Add script property**.
4. **Property:** `TZIBBUR_REFRESH_COOKIE`
5. **Value:** the cookie value you copied.
6. Click **Save script properties**.

### Step 5: Set your time zone

Still in **Project Settings**, set **Time zone** to yours. This controls the time shown in each post.

### Step 6: Test it

1. Go back to the **Editor** (the `< >` icon).
2. In the function dropdown at the top, choose `runNewsPosterBot` and click **Run**.
3. The first time, Google asks you to authorize the script. Click **Review permissions**, choose your account, then **Advanced → Go to (project name) (unsafe)** and **Allow**. This warning appears for every personal script; the code is your own copy.
4. Open **Execution log** at the bottom. You want to see:
   - `Using feed: ...`
   - `Fresh bearer token obtained.`
   - `Rotated refresh cookie saved.`
   - `Message posted.`
5. **Run it a second time.** This confirms the cookie rotation works. "No new headlines since last post" is a perfectly fine result. An `invalid_refresh_token` error is not (see Troubleshooting).

### Step 7: Make it automatic

1. Click the **clock icon (Triggers)** on the left.
2. Click **Add Trigger**.
3. Settings:
   - Function to run: `runNewsPosterBot`
   - Event source: **Time-driven**
   - Type: **Hour timer**
   - Interval: **Every 3 hours** (or whatever you like)
4. Click **Save**.

Done. The bot now runs on its own.

---


Tzibbur messages are capped at about 1000 characters, which the script respects.

---

## How it works (short version)

1. The trigger fires every few hours.
2. The script fetches an RSS feed and picks headlines it hasn't posted yet.
3. It exchanges the stored refresh cookie for a short-lived access token. The server replies with a **new** refresh cookie each time, and the script saves it right away.
4. It posts the message, and only then remembers the headlines as "posted".
5. If anything fails, it emails you (at most once per 12 hours).

---

## Troubleshooting

| Problem | What to do |
|---|---|
| `invalid_refresh_token` | The cookie is dead. Repeat Step 3 and update the Script Property. Common causes: you logged out, reused the same login in your normal browser, or the session expired. |
| `No refresh cookie stored` | Step 4 wasn't done, or the property name isn't exactly `TZIBBUR_REFRESH_COOKIE`. |
| `Set GROUP_ID at the top...` | Do Step 2. |
| `All feeds failed` | News sites can block Google's servers. Add or reorder sources in `FEED_URLS`. |
| `Post failed (403/404)` | Wrong Group ID, or your account can't post in that group. |
| `No new headlines` | Normal. Nothing new since the last post. |
| Bot stops working after about a month | Login sessions may have a maximum lifetime. Redo Step 3 when the alert email arrives. |

---

## Security: read this before putting anything on GitHub

- **Never commit your refresh cookie, access tokens, or phone number.** Anyone with the refresh cookie can act as you on Tzibbur.
- Keep the cookie only in **Script Properties**, never in `Code.gs`.
- When asking for help online, don't paste `curl` commands or request headers from DevTools. They contain tokens, codes, and your phone number. Share only request names and status codes.
- If you ever leak a cookie, log out of that session on Tzibbur, which invalidates it.

---

## License

MIT, do whatever you like, no warranty.
