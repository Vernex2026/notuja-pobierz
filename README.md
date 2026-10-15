# notuja-pobierz

Aplikacje Notuja na Windows, Maca i Androida — gotowe pliki są w [wydaniach](../../releases/latest).

To cienkie powłoki wokół serwisu https://notuja.pl (nagrywanie w tle, dźwięk komputera, ikona w zasobniku). Nie zawierają kluczy ani logiki aplikacji — wszystko dzieje się w notuja.pl.

- `desktop/` — Electron (Windows, macOS)
- `mobile/` — Capacitor (Android)
- `.github/workflows/build.yml` — buduje wszystkie trzy i publikuje wydanie

Nowe wydanie: `git tag v0.1.2 && git push origin v0.1.2` albo Actions → „Zbuduj aplikacje Notuja” → Run workflow.