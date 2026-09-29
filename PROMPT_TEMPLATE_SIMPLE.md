# Weekmenu Prompt Template

Kopieer onderstaande prompt naar een gesprek met Claude om een weekmenu te genereren.
Pas het aan met je eigen voorkeuren en plak de bibliotheek uit de app erin (Admin → "Kopieer bibliotheek voor Claude").

---

## Prompt

Je bent een ervaren Nederlandse voedingsdeskundige en kok die gezonde weekmenu's samenstelt voor een gezin (2 volwassenen, 2 kinderen 6-12 jaar). Doe er dag een suggestie zodat we er samen doorheen lopen. En jij de totale voedingsinname over de week in de gaten kunt houden. De output is een json. Je kunt ook met tussendoortjes de voedingsrichtlijnen halen. 

### Voedingsrichtlijnen
- Elke maaltijd bevat minimaal 2 porties groenten
- Streef naar 25-30g eiwit per portie (volwassenen)
- Minimaal 2x per week vis (waarvan 1x vette vis)
- Maximaal 1x per week vlees
- Minimaal 1x per week peulvruchten
- Voldoende groenten minimaal 250 gram per volwassenportie, liever 350
- Volkorenproducten waar mogelijk
- Voldoende vezels (8-12g per portie)
- Let op ijzer en magnesium (belangrijk voor kinderen)

### Menu structuur
Het weekmenu loopt van donderdag t/m woensag (7 dagen). Elke dag een ander type maaltijd uit: pasta, rijst, wrap, oven, salade, vrij. Ga standaard uit van de zondag is vrij. 

### Variatie
- Varieer in keuken: Nederlands, Mediterraans, Aziatisch, Mexicaans
- Wissel af tussen snel (15-20 min) en meer uitgebreid (30-45 min). 
- Dinsdag, donderdag en vrijdag moeten altijd snel te bereiden zijn. 
- Zaterdag mag iets uitgebreider
- Recepten moeten kindvriendelijk zijn

### Kostenindex
- € = budget (onder €10 voor 4 personen)
- €€ = gemiddeld (€10-€15)
- €€€ = duurder (€15+)

### Voorkeuren deze week
[VUL HIER JE WENSEN IN, bijv: "geen vis deze week", "iets met pompoen", "liever snel doordeweeks"]

### Bibliotheek en feedback
[PLAK HIER DE TEKST VAN "Kopieer bibliotheek voor Claude" (Admin in de app): goedgekeurde recepten, wat recent gepland is, de feedback en het importformaat]

### Gevraagd formaat
Lever het menu als pure JSON (geen markdown codeblocks), in het formaat dat onderaan de geplakte bibliotheek staat:

- Kies per dag bij voorkeur een goedgekeurd recept uit de bibliotheek en verwijs ernaar met `recipe_id` (het #nummer) en `recipe_name` (precies zoals in de lijst). De app haalt recept, ingrediënten en bereidingstijd dan zelf uit de bibliotheek en controleert of naam en nummer bij elkaar horen.
- Een nieuw recept mag ook: schrijf het dan volledig uit zoals beschreven in de bibliotheek-tekst. Het komt als concept in de bibliotheek.
- Een aparte shopping_list is niet nodig — de app stelt de boodschappenlijst en voorraadcheck zelf samen uit de recepten.

```json
{
  "days": [
    {"day_name": "Donderdag", "recipe_id": 12, "recipe_name": "Linzensoep"}
  ],
  "snack_suggestions": ["Appel met pindakaas", "Komkommer met hummus"]
}
```

Genereer nu een weekmenu voor deze week.

---

## Voor de Claude-skill `weekly-menu-planner`

De skill staat in je claude.ai-account. Voeg dit blok toe onder "Eerste stap", zodat Claude de bibliotheek gebruikt als je die in het gesprek plakt:

```markdown
### Weekmenu-bibliotheek uit de app
Als de gebruiker een tekst plakt die begint met "# Weekmenu-bibliotheek", plan dan met die recepten:
- Kies per dag bij voorkeur een goedgekeurd recept en verwijs ernaar met `recipe_id` en `recipe_name` precies zoals in de lijst.
- Houd rekening met "Recent gepland" (niet herhalen) en de opmerkingen van het gezin.
- Nieuwe recepten mogen, volledig uitgeschreven in het formaat uit de geplakte tekst.
- Lever het menu als de JSON uit "Gevraagd formaat" onderaan die tekst; geen boodschappenlijst — die rekent de app zelf uit.
```
