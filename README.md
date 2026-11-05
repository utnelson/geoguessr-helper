# 🌍 GeoGuessr Helper

Eigene Meta-Datenbank zum GeoGuessr-Lernen: Weltkarte → Land anklicken → Karte zoomt rein,
oben stehen die allgemeinen Metas (Domain, Flagge, Kennzeichen, Sprache, Google-Car, Poller, Masten …)
mit Text und Bildern.

## Starten (Docker)

```bash
docker compose up -d --build
```

Danach läuft die App auf **http://<homeserver>:8080**.

- Beim ersten Build lädt der Frontend-Container Länder- und Regionsgrenzen von Natural Earth
  (Public Domain, ca. 45 MB Download, danach ~15 MB im Image) – der Server braucht dafür einmal Internet.
- Alle Daten (SQLite-DB `geo.db` + Bilder in `uploads/`) liegen in `./data` → **diesen Ordner sichern**.
- Hinter einem Reverse Proxy (Traefik, Nginx Proxy Manager, Caddy) einfach Port 8080 bzw. den
  `frontend`-Container ansprechen. Die App hat **keinen Login** – nicht ungeschützt ins Internet stellen
  (z.B. Basic Auth / Authelia im Proxy davor).

## Entwicklung (lokal)

```bash
# Terminal 1 – API (Node >= 22.13, keine npm-Abhängigkeiten)
cd backend && npm run dev            # http://localhost:3000

# Terminal 2 – Frontend
cd frontend
npm install
npm run fetch-geo                    # einmalig: public/geo/countries.geojson + admin1/<ISO>.geojson
                                     # (bei vorhandenen Dateien: npm run fetch-geo -- --force)
npm run dev                          # http://localhost:5173 (Proxy /api → :3000)
npm run typecheck                    # optional: TypeScript prüfen
```

## Aufbau

```
backend/            Node.js, nur Bordmittel (http + node:sqlite)
  src/db.js         Schema + Standard-Kategorien
  src/server.js     REST-API + Bild-Uploads
frontend/           React + TypeScript + Vite + MapLibre GL
  scripts/fetch-geo.mjs   lädt & verkleinert Länder- (50m) und Regionsgrenzen (admin1, 10m, je Land eine Datei)
  src/components/   WorldMap, CountryPanel, MetaForm, Lightbox
  nginx.conf        liefert das Frontend aus, leitet /api + /uploads ans Backend
docker-compose.yml
```

### API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/categories` | Kategorien |
| POST | `/api/categories` | `{ name }` |
| GET | `/api/stats` | Anzahl Metas je Land (Karten-Einfärbung) |
| GET | `/api/countries/:iso/metas` | Metas eines Landes inkl. Bilder |
| GET | `/api/countries/:iso/regions` | Regionen eines Landes inkl. `meta_count` |
| POST | `/api/regions` | `{ country_iso, name, source: 'admin1', ref }` – legt an oder liefert vorhandene (gleiche `ref`) |
| POST | `/api/metas` | `{ country_iso, category_id, title, text, admin1?: [{ ref, name }], region_ids?: [] }` |
| PUT / DELETE | `/api/metas/:id` | bearbeiten / löschen (Bilder werden mitgelöscht); ohne `admin1`/`region_ids` bleiben die Regionen unverändert |
| POST | `/api/metas/:id/images` | Body = Bilddatei, `Content-Type: image/*` |
| DELETE | `/api/images/:id` | Bild löschen |

### Datenmodell

- `meta_regions` – ein Meta kann für **mehrere Regionen** gelten; keine Einträge = allgemeines Länder-Meta
  (`metas.region_id` enthält nur noch die erste Region, für Kompatibilität)
- `regions` – admin1-Regionen (`source = 'admin1'`, `ref` = Natural-Earth-`adm1_code`, z.B. `DEU-1591`;
  die Geometrie liegt im Frontend unter `/geo/admin1/<ISO>.geojson`) oder selbst gezeichnete Polygone
  (`source = 'custom'`, GeoJSON in `geometry`). admin1-Regionen werden erst beim ersten Regionen-Meta angelegt.
- `attributes` / `meta_attributes` – strukturierte Merkmale für die Rückwärtssuche,
  z.B. Kategorie *Masten*: `Form = rund`, `Muster = Waffel`

Die Tabellen für Attribute sind schon angelegt, UI folgt in Etappe 3.

## Bedienung

- Land anklicken oder oben suchen → Zoom + Meta-Panel. Der Link (`#DE`) ist teilbar/bookmarkbar.
- **+ Meta** → Kategorie, Titel, Beschreibung, Bilder per Drag & Drop, Dateiauswahl oder
  **Screenshot mit Strg+V** einfügen.
- Länderfarbe zeigt, wie viele Metas du schon hast (grau = noch nichts).
- Beim Zoom auf ein Land erscheinen die **Regionsgrenzen** (Bundesländer, States, Provinzen …).
  Region anklicken oder im Panel auswählen → Zoom auf die Region, Panel zeigt nur deren Metas,
  **+ Regionen-Meta** legt ein Meta für diese Region an. Link: `#DE/DEU-1591` (Bayern).
- **Mehrere Regionen:** mit **Strg+Klick** (oder Shift/⌘) weitere Regionen dazunehmen bzw. wieder
  abwählen – die Karte bleibt dabei stehen. **+ Meta für N Regionen** legt ein Meta an, das für alle
  markierten gilt. Link: `#DE/DEU-1576,DEU-1572`.
- Regionen mit Metas sind grün, die ausgewählte orange. In der Länderansicht stehen die
  Regionen-Metas unter den allgemeinen Metas, gruppiert nach Region.
- Im Formular können unter **Gilt für** jederzeit Regionen hinzugefügt/entfernt werden (keine = ganzes Land).

## Roadmap

1. ✅ Weltkarte, Zoom, allgemeine Metas mit Bildern, Docker
2. ✅ Regionen: admin1-Grenzen (Natural Earth 10m) beim Zoom einblenden, Regionen-Metas auf der Karte
   - offen: eigene Regionen zeichnen (Datenmodell steht schon: `source = 'custom'`)
3. Attribute pro Kategorie + **Rückwärtssuche** („runder Mast mit Waffelmuster“ → Länder werden auf
   der Karte markiert)
4. Lernmodus: Quiz (Bild → Land auf Karte klicken), Karteikarten mit Spaced Repetition, Statistik
