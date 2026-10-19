# Albert Heijn

Op **Boodschappen** staat naast Picnic een knop voor Albert Heijn. Kies producten en verpakkingen en zet ze op je persoonlijke AH-boodschappenlijst. Bestellen, betalen en een bezorgmoment kiezen doe je vervolgens bij AH. De koppeling plaatst geen bestelling.

## Eenmalig koppelen

1. Open in Weekmenu **Voeg toe aan boodschappenlijst bij Albert Heijn**.
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

Weekmenu leest eerst bestaande aantallen, bewaart de gewenste eindstanden en schrijft die met een PATCH. Na afloop leest Weekmenu de lijst terug; alleen volledig bevestigde boodschappen worden afgevinkt. Een verloren antwoord leidt dus niet tot blind opnieuw optellen.

Bij een onvolledige poging kies je **Afronden** (eerst controleren, dan alleen ontbrekende eindstanden schrijven) of **Afbreken** (alleen controleren, niets meer toevoegen). Na afbreken blijven niet volledig bevestigde boodschappen open. Als daarvoor al enkele verpakkingen op de AH-lijst staan, meldt Weekmenu die: pas de aantallen aan voordat je opnieuw toevoegt. Afbreken verwijdert geen producten bij AH.

Tijdens een open poging kun je geen nieuwe AH-poging starten, naar een ander AH-account wisselen of dezelfde boodschappen via Picnic toevoegen. Bewerken van de lijst rechtstreeks bij AH tijdens een poging kan de vergelijking verstoren: rond de poging eerst af. AH biedt hier geen transactie die gelijktijdige wijzigingen door andere clients uitsluit.

## Techniek en verificatie

Er zijn geen nieuwe npm-dependencies of omgevingsvariabelen. Bij starten worden `ah_account`, `ah_products` en `ah_adds` automatisch toegevoegd aan SQLite. De routes onder `/api/albert-heijn` vallen onder de bestaande sessie-authenticatie en CSRF-controle. Verzoeken hebben een timeout, volgen geen redirects en tonen geen ruwe AH-antwoorden of tokens in fouten.

Dit gebruikt de onofficiële mobiele AH-API. Protocolreferenties (geen overgenomen clientcode):

- [appie-go](https://github.com/gwillem/appie-go): tokenuitwisseling, tokenvernieuwing, zoeken en productdetails.
- [appie: lists.py](https://github.com/tijnschouten/appie/blob/main/src/appie/lists.py): hoofdboodschappenlijst en absolute aantallen via `GET`/`PATCH /mobile-services/shoppinglist/v2/items`.

De belangrijkste paden zijn `/mobile-auth/v1/auth/token`, `/mobile-auth/v1/auth/token/refresh`, `/mobile-services/product/search/v2` en `/mobile-services/product/detail/v4/fir/:id`. Als de tokenuitwisseling geen member-ID geeft, wordt alleen het member-ID via `/graphql` opgevraagd om herstel aan hetzelfde account te binden.

Transport, productkeuze, aantallen, tokenvernieuwing, gedeeltelijke toevoegingen, herhaalde verzoeken en de gebruikersinterface worden met gesimuleerde AH-antwoorden getest. De openbare AH-API gaf bij de controle op 19 oktober 2026 HTTP 503; er is nog geen geslaagde live accounttest. Controleer na koppelen met één herkenbaar product of het op de AH-lijst verschijnt en één keer wordt afgevinkt. De onofficiële endpoints of inlogprocedure kunnen wijzigen.
