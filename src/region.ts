/**
 * Where a location string is: in the US, abroad, or not clear ("Remote", "Hybrid", "").
 * The sources write locations many ways ("NYC", "Remote in USA", "Boise, ID - Main Site",
 * "San Jose, California, United States", "Toronto, ON", "Bengaluru, Karnataka, IND").
 */
export type Region = "us" | "abroad" | "unknown";

const STATE_CODES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR";
const STATE_NAMES =
  "Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia|Puerto Rico";

const US_COUNTRY = /\b(united states|usa|us)\b|\bU\.S\.|(?<!(latin|south|central) )\bamerica\b/i;
// Case-sensitive: an upper-case code after a comma or a space ("Austin, TX", "Atlanta GA 30301"), but
// not right after another code, where it is a country ("Bengaluru, KA, IN").
const US_STATE_CODE = new RegExp(`(?<!\\b[A-Z]{2},?)(^|[,\\s])(${STATE_CODES})(\\s+\\d{5})?(?=$|[\\s,;/)-])`);
// "Town, ST" at the end outranks country names ("Holland, MI", "Peru, IN"), but not when the town
// is itself a code ("Bengaluru, KA, IN", "Toronto, ON, CA").
const US_TOWN_STATE = new RegExp(`(^|,)[^,]*[a-z][^,]*,\\s*(${STATE_CODES})(\\s+\\d{5})?\\s*$`);
const US_STATE_NAME = new RegExp(`\\b(${STATE_NAMES})\\b`, "i");
/** US places the sources write without a state. */
const US_PLACE =
  /\b(nyc|new york city|sf|south sf|bay area|silicon valley|san francisco|los angeles|chicago|seattle|boston|austin|san jose|san diego|palo alto|mountain view|sunnyvale|santa clara|menlo park|redmond|pittsburgh|atlanta|denver|dallas|houston|philadelphia|miami|washington d\.?c\.?)\b/i;

const FOREIGN_COUNTRY = new RegExp(
  "\\b(" +
    [
      "canada", "uk", "united kingdom", "great britain", "england", "scotland", "wales", "northern ireland",
      "ireland", "germany", "deutschland", "france", "spain", "italy", "portugal", "netherlands", "holland",
      "belgium", "luxembourg", "switzerland", "austria", "sweden", "norway", "denmark", "finland", "iceland",
      "poland", "czechia", "czech republic", "slovakia", "hungary", "romania", "bulgaria", "greece", "croatia",
      "serbia", "slovenia", "estonia", "latvia", "lithuania", "ukraine", "turkey", "türkiye", "cyprus", "malta",
      "israel", "united arab emirates", "uae", "qatar", "saudi arabia", "bahrain", "kuwait", "oman", "jordan",
      "egypt", "morocco", "south africa", "nigeria", "kenya", "ghana", "india", "pakistan", "bangladesh",
      "sri lanka", "nepal", "china", "hong kong", "macau", "taiwan", "japan", "korea", "singapore", "malaysia",
      "vietnam", "viet nam", "thailand", "indonesia", "philippines", "australia", "new zealand", "brazil",
      "argentina", "chile", "colombia", "peru", "uruguay", "costa rica", "guatemala", "panama", "russia",
      "belarus", "botswana", "guernsey", "isle of man", "emea", "apac", "latam", "europe", "asia", "africa",
      "south america", "latin america", "central america",
    ].join("|") +
    ")\\b|(?<!new )\\b(mexico|jersey(?! city))\\b",
  "i",
);
// Case-sensitive codes: ISO 3166 alpha-3 countries, and Canadian provinces after a comma ("Toronto, ON").
const FOREIGN_CODE =
  /\b(CAN|GBR|IRL|DEU|FRA|ESP|ITA|PRT|NLD|BEL|LUX|CHE|AUT|SWE|NOR|DNK|FIN|POL|CZE|SVK|HUN|ROU|BGR|GRC|HRV|SRB|UKR|TUR|ISR|ARE|QAT|SAU|EGY|ZAF|NGA|KEN|IND|PAK|CHN|HKG|TWN|JPN|KOR|SGP|MYS|VNM|THA|IDN|PHL|AUS|NZL|MEX|BRA|ARG|CHL|COL|PER|CRI)\b|,\s*(ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|YT|NT|NU)\b/;
/** Foreign places the sources write without a country. */
const FOREIGN_PLACE =
  /\b(london|toronto|montr[eé]al|vancouver|ottawa|calgary|waterloo|ontario|qu[eé]bec|british columbia|alberta|nova scotia|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|gurgaon|gurugram|chennai|shanghai|beijing|shenzhen|tokyo|seoul|taipei|dubai|abu dhabi|sydney|melbourne|paris|berlin|munich|amsterdam|dublin|zurich|madrid|barcelona|milan|stockholm|warsaw|krak[oó]w|tel aviv|s[aã]o paulo)\b/i;

export function locationRegion(location: string): Region {
  // speedyapply appends "+2" when a job has more locations than it shows.
  const text = location.replace(/\s*\+\d+\s*$/, "").trim();
  if (US_COUNTRY.test(text) || US_TOWN_STATE.test(text)) return "us";
  if (FOREIGN_COUNTRY.test(text) || FOREIGN_CODE.test(text)) return "abroad";
  if (US_STATE_CODE.test(text) || US_STATE_NAME.test(text) || US_PLACE.test(text)) return "us";
  if (FOREIGN_PLACE.test(text)) return "abroad";
  return "unknown";
}

// speedyapply splits its lists into US and international files (feeds named in src/sources/speedyapply.ts).
// A US-file row can show a foreign location first and hide the rest behind "+2", so the file decides.
const US_FEEDS = new Set(["speedyapply-swe-us", "speedyapply-ai-us"]);
const FOREIGN_FEEDS = new Set(["speedyapply-swe-intl", "speedyapply-ai-intl"]);

/**
 * True when a job is only outside the US: none of its listings is in the US, and some listing has
 * a foreign location or comes from an international feed. Unclear jobs ("Remote") count as US.
 */
export function isInternational(listings: { feed: string; locations: string[] }[]): boolean {
  let abroad = false;
  for (const listing of listings) {
    if (US_FEEDS.has(listing.feed)) return false;
    if (FOREIGN_FEEDS.has(listing.feed)) abroad = true;
    for (const location of listing.locations) {
      const region = locationRegion(location);
      if (region === "us") return false;
      if (region === "abroad") abroad = true;
    }
  }
  return abroad;
}
