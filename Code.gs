/**
 * TZIBBUR PERIODIC NEWS POSTER BOT
 * 
 * SETUP INSTRUCTIONS:
 * 1. Store your cookie in Project Settings -> Script Properties as TZIBBUR_REFRESH_COOKIE.
 * 2. Update GROUP_ID in the configuration section below.
 */

// ==========================================
// 1. CONFIGURATION (edit these)
// ==========================================
const GROUP_ID = 'PASTE_YOUR_GROUP_ID_HERE';
const API_BASE_URL = 'https://api.tzibbur.me/v1';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

// Tried in order; the first feed that returns usable items wins.
const FEED_URLS = [
  'https://news.google.com/rss/search?q=israel+when:6h&hl=en-US&gl=US&ceid=US:en',
  'https://www.timesofisrael.com/feed/',
  'https://www.jns.org/feed/',
  'https://www.ynetnews.com/Integration/StoryRss3082.xml',
  'https://www.jpost.com/rss/rssfeedsheadlines.aspx',
  'https://matzav.com/feed/',
  'https://www.theyeshivaworld.com/feed',
  'https://thelakewoodscoop.com/news/feed',
  'https://hefkervelt.blogspot.com/feeds/posts/default',
  'https://vinnews.com/feed/',
  'https://hamodia.com/feed/',
  'https://yatedne.com/feed/',
  'https://www.jewishpress.com/feed/',
  'https://collive.com/feed/',
  'https://www.jta.org/feed',
  'https://www.algemeiner.com/feed/',
  'https://jewishinsider.com/feed/',
  'https://www.israelnationalnews.com/Rss.aspx',
];

const HEADLINES_PER_POST = 2;
const MESSAGE_TITLE = '📰 *Israel News Wire Brief*';
const MAX_MESSAGE_LENGTH = 1000;

// Internal storage keys (leave as is)
const POSTED_HISTORY_KEY = 'TZIBBUR_POSTED_TITLES';
const REFRESH_COOKIE_KEY = 'TZIBBUR_REFRESH_COOKIE';
const LAST_ALERT_KEY = 'TZIBBUR_LAST_ALERT_MS';

// ==========================================
// 2. TRIGGER ENTRYPOINT (run every 3 hours)
// ==========================================
function runNewsPosterBot() {
  if (GROUP_ID === 'PASTE_YOUR_GROUP_ID_HERE') {
    Logger.log('❌ Set GROUP_ID at the top of the script first.');
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log('Another run is in progress. Skipping.');
    return;
  }
  try {
    const news = fetchLatestHeadlines();
    if (!news) {
      Logger.log('Nothing to post this run.');
      return;
    }
    const ok = sendTzibburMessage(news.text);
    if (ok) {
      markPosted(news.titles); // only remember headlines after a successful post
    }
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// 3. ALERTS
// ==========================================
function alertOwner(reason) {
  try {
    const props = PropertiesService.getScriptProperties();
    const last = Number(props.getProperty(LAST_ALERT_KEY) || 0);
    if (Date.now() - last < 12 * 60 * 60 * 1000) return; // max one email per 12h
    MailApp.sendEmail(
      Session.getEffectiveUser().getEmail(),
      'Tzibbur news bot needs attention',
      reason + '\n\nIf this is an invalid refresh token, log in to Tzibbur in a fresh incognito window, copy the tzibbur_refresh cookie, and update the TZIBBUR_REFRESH_COOKIE script property (Project Settings -> Script Properties).'
    );
    props.setProperty(LAST_ALERT_KEY, String(Date.now()));
  } catch (e) {
    Logger.log('Could not send alert email: ' + e);
  }
}

// ==========================================
// 4. TOKEN REFRESH (with cookie rotation)
// ==========================================
function saveRotatedCookie(response) {
  const headers = response.getAllHeaders();
  const setCookie = headers['Set-Cookie'] || headers['set-cookie'];
  if (!setCookie) {
    Logger.log('ℹ️ No Set-Cookie header returned; keeping the existing refresh cookie.');
    return;
  }
  const joined = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie);
  const m = joined.match(/tzibbur_refresh=([^;\s]+)/);
  if (m && m[1]) {
    PropertiesService.getScriptProperties().setProperty(REFRESH_COOKIE_KEY, m[1]);
    Logger.log('🔁 Rotated refresh cookie saved.');
  } else {
    Logger.log('ℹ️ Set-Cookie present but no tzibbur_refresh value found.');
  }
}

function refreshBearerToken() {
  const cookie = PropertiesService.getScriptProperties().getProperty(REFRESH_COOKIE_KEY);
  if (!cookie) {
    Logger.log('❌ No refresh cookie stored. Add TZIBBUR_REFRESH_COOKIE in Script Properties.');
    alertOwner('No refresh cookie is stored in the script.');
    return null;
  }

  try {
    const response = UrlFetchApp.fetch(API_BASE_URL + '/sessions/refresh', {
      method: 'post',
      headers: {
        'Cookie': 'tzibbur_refresh=' + cookie,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Origin': 'https://tzibbur.me',
        'Referer': 'https://tzibbur.me/',
        'User-Agent': USER_AGENT
      },
      payload: '{}',
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      Logger.log('❌ Token refresh failed (' + code + '): ' + response.getContentText());
      alertOwner('Token refresh failed with status ' + code + ':\n' + response.getContentText());
      return null;
    }

    // Save the rotated cookie FIRST: the old one is already invalid server-side.
    saveRotatedCookie(response);

    const data = JSON.parse(response.getContentText());
    const token = data.token || data.access_token || data.bearer;
    if (!token) {
      Logger.log('❌ Refresh succeeded but no token field in the response.');
      alertOwner('Token refresh returned no token field.');
      return null;
    }
    Logger.log('🔄 Fresh bearer token obtained.');
    return token;
  } catch (e) {
    Logger.log('❌ Token refresh threw: ' + e);
    alertOwner('Token refresh threw an exception: ' + e);
    return null;
  }
}

// ==========================================
// 5. POSTING
// ==========================================
function sendTzibburMessage(messageText) {
  const token = refreshBearerToken(); // fresh token every run
  if (!token) return false;

  try {
    const response = UrlFetchApp.fetch(API_BASE_URL + '/groups/' + GROUP_ID + '/messages', {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://tzibbur.me',
        'Referer': 'https://tzibbur.me/',
        'User-Agent': USER_AGENT
      },
      payload: JSON.stringify({
        clientMessageId: Utilities.getUuid(),
        body: messageText
      }),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      Logger.log('🚀 Message posted.');
      return true;
    }
    Logger.log('⚠️ Post failed (' + code + '): ' + response.getContentText());
    alertOwner('Posting failed with status ' + code + ':\n' + response.getContentText());
    return false;
  } catch (e) {
    Logger.log('❌ Network error while posting: ' + e);
    alertOwner('Network error while posting: ' + e);
    return false;
  }
}

// ==========================================
// 6. NEWS SOURCES
// ==========================================
function fetchFeedXml(url) {
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    const code = response.getResponseCode();
    const text = response.getContentText();
    if (code !== 200) {
      Logger.log('⚠️ ' + url + ' returned status ' + code);
      return null;
    }
    if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(text.substring(0, 2000))) {
      Logger.log('⚠️ ' + url + ' did not return XML (probably a bot-check page).');
      return null;
    }
    return text;
  } catch (e) {
    Logger.log('⚠️ ' + url + ' threw: ' + e);
    return null;
  }
}

function extractTitles(xml) {
  const itemRegex = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  const titles = [];
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const titleMatch = match[1].match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    if (!titleMatch) continue;
    const title = titleMatch[1]
      .replace
