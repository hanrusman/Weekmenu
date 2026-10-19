# Albert Heijn

Op **Boodschappen** staat naast Picnic een knop voor Albert Heijn. Kies producten en verpakkingen en voeg ze toe aan je AH-winkelmandje (de actieve bestelling). Bestellen, betalen en een bezorgmoment kiezen doe je vervolgens bij AH. De koppeling plaatst geen bestelling.

## Eenmalig koppelen

1. Open in Weekmenu **Voeg toe aan winkelmandje bij Albert Heijn**.
2. Klik op **Open de AH-inlogpagina**. Je logt rechtstreeks bij AH in; Weekmenu ontvangt je AH-wachtwoord niet.
3. Doe dit eenmalig op een computer. Open de ontwikkelaarstools van de browser (F12 of ⌥⌘I), kies **Netwerk** en schakel **Logboek behouden / Preserve log** in voordat je inlogt.
4. Zoek na het inloggen de omleiding `appie://login-exit?code=…`. Afhankelijk van de AH-inlogpagina staat deze in het antwoord van `ingelogd.json`, bij `__N_REDIRECT`.
5. Plak de volledige link in Weekmenu en klik **Account koppelen**. De code is eenmalig. Bij een verlopen of al gebruikte code log je opnieuw in.

Access- en refresh-tokens staan alleen in de SQLite-database op de server. Ze worden niet teruggestuurd naar de browser. Vernieuwen gebeurt automatisch. Een ongeldig geworden koppeling vraagt opnieuw inloggen. Zoals de rest van Weekmenu is dit één gedeelde huishoudelijke koppeling, geen afzonderlijk AH-account per Weekmenu-gebruiker.

## Productkeuze

- De geselecteerde week bepaalt de boodschappen. Afgevinkte boodschappen worden overgeslagen.
- Dezelfde hoeveelheidsberekening en voorkeuren als bij Picnic wegen mee: passend product, vers/diepvries, huismerk, volkoren, biologisch, prijs en resthoeveelheid.
- Producten voor bakker, kaasboer of visboer, aanwezige voorraad en hoeveelheden zoals ‘naar smaak’ staan standaard uit.
- Bij onbekende temperatuur, een verkeerde temperatuur of een ongeschikt zoekresultaat kies je zelf. AH-categorieën en productnamen bepalen de temperatuurinschatting; controleer de voorstellen.
- **Ander product** toont alternatieven en laat vrij zoeken. Een expliciete keuze wordt na bevestigde toevoeging onthouden en bij een volgende week opnieuw bij AH opgezocht.
- De prijs is een schatting; beschikbaarheid, aanbiedingen en de uiteindelijke bestelling worden door AH bepaald.

## Herstellen na een onderbreking

Weekmenu leest eerst het bestelnummer, de bestelstatus, de sluitingstijd en de bestaande aantallen, bewaart het bestelnummer en de gewenste eindstanden en schrijft die met een PUT. Na afloop leest Weekmenu het mandje terug; alleen volledig bevestigde boodschappen worden afgevinkt. Een verloren antwoord leidt dus niet tot blind opnieuw optellen.

Zonder actieve bestelling vraagt Weekmenu eerst een mandje te openen in de AH-app. Een gesloten of afgeronde bestelling, een verstreken sluitingstijd of een onbekende status wordt niet gewijzigd. Een nog niet ingeplande open bestelling hoeft geen sluitingstijd te hebben. Weekmenu heropent of bevestigt geen bestellingen.

Bij een onvolledige poging kies je **Afronden** (eerst controleren, dan alleen ontbrekende eindstanden schrijven) of **Afbreken** (alleen controleren, niets meer toevoegen). Na afbreken blijven niet volledig bevestigde boodschappen open. Als daarvoor al enkele verpakkingen in het AH-winkelmandje staan, meldt Weekmenu die: pas de aantallen aan voordat je opnieuw toevoegt. Afbreken verwijdert geen producten bij AH.

Een herstelpoging hoort bij hetzelfde AH-account én hetzelfde bestelnummer. Als inmiddels een andere bestelling actief is, wordt die niet gewijzigd of gebruikt om boodschappen af te vinken. Je kunt de oude poging afbreken; Weekmenu meldt dan dat je de eerdere bestelling zelf in de AH-app moet controleren.

