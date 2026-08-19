# UniPlan — Générateur d'emploi du temps

Application web (100% client-side, aucune donnée envoyée à un serveur) qui
transforme un fichier Excel d'affectation (module / enseignant / groupes /
volume horaire) en emplois du temps complets : par jour, par semestre &
groupe, et par enseignant.

## Utilisation

1. Ouvrez `index.html` dans un navigateur (Chrome/Edge/Firefox). Une
   connexion internet est nécessaire au premier chargement pour la
   bibliothèque SheetJS (lecture/écriture Excel), chargée depuis un CDN.
2. **1 · Import** — déposez le fichier `.xlsx` d'affectation. Colonnes
   attendues : `SEMESTRE`, `Elément de module`, `Volume Horaire`,
   `Professeur`, `Nombre Heures`, `GROUPE`, `Nombre Groupes`,
   `Coordonnateurs de modules` (comme dans le fichier fourni en exemple).
3. **2 · Paramètres** — jours de la semaine, créneaux horaires (nombre et
   libellés libres), durée d'une période, plafond d'heures/jour par défaut
   (4/6/8h) et par enseignant, salles disponibles, et si les séances d'un
   module de 4h+ doivent être réparties sur des jours différents.
4. **3 · Réservations** — pour chaque enseignant, cliquez les créneaux où
   il/elle n'est pas disponible. Les créneaux déjà réservés par un autre
   enseignant restent visibles mais ne sont pas sélectionnables, pour
   éviter de bloquer le même créneau pour deux enseignants. Exportable /
   importable en JSON pour être réutilisé d'une session à l'autre.
5. **4 · Génération** — lance l'algorithme. Il essaie plusieurs
   répartitions aléatoires contraintes et garde la meilleure. Si des
   séances restent non planifiées, la page liste lesquelles — ajustez un
   plafond, ajoutez une salle ou relancez avec plus d'essais.
6. **5 · Emplois du temps** — consultez les trois vues (jour / groupe /
   enseignant), imprimez une vue, ou exportez tout dans un classeur Excel
   (`⬇ Exporter en Excel`), avec un onglet par jour, par groupe, par
   enseignant, une feuille "Séances" à plat, et une feuille "Non
   planifiées" si nécessaire.

## Algorithme (résumé)

Chaque ligne du fichier importé devient une **affectation**
(enseignant + module + semestre + groupes + heures/semaine). Une
affectation est découpée en **séances** de la durée d'une période
(`heures/semaine ÷ durée de période`), et chaque séance est dupliquée par
groupe : `4 H · A/B` = 4h enseignées au groupe A **et** 4h au groupe B
(8h/semaine pour l'enseignant), chaque séance visant une seule lettre de
groupe. Le générateur place ensuite chaque séance sur
`(jour, période, salle)` en respectant :

- pas de double-réservation enseignant, ni groupe (le conflit est vérifié
  au niveau de chaque lettre de groupe individuelle, pas seulement la
  combinaison "A/B"), ni salle ;
- le plafond d'heures/jour de l'enseignant ;
- les créneaux marqués indisponibles pour cet enseignant ;
- (optionnel) répartition des séances d'un même module sur des jours
  différents ;
- une préférence forte pour des **journées sans trou** : les séances
  d'un même groupe (et d'un même enseignant) sont regroupées en blocs
  contigus (matin complet ou après-midi complet) plutôt que dispersées
  avec un créneau vide au milieu ;
- un modèle de blocs **demi-journée d'abord** : on remplit d'abord des
  demi-journées (2 périodes) partout où c'est possible ; une journée n'est
  allongée à 6h (3 périodes) que lorsqu'aucune demi-journée n'est libre, et
  à une journée complète (4 périodes) qu'en dernier recours.

C'est une recherche heuristique (glouton + redémarrages aléatoires), pas
un solveur exact — largement suffisant pour ce volume de données. Parmi
les essais sans séance non placée, on garde celui dont les blocs
quotidiens sont les plus propres (le moins de trous et le moins de
journées pleines), avec un rapport clair des séances non placées le cas
échéant.

## Structure du projet

```
uniplan/
├── index.html            Page unique, toute la structure des 5 onglets
├── css/
│   └── styles.css        Design "tableau d'affichage horaire"
├── js/
│   ├── state.js          État central + persistance localStorage
│   ├── parser.js         Lecture/normalisation du fichier Excel importé
│   ├── reservations.js   Grille de disponibilité par enseignant
│   ├── scheduler.js      Algorithme de génération de l'emploi du temps
│   ├── render.js         Rendu des tableaux (import, résultats, réglages)
│   ├── export.js         Export du résultat en classeur Excel
│   └── app.js            Navigation et connexion des évènements
└── README.md
```

## Notes

- Aucun backend : tout s'exécute dans le navigateur, y compris la lecture
  et l'écriture des fichiers Excel (bibliothèque SheetJS).
- Les paramètres et les réservations sont sauvegardés dans le
  `localStorage` du navigateur, donc conservés d'une session à l'autre sur
  le même poste. Utilisez l'export/import JSON des réservations pour les
  transférer vers un autre poste.
- Si vous devez héberger le site sans dépendance à un CDN, téléchargez
  `xlsx.full.min.js` (SheetJS) et remplacez la balise `<script src="https://cdnjs...">`
  dans `index.html` par un chemin local, par ex. `js/lib/xlsx.full.min.js`.
