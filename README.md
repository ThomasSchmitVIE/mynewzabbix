# Printbox Network Status

Eigenständiges, ausschließlich lesendes Dashboard für Zabbix 3.0.28.

Benötigte Render-Secrets: `APP_USERS_JSON`, `SESSION_SECRET`, `ZABBIX_USERNAME`, `ZABBIX_PASSWORD`. Die Zielgruppe ist standardmäßig Zabbix-Gruppe `19` (`AT`).

Die Anwendung ändert keine Zabbix-Daten. Aktive Trigger werden 45 Sekunden serverseitig zwischengespeichert und im Browser alle 60 Sekunden aktualisiert.
