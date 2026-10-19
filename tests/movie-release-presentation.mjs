import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as vm from "node:vm";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const weeklySource = read("../src/js/03a-home-weekly-ui-runtime.js");
const historySource = read("../src/js/06-tmdb-history-model.js");
const heroSource = read("../src/js/11a-home-render-core-hero.js");
const runtimeSource = read("../src/js/16-detail-rendering.js");
const browseSource = read("../src/js/11e-tv-browse.js");

function extractFunction(source, name) {
  const marker = `    function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} exists in its production source`);
  const next = source.indexOf("\n    function ", start + marker.length);
  assert.notEqual(next, -1, `${name} has a following top-level function boundary`);
  return source.slice(start, next).trim();
}

const ui = { previewKey: "movie:fixture", view: "home", presentedKey: "" };
const wallpaper = { active: false, currentKey: "", moveToken: 4 };
const scheduledWallpaperShifts = [];
const elements = Object.fromEntries(["tvBrowseTitle", "tvBrowseMeta", "tvBrowseUpdate", "tvBrowseOverview"]
  .map(id => [id, { textContent: "", hidden: false }]));
const sandbox = {
  weeklyDateRange: () => ({}),
  $: id => elements[id],
  tvBrowseState: () => ui,
  tvBrowseRenderContinue: () => {},
  homeHeroPresentationGenres: () => [],
  homeHeroPresentationOverview: () => "",
  syncTvBrowseFilterOverview: () => {},
  tvWallpaperState: () => wallpaper,
  tvWallpaperScheduleInfoShift: (key, token) => scheduledWallpaperShifts.push({ key, token }),
  tvBrowseRenderLogo: () => {},
  tvDetailCacheId: item => String(item && (item.tmdbId || item.id) || ""),
  normalizeLegacyCategoryId: () => ""
};

const productionFunctions = [
  extractFunction(historySource, "today"),
  extractFunction(weeklySource, "latestDateOnly"),
  extractFunction(weeklySource, "weeklyDateLabel"),
  extractFunction(weeklySource, "movieReleaseStatusText"),
  extractFunction(weeklySource, "weeklyUpdateText"),
  extractFunction(runtimeSource, "detailRuntime"),
  extractFunction(runtimeSource, "tvEpisodeStatusLabel"),
  extractFunction(runtimeSource, "tvPresentationStatus"),
  extractFunction(heroSource, "homeHeroPresentationStatus"),
  extractFunction(browseSource, "tvBrowseCommitPreviewInfo")
].join("\n\n");
vm.runInNewContext(`${productionFunctions}\nglobalThis.api = { today, homeHeroPresentationStatus, tvBrowseCommitPreviewInfo };`, sandbox);

const api = sandbox.api;
const today = api.today();
const [currentYear] = today.split("-").map(Number);
const addUtcDays = (value, amount) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
};
const label = value => {
  const [year, month, day] = value.split("-").map(Number);
  return year === currentYear ? `${month}月${day}日上映` : `${year}年${month}月${day}日上映`;
};
const movie = releaseDate => ({ mediaType: "movie", releaseDate, title: "日期状态测试电影" });
const detail = release_date => ({ release_date, runtime: 120 });
const heroStatus = (item, movieDetail = {}) => api.homeHeroPresentationStatus(item, movieDetail);

assert.equal(heroStatus(movie("2010-05-12"), detail("2010-05-12")), "120分钟 · 已上映");
console.log("HERO_MOVIE_2010_RELEASED = PASS");
assert.equal(heroStatus(movie("2025-09-18"), detail("2025-09-18")), "120分钟 · 已上映");
console.log("HERO_MOVIE_2025_RELEASED = PASS");
assert.equal(heroStatus(movie(today), detail(today)), "120分钟 · 已上映");
console.log("HERO_MOVIE_RELEASES_TODAY = PASS");

const nextDay = addUtcDays(today, 1);
const nextDayExpected = label(nextDay);
assert.equal(heroStatus(movie("2010-01-01"), detail(nextDay)), `120分钟 · ${nextDayExpected}`);
console.log("HERO_MOVIE_DETAIL_DATE_OVERRIDES_OLD_CARD_DATE = PASS");
assert.equal(heroStatus(movie(""), detail("invalid-date")), "120分钟");
console.log("HERO_MOVIE_UNKNOWN_DATE_NO_STATUS = PASS");

const nextYearDate = `${currentYear + 1}-01-01`;
assert.equal(heroStatus(movie("2010-01-01"), detail(nextYearDate)), `120分钟 · ${currentYear + 1}年1月1日上映`);
console.log("HERO_MOVIE_CROSS_YEAR_FUTURE_DATE = PASS");
if (nextDay.slice(0, 4) === String(currentYear)) {
  assert.equal(heroStatus(movie(""), detail(nextDay)), `120分钟 · ${nextDayExpected}`);
  console.log("HERO_MOVIE_SAME_YEAR_FUTURE_DATE = PASS");
} else {
  console.log("HERO_MOVIE_SAME_YEAR_FUTURE_DATE = NOT_APPLICABLE_ON_LAST_DAY_OF_YEAR");
}

const weeklyItem = Object.assign(movie("2010-01-01"), { weeklyUpdateText: "本周新片 · 旧日期上映" });
assert.equal(heroStatus(weeklyItem, detail(nextYearDate)), `120分钟 · 本周新片 · 1月1日上映`);
console.log("HERO_WEEKLY_MOVIE_DATE_PROMPT_PRESERVED = PASS");
const tvItem = { mediaType: "tv", tmdbId: "tv-42" };
const endedTvDetail = { id: "tv-42", media_type: "tv", status: "Ended", number_of_seasons: 3, number_of_episodes: 20 };
assert.equal(heroStatus(tvItem, endedTvDetail), "已完结 · 3季 · 全 20 集");
console.log("HERO_TV_LIFECYCLE_ROUTE_PRESERVED = PASS");

const browseKey = "movie:fixture";
const browseMovie = Object.assign(movie("2010-01-01"), { title: "TV Browse 状态测试", voteAverage: 8.2 });
const updatedDetail = detail(nextYearDate);
ui.previewKey = browseKey;
ui.presentedKey = "";
wallpaper.active = false;
wallpaper.currentKey = browseKey;
assert.equal(api.tvBrowseCommitPreviewInfo(browseMovie, updatedDetail, browseKey), true);
const browseStatus = elements.tvBrowseUpdate.textContent;
assert.equal(browseStatus, `120分钟 · ${currentYear + 1}年1月1日上映`);
assert.equal(ui.presentedKey, browseKey);

wallpaper.active = true;
wallpaper.currentKey = browseKey;
assert.equal(api.tvBrowseCommitPreviewInfo(browseMovie, updatedDetail, browseKey), true);
assert.equal(elements.tvBrowseUpdate.textContent, browseStatus);
assert.deepEqual(scheduledWallpaperShifts, [{ key: browseKey, token: 4 }]);
console.log("HOME_HERO_BROWSE_WALLPAPER_STATUS_CONSISTENT = PASS");

assert.ok(heroSource.includes("setHomeHeroOptionalText(status, homeHeroPresentationStatus(item, detail))"),
  "the real Home Hero renderer consumes the shared presentation status");
assert.ok(browseSource.includes("$(\"tvBrowseUpdate\").textContent = homeHeroPresentationStatus(item, detail)"),
  "TV Browse preview commits the shared presentation status");
console.log("PRESENTATION_RENDER_CALLSITES = PASS");
