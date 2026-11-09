# 🌍 GeoGuessr Helper

Eigene Meta-Datenbank zum GeoGuessr-Lernen: Weltkarte → Land anklicken → Karte zoomt rein,
oben stehen die allgemeinen Metas (Domain, Flagge, Kennzeichen, Sprache, Google-Car, Poller, Masten …)
mit Text und Bildern.

## Starten (Docker)

Der Stack besteht aus `frontend` (nginx), `backend` (Node) und `ocr` (Texterkennung, Image ~0,6 GB, ~35 MB RAM).
Die Bildsuche `clip` ist **standardmäßig aus** (siehe [CLIP aktivieren](#clip-aktivieren)).

### CLIP aktivieren

Die Bildsuche („Ähnliche Bilder“) braucht ~0,9 GB RAM (Image ~0,9 GB). In
`docker-compose.yml` zwei Stellen einkommentieren (Raute `#` entfernen):

```yaml
  backend:
    environment:
      - CLIP_URL=http://clip:8000        # ← Raute entfernen

  clip:                                  # ← diesen ganzen Block einkommentieren
    build: ./clip
    container_name: geoguessr-helper-clip
    restart: unless-stopped
    environment:
      - TORCH_THREADS=2
```

Dann `docker compose up -d --build` (Portainer: Stack aktualisieren mit *Re-pull/Rebuild*). Die vorhandenen
Bilder werden danach automatisch im Hintergrund indexiert – der Fortschritt steht im Fenster *📷 Bild*.
Wieder ausschalten: beide Stellen auskommentieren und `docker compose up -d --remove-orphans`.

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
ocr/                Python (FastAPI) + Tesseract: Texterkennung – nur intern
clip/               Python (FastAPI) + open_clip (CPU): Bildvektoren für die Ähnlichkeitssuche – optional, nur intern
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
| PUT | `/api/categories/:id` | umbenennen: `{ name }` |
| PUT | `/api/categories/order` | Reihenfolge: `{ ids: [...] }` |
| DELETE | `/api/categories/:id` | löschen; genutzte nur mit `{ move_to: <id> }` (Metas wandern dorthin) |
| GET / POST | `/api/attributes` | Merkmale je Kategorie: `{ category_id, key, values: [] }` |
| PUT / DELETE | `/api/attributes/:id` | bearbeiten (`key`, `values`, `rename: { from, to }`) / löschen |
| GET | `/api/attribute-values` | alle vergebenen Merkmale `{ meta_id, country_iso, attribute_id, value }` (Rückwärtssuche) |
| GET | `/api/search?q=` | Volltextsuche über Metas (Titel, Text, Kategorie, Regionen/Gruppen, Merkmale) |
| GET | `/api/vision/status` | Status von OCR und CLIP, wie viele Bilder sind indexiert? |
| POST | `/api/vision/similar` | Body = Bild → ähnlichste Meta-Bilder (CLIP) + Länder-Rangliste |
| POST | `/api/vision/ocr` | Body = Bild → erkannter Text, Schrift, Länder-Vorschläge |
| GET / PUT | `/api/settings` | Einstellungen, z.B. `{ disabled_countries: ["AQ", …] }` |
| GET | `/api/backup` | Backup als ZIP herunterladen (`geo.db` + `uploads/`) |
| POST | `/api/backup` | Backup einspielen, Body = ZIP (alter Stand → `data/vor-restore-…`) |
| GET | `/api/backup/info` | Größe/Anzahl für den Backup-Tab |
| GET | `/api/stats` | Anzahl Metas je Land (Karten-Einfärbung) |
| GET | `/api/categories/:id/metas` | landesweite Metas einer Kategorie in allen Ländern (Welt-Infografik) |
| GET | `/api/countries/:iso/metas` | Metas eines Landes inkl. Bilder |
| GET | `/api/countries/:iso/regions` | Regionen eines Landes inkl. `meta_count` |
| POST | `/api/regions` | admin1: `{ country_iso, name, source: 'admin1', ref }` (legt an oder liefert vorhandene) · Gruppe: `{ country_iso, name, source: 'group', color, members: [ref…] }` |
| PUT | `/api/regions/:id` | Gruppe bearbeiten: `{ name?, color?, members? }` |
| DELETE | `/api/regions/:id` | Gruppe löschen; Body `{ members: [{ ref, name }] }` stellt ihre Metas auf die einzelnen Regionen um |
| POST | `/api/metas` | `{ country_iso, category_id, title?, text, admin1?: [{ ref, name }], region_ids?: [] }` |
| PUT / DELETE | `/api/metas/:id` | bearbeiten / löschen (Bilder werden mitgelöscht); ohne `admin1`/`region_ids` bleiben die Regionen unverändert |
| POST | `/api/metas/:id/images` | Body = Bilddatei, `Content-Type: image/*` (wird hinten angehängt) |
| PUT | `/api/metas/:id/images/order` | Bildreihenfolge: `{ ids: [Titelbild, 2., …] }` |
| DELETE | `/api/images/:id` | Bild löschen |

### Datenmodell

- `meta_regions` – ein Meta kann für **mehrere Regionen** gelten; keine Einträge = allgemeines Länder-Meta
  (`metas.region_id` enthält nur noch die erste Region, für Kompatibilität)
- `regions` – admin1-Regionen (`source = 'admin1'`, `ref` = Natural-Earth-`adm1_code`, z.B. `DEU-1591`;
  die Geometrie liegt im Frontend unter `/geo/admin1/<ISO>.geojson`) oder selbst gezeichnete Polygone
  (`source = 'custom'`, GeoJSON in `geometry`). admin1-Regionen werden erst beim ersten Regionen-Meta angelegt.
- `metas.area` – mit dem Pinsel eingezeichneter Bereich des Metas (GeoJSON MultiPolygon, an der Landesgrenze
  abgeschnitten). Frühere „eigene Gebiete“ (`regions.source = 'custom'`) werden beim Start in ihre Metas übernommen.
- **Regionsgruppen**: `regions.source = 'group'` mit `color`, Mitglieder (admin1-`ref`s) in `region_members`.
  Ein Meta kann einer Gruppe zugeordnet sein – ändert man die Gruppe, gilt das Meta automatisch für die neuen Mitglieder.
- `attributes` / `meta_attributes` – Merkmale für die Rückwärtssuche, z.B. Kategorie *Masten*:
  `Muster` = Waffel / Löcher / glatt; ein Meta kann mehrere Werte haben
- `meta_fts` – FTS5-Volltextindex (wird beim Start und bei Änderungen neu aufgebaut, nicht separat sichern)

Die Tabellen für Attribute sind schon angelegt, UI folgt in Etappe 3.

## Bedienung

- Land anklicken oder oben suchen → Zoom + Meta-Panel als **Seitenleiste rechts**. Über der Karte steht die
  **Länderleiste** (← Welt, Flagge, Name, Anzahl Metas, *Seitenleiste ⟩* zum Ein-/Ausklappen), darunter – falls
  vorhanden – die **Regionsgruppen**. Der Link (`#DE`) ist teilbar/bookmarkbar.
- Meta- und Gruppenformulare öffnen sich ebenfalls in der Seitenleiste – die Karte bleibt sichtbar.
  Der **Titel ist optional**; ein Meta braucht nur Titel, Beschreibung oder ein Bild.
- **⚙ Optionen** (oben rechts):
  - *Länder*: Länder aus-/einschalten (einzeln oder pro Kontinent), z.B. ohne GeoGuessr-Coverage. Ausgeschaltete
    Länder sind grau und nicht anklickbar (Karte und Namen bleiben sichtbar), nicht in Suche/Infografik. Metas bleiben erhalten.
    Gilt für alle Nutzer (in der DB gespeichert).
  - *Kategorien*: anlegen, umbenennen, Reihenfolge ändern, löschen (genutzte → Metas in andere Kategorie verschieben).
  - *Backup*: alles als ZIP herunterladen (Datenbank + Bilder, im laufenden Betrieb) bzw. ein ZIP wieder einspielen.

## Backup

- **In der App:** ⚙ Optionen → Backup → *Backup herunterladen* / *Backup einspielen*.
  Beim Einspielen wird der bisherige Stand auf dem Server nach `data/vor-restore-<Zeitpunkt>/` verschoben
  (die letzten 3 bleiben erhalten) – ein Fehlgriff lässt sich so rückgängig machen.
  Maximale Backup-Größe: 1 GB (`MAX_BACKUP_MB` im Backend, `client_max_body_size` in `nginx.conf`).
- **Von Hand:** Container stoppen, den Ordner `data/` kopieren, Container starten. Nicht `geo.db` im laufenden
  Betrieb kopieren – dann fehlen evtl. Änderungen aus `geo.db-wal`.
- **Proxmox:** den Docker-LXC in die Proxmox-Backups aufnehmen (Snapshot-Modus).
- Die App hat keinen Login: Wer sie erreicht, kann auch ein Backup einspielen. Nur geschützt (VPN / Proxy mit Login) freigeben.
- **🔎 Rückwärtssuche** (Knopf *Filter* oben): klappt links über der Karte ein Menü auf. Werte anklicken, die du
  im Spiel siehst (z.B. *Masten › Muster: Waffel*, *Kennzeichen › Farbe hinten: gelb*) → die Karte färbt sofort:
  **türkis = passt**, grau = ohne Angabe (Land hat dazu noch kein Meta), **dunkel = ausgeschlossen**.
  Oben im Menü stehen die passenden Länder zum Anklicken. Mehrere Werte eines Merkmals = *oder*, verschiedene
  Merkmale = *und*. *Einklappen* behält die Filter – sie stehen dann als Leiste unter der Kopfzeile (× entfernt
  einzelne). Mit aktiven Filtern zeigt die Welt-Infografik nur passende Länder, in der Seitenleiste sind
  passende Metas grün markiert.
  - **Merkmale festlegen:** ⚙ Optionen → *Merkmale* (pro Kategorie Merkmal + Werte; Wert anklicken = umbenennen).
  - **Metas taggen:** im Meta-Formular unter *Merkmale* die Werte anklicken – fehlende Werte/Merkmale lassen
    sich dort direkt ergänzen.
- **Volltextsuche** (Suchfeld oben): findet Länder und Metas – Titel, Beschreibung, Kategorie, Regionen/Gruppen
  und Merkmale, Wortanfänge reichen, Umlaute egal (`waffel`, `gelbe kenn`, `kansai`). Länder mit Treffern werden
  auf der Karte markiert; Klick auf einen Treffer öffnet das Land und wählt das Meta aus. Pfeiltasten + Enter, Esc.
- **📷 Bilderkennung** (Knopf *Bild* oben): Screenshot mit **Strg+V** einfügen (oder hineinziehen), optional einen
  **Rahmen um das Interessante ziehen** (Mast, Poller, Schild …), dann
  - **🔍 Ähnliche Bilder** (CLIP, optional – [aktivieren](#clip-aktivieren)): vergleicht mit allen Bildern deiner Metas → ähnlichste Bilder + wahrscheinlichste
    Länder (Top 5 auf der Karte markiert). Klick auf ein Bild öffnet das Meta. Wird besser, je mehr Bilder du sammelst.
  - **🔤 Schrift lesen** (OCR, Tesseract): erkennt das Schriftsystem (Latein, Kyrillisch, Griechisch, Thai, Hangul …),
    liest den Text mit jedem passenden Sprachmodell einzeln und bestimmt daraus die **vermutliche Sprache**
    (die sicherste Lesart, die typische Zeichen ihrer Sprache enthält). Länder-Vorschläge kommen aus Schriftsystem und
    verräterischen Sonderzeichen (ő → Ungarn, ł → Polen, ř → Tschechien, ğ/ı → Türkei, ș/ț → Rumänien, ї → Ukraine …).
    Tabellen: `backend/src/ocrHints.js`. Tipp: Rahmen eng um das Schild ziehen – das verbessert die Erkennung deutlich.
  Neue Bilder werden automatisch im Hintergrund indexiert (Fortschritt steht oben im Bilderkennungs-Fenster).
- **Kontinente:** In der Weltansicht oben *Europa*, *Asien* … wählen → Karte zoomt hin, andere Länder werden
  abgedunkelt. Die Auswahl bleibt gespeichert (auch nach Rückkehr aus einem Land).
- **Kategorie-Leiste** (🗺 Kategorie, unter den Kontinenten bzw. unter den Gruppen): Klick auf eine Kategorie
  zeigt sofort die **Infografik** und filtert die Seitenleiste, erneuter Klick blendet beides wieder aus.
  Die Zahl am Button = Anzahl Metas (Weltansicht: landesweite Metas). Die Kategorie bleibt beim Wechsel
  Welt ↔ Land aktiv; „+ Meta“ wählt sie automatisch vor.
- **Welt-Infografik:** Kategorie in der Weltansicht wählen → jedes Land mit einem **landesweiten** Meta dieser
  Kategorie wird eingefärbt und bekommt einen Kasten mit Bild/Text, verbunden mit dem Land. Mit Kontinent-Filter
  nur dessen Länder. Kasten anklicken öffnet das Land.
- **Ländernamen:** Schalter *Aa Ländernamen* oben links auf der Karte. Kleine Länder erscheinen erst beim Zoomen,
  überlappende Namen werden weggelassen.
- **+ Meta** → Kategorie, Titel, Beschreibung, Bilder per Drag & Drop, Dateiauswahl oder
  **Screenshot mit Strg+V** einfügen. Die Vorschaubilder lassen sich **per Drag & Drop sortieren** –
  das erste ist das **Titelbild** (wird in der Infografik zuerst gezeigt).
- Länderfarbe zeigt, wie viele Metas du schon hast (grau = noch nichts).
- Beim Zoom auf ein Land erscheinen die **Regionsgrenzen** (Bundesländer, States, Provinzen …).
  Region auf der Karte anklicken → Zoom auf die Region, Panel zeigt nur deren Metas,
  **+ Regionen-Meta** legt ein Meta für diese Region an. Link: `#DE/DEU-1591` (Bayern).
- **Mehrere Regionen:** mit **Strg+Klick** (oder Shift/⌘) weitere Regionen dazunehmen bzw. wieder
  abwählen – die Karte bleibt dabei stehen. **+ Meta für N Regionen** legt ein Meta an, das für alle
  markierten gilt. Link: `#DE/DEU-1576,DEU-1572`.
- Regionen mit Metas sind grün, die ausgewählte orange. In der Länderansicht stehen die
  Regionen-Metas unter den allgemeinen Metas, gruppiert nach Region.
- Im Formular können unter **Gilt für** jederzeit Regionen und Gruppen hinzugefügt/entfernt werden (keine = ganzes Land).
- **Regionsgruppen** (z.B. Japan: Kansai, Tohoku …): Regionen mit Strg+Klick markieren → **+ Gruppe aus Auswahl**,
  Name und Farbe vergeben. Wo Natural Earth eine Einteilung kennt (Japan, Frankreich, USA …), legt
  **✨ Gruppen vorschlagen** sie auf Knopfdruck an – danach per ✎ umbenennen, Farbe ändern, Regionen verschieben.
  Klick auf eine Gruppe markiert ihre Regionen, **+ Meta für Kansai** legt ein Meta für die ganze Gruppe an.
- **🖌 Bereich einzeichnen** (im Meta-Formular): mit dem Pinsel genau den Bereich auf die Karte malen, für den
  **dieses eine Meta** gilt – Pinselgröße einstellbar, Radierer, getrennte Flecken erlaubt. Gemalt wird nur
  **innerhalb der Landesgrenze**. Die Karte ist währenddessen fixiert, also vorher passend zoomen.
  *✓ Bereich übernehmen*, dann Meta speichern. Der Bereich ist nur sichtbar, wenn das Meta in der Seitenleiste
  **angeklickt** ist (die Karte zoomt dann hin) – und in der Infografik seiner Kategorie (Linie zeigt auf den
  Bereich). Tasten: B Pinsel · E Radierer · + / − Größe · Esc Zeichnen abbrechen.
- **Infografik im Land**: Kategorie in der Kategorie-Leiste anklicken (z.B. *Masten*). Die Karte färbt jede Gruppe in ihrer
  Farbe und zeigt pro Meta einen Kasten mit Bild, Titel und Text, verbunden mit einer Linie zur Region;
  landesweite Metas stehen ohne Linie daneben. Beim Verschieben/Zoomen ordnen sich die Kästen neu.
  Hat ein Meta **mehrere Bilder**, zeigt der Kasten ein Karussell: ‹ › blättern, „2/3“ und Punkte zeigen,
  wie viele Bilder es gibt (Klick auf einen Punkt springt dorthin, Klick aufs Bild vergrößert).

## Roadmap

1. ✅ Weltkarte, Zoom, allgemeine Metas mit Bildern, Docker
2. ✅ Regionen: admin1-Grenzen (Natural Earth 10m) beim Zoom einblenden, Regionen-Metas auf der Karte
   - ✅ Regionsgruppen (inkl. Vorschlag aus Natural Earth) und Infografik-Ansicht pro Kategorie
   - ✅ Bereiche je Meta mit dem Pinsel einzeichnen (`metas.area`, GeoJSON MultiPolygon)
3. ✅ Merkmale pro Kategorie + **Rückwärtssuche** („Mast mit Waffelmuster“ → passende Länder auf der Karte)
   und **Volltextsuche** (SQLite FTS5)
4. ✅ **Bilderkennung** (Container `ocr`, optional `clip`): CLIP-Ähnlichkeitssuche über die eigenen Meta-Bilder und OCR mit
   Länder-Vorschlägen aus Schrift/Sonderzeichen
   - Ideen: OCR-Wörter in die Volltextsuche übernehmen, Sprach-Erkennung über Wortlisten (z.B. „ulica“, „utca“),
     CLIP-Textsuche („yellow bollard with red reflector“)
5. Lernmodus: Quiz (Bild → Land auf Karte klicken), Karteikarten mit Spaced Repetition, Statistik
