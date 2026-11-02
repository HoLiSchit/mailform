# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
Delegated (Nutzer überlässt die Wahl): TypeScript-Server wie das Hauptprojekt, Frontend ohne Build-Schritt (statisches HTML/CSS/JS), mit Tests. Deploy: pm2 als Benutzer `mailform` auf dem eigenen Server, hinter Apache.

## Users
Ausschließlich Adam, der Betreiber, allein an Desktop oder Handy. Er legt Formular-Ziele an, ändert Empfänger, Origins, Rate-Limits und Schlüssel und will danach sofort wissen, ob Mailform die Änderung übernommen hat. Kein Mehrbenutzer-Betrieb geplant.

## Product Purpose
Eine kleine, selbst gehostete Verwaltungsoberfläche für das eigene Formular-Backend (Mailform, Fork von Feuerhamster): "mein eigenes Web3Forms". Erfolg: ein neues Formular ist in unter einer Minute angelegt, ohne SSH und ohne JSON-Dateien, und eine fehlerhafte Änderung kann den laufenden Dienst nie stören.

## Positioning
Genau die Funktionen, die der Betreiber braucht, keine Konten bei Dritten, keine fremden Server, volle Kontrolle über Daten und Zugangsdaten.

## Operating Context
Läuft auf mineco.de hinter Apache (forms-admin.mineco.de), spricht per `docker` mit dem Mailform-Container (Neustart oder SIGHUP-Reload, Umschaltung `RELOAD_MODE`). Zieldateien sind JSON mit Rechten 0600 und enthalten SMTP-Passwörter, die nie im Browser erscheinen dürfen (Maskierung `********`). Login per Session-Cookie mit Brute-Force-Sperre.

## Capabilities and Constraints
- Ziele anlegen, bearbeiten, löschen; Felder: SMTP, Empfänger, Origins (Liste), Rate-Limit, Absender/fixedFrom, Betreff-Präfix, Key, Honeypot, HTML erlauben, Uploads erlauben.
- Nicht verwaltete Felder (redirect, captcha, maxFileSizeMb) bleiben beim Bearbeiten erhalten.
- Nach jeder Änderung Reload mit Prüfung und automatischem Rollback; Fehlertext sichtbar.
- Bewusst nicht im Umfang: Einreichungen speichern, Statistik, Mehrbenutzer.
- Sprache der Oberfläche: Deutsch.

## Brand Commitments
Keine bestehende Marke. Name der Oberfläche: Mailform.

## Evidence on Hand
Keine Screenshots, Logos oder Referenzen vorhanden. Nichts erfinden (keine Beispielkunden oder Zahlen).

## Product Principles
1. Sicherheit vor Bequemlichkeit: Geheimnisse bleiben serverseitig, Dateirechte 0600.
2. Jede Änderung ist überprüfbar und umkehrbar.
3. Zuerst der Zustand (läuft es, wurde es übernommen), dann die Details.
4. Wenige Funktionen, sauber umgesetzt.
