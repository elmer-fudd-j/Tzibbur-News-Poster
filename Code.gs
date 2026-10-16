/**
 * TZIBBUR PERIODIC NEWS POSTER BOT
 *
 * SETUP INSTRUCTIONS:
 * 1. Store your cookie in Project Settings -> Script Properties as TZIBBUR_REFRESH_COOKIE.
 * 2. Update GROUP_ID in the configuration section below.
 * 3. Run testFeeds() once to see which feeds work from Google's servers.
 * 4. Add a time-driven trigger for runNewsPosterBot (every 3 hours).
 */

// ==========================================
// 1. CONFIGURATION (edit these)
// ==========================================
const GROUP_ID = 'PASTE_YOUR_GROUP_ID_HERE';
const API_BASE_URL = 'https://api.tzibbur.me/v1';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

//==NEWS SOURCES==
// All feeds are read every run; comment out any you don't want with //
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
const ITEMS_PER_FEED = 5;       // newest items considered from each feed
const HISTORY_SIZE = 100;       // how many posted headlines to remember
const MESSAGE_TITLE = '📰 *News Brief*';
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
      .replace(/<\/?[^>]+(>|$)/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (title) titles.push(title);
  }
  return titles;
}

function getHistory() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty(POSTED_HISTORY_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function markPosted(titles) {
  const history = titles.concat(getHistory()).slice(0, HISTORY_SIZE);
  PropertiesService.getScriptProperties().setProperty(POSTED_HISTORY_KEY, JSON.stringify(history));
}

/**
 * Reads every feed, interleaves them so no single source dominates,
 * and returns { text, titles } or null if there is nothing new to post.
 */
function fetchLatestHeadlines() {
  const perFeed = FEED_URLS.map(function (url) {
    const xml = fetchFeedXml(url);
    const items = xml ? extractTitles(xml).slice(0, ITEMS_PER_FEED) : [];
    Logger.log((items.length ? '✅ ' : '❌ ') + url + ' (' + items.length + ' items)');
    return items;
  });

  // Round-robin: newest from each feed, then second newest, etc.
  const titles = [];
  for (let i = 0; i < ITEMS_PER_FEED; i++) {
    perFeed.forEach(function (items) {
      if (items[i] && titles.indexOf(items[i]) === -1) titles.push(items[i]);
    });
  }

  if (titles.length === 0) {
    Logger.log('❌ All feeds failed.');
    return null;
  }

  const history = getHistory();
  const fresh = titles
    .filter(function (t) { return history.indexOf(t) === -1; })
    .slice(0, HEADLINES_PER_POST);
  if (fresh.length === 0) {
    Logger.log('No new headlines since last post.');
    return null;
  }

  const timeStamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'h:mm a');
  let text = MESSAGE_TITLE + ' (' + timeStamp + ')\n';
  fresh.forEach(function (t) {
    const clean = t.length > 200 ? t.substring(0, 197) + '...' : t;
    text += '\n• *' + clean + '*\n';
  });

  const maxLen = MAX_MESSAGE_LENGTH ;
  if (text.length > maxLen) {
    text = text.substring(0, maxLen) + '...\n';
  }
  

  Logger.log('Built message: ' + text.length + ' characters.');
  return { text: text, titles: fresh };
}

// ==========================================
// 7. TOOLS (run manually, never posts anything)
// ==========================================
function testFeeds() {
  FEED_URLS.forEach(function (url) {
    const xml = fetchFeedXml(url);
    Logger.log((xml ? '✅ ' + extractTitles(xml).length + ' items: ' : '❌ ') + url);
  });
}