Tijdens een open poging kun je geen nieuwe AH-poging starten, naar een ander AH-account wisselen of dezelfde boodschappen via Picnic toevoegen. Bewerken van het mandje rechtstreeks bij AH tijdens een poging kan de vergelijking verstoren: rond de poging eerst af. AH biedt hier geen transactie die gelijktijdige wijzigingen door andere clients uitsluit.

## Techniek en verificatie

Er zijn geen nieuwe npm-dependencies of omgevingsvariabelen. Bij starten worden `ah_account`, `ah_products` en `ah_adds` automatisch toegevoegd aan SQLite. De routes onder `/api/albert-heijn` vallen onder de bestaande sessie-authenticatie en CSRF-controle. Verzoeken hebben een timeout, volgen geen redirects en tonen geen ruwe AH-antwoorden of tokens in fouten.

Dit gebruikt de onofficiële mobiele AH-API. Protocolreferenties (geen overgenomen clientcode):

- [appie-go](https://github.com/gwillem/appie-go): tokenuitwisseling, tokenvernieuwing, zoeken en productdetails.
- [appie-go: order.go](https://github.com/gwillem/appie-go/blob/65f41abdeaffb4b990cc35525cc0f20837102e1c/order.go) en [order_test.go](https://github.com/gwillem/appie-go/blob/65f41abdeaffb4b990cc35525cc0f20837102e1c/order_test.go): actieve bestelling, aantallen en bestelstatus/sluitingstijd. De samenvatting gebruikt `id`/`state`; de details gebruiken `orderId`/`orderState` en `closingTime`.
- [appie-go: client.go](https://github.com/gwillem/appie-go/blob/65f41abdeaffb4b990cc35525cc0f20837102e1c/client.go): `appie-current-order-id` bindt bestelverzoeken aan het gelezen bestelnummer.

Mandjeprotocol:
- `GET /mobile-services/order/v1/summaries/active?sortBy=DEFAULT`: bestelnummer, status en `orderedProducts[].quantity`/`product.webshopId`.
- `GET /mobile-services/order/v1/:id/details-grouped-by-taxonomy`: status en sluitingstijd controleren vóór toevoegen.
- `PUT /mobile-services/order/v1/items?sortBy=DEFAULT`: `{ items: [{ productId, quantity, originCode: "PRD", description: "", strikethrough: false }] }`. Dit zet absolute aantallen; producten worden per ID samengevoegd voordat ze worden verstuurd. Niet genoemde producten blijven staan.

De overige paden zijn `/mobile-auth/v1/auth/token`, `/mobile-auth/v1/auth/token/refresh`, `/mobile-services/product/search/v2` en `/mobile-services/product/detail/v4/fir/:id`. Als de tokenuitwisseling geen member-ID geeft, wordt alleen het member-ID via `/graphql` opgevraagd om herstel aan hetzelfde account te binden.

Transport, productkeuze, aantallen, tokenvernieuwing, gedeeltelijke toevoegingen, herhaalde verzoeken en de gebruikersinterface worden met gesimuleerde AH-antwoorden getest. De openbare AH-API gaf bij de controle op 19 oktober 2026 HTTP 503; er is nog geen geslaagde live accounttest. Han voert na deploy zelf onderstaande live test uit met zijn account. De onofficiële endpoints of inlogprocedure kunnen wijzigen.

## Eerste live test na deploy (door Han)

1. Koppel je AH-account via de inlogcode en zorg dat er een open winkelmandje in de AH-app is.
2. Kies één herkenbaar product en een herkenbaar aantal in Weekmenu. Noteer een eventueel bestaand aantal in het mandje en voeg het product toe.
3. Controleer in de AH-app dat het product **in het winkelmandje** staat met het verwachte totaal (bestaand aantal + toevoeging).
4. Controleer dat precies die boodschap één keer is afgevinkt in Weekmenu. Herladen mag het aantal niet verhogen.
5. Voeg een tweede product toe. Controleer dat dit verschijnt en het aantal van het eerste product gelijk blijft.
6. Kies het bezorgmoment en rond bestellen/betalen zelf af in de AH-app wanneer je dat wilt. Weekmenu doet dit niet.
