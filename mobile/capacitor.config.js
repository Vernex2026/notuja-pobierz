// Konfiguracja Capacitora dla powłoki Android aplikacji Notuja.
// Aplikacja ładuje działającą stronę; adres można nadpisać zmienną NOTUJA_URL
// w chwili `npx cap sync android` (np. dla środowiska testowego).
const DEFAULT_URL = "https://notuja.pl";
const SUPABASE_HOST = "mgfhfthlbzknsctsryuj.supabase.co";

const rawUrl = (process.env.NOTUJA_URL || DEFAULT_URL).trim().replace(/\/+$/, "");
const parsed = new URL(rawUrl);
if (parsed.protocol !== "https:") {
  throw new Error("NOTUJA_URL musi zaczynać się od https:// (otrzymano: " + rawUrl + ")");
}

/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: "pl.notuja.app",
  appName: "Notuja",
  webDir: "www",
  server: {
    url: rawUrl,
    androidScheme: "https",
    // Nawigacja wewnątrz aplikacji tylko do tych hostów; reszta otwiera się w przeglądarce.
    allowNavigation: [parsed.hostname, SUPABASE_HOST],
    // Lokalna strona pokazywana, gdy nie uda się załadować serwisu.
    errorPath: "index.html",
  },
  android: {
    backgroundColor: "#f5f4f1",
    allowMixedContent: false,
    appendUserAgent: "NotujaAndroid/0.1.1",
  },
};

module.exports = config;
