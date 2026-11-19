# Atlas Helvetica

Atlas historique interactif de la Suisse. Pour chaque date clé, de l'alliance de 1291 à l'État fédéral de 1848,
la carte montre qui gouvernait chaque région : cantons, pays alliés, bailliages communs et puissances étrangères.
Chaque territoire a sa fiche (régime, chef-lieu, langues, religion, population, sources).

## Méthode

Les frontières anciennes ne sont pas redessinées à la main. Le fond de carte est celui des communes suisses
au 1er janvier 1850 (Office fédéral de la statistique). Pour chaque date, chaque commune est attribuée au territoire
dont elle relevait, selon des règles écrites par canton, par district ou par commune. Les territoires sont obtenus
en réunissant leurs communes. C'est une approximation au niveau local, signalée date par date sur le site.

## Organisation du dépôt

| Dossier | Contenu |
|---|---|
| `data-src/dates/` | Une date clé par fichier JSON : récit, fiches des territoires, règles d'attribution des communes, approximations |
| `data-src/chronologie.json` | Liste des dates clés prévues |
| `data-src/couleurs.json` | Couleur de chaque territoire |
| `scripts/build.py` | Construit les cartes et les données du site à partir de `data-src/` |
| `site/` | Le site statique publié (HTML, CSS, JavaScript, données générées) |

## Construire et lancer le site en local

Prérequis : Python 3.10 ou plus récent et Node.js 18 ou plus récent.

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
.venv/bin/python scripts/build.py
npm run serve
```

Ouvrez ensuite http://localhost:8000.

Le script télécharge une fois les limites communales de 1850 depuis data.geo.admin.ch, puis vérifie que chaque commune
est attribuée à un territoire pour chaque date. Il s'arrête avec un message clair sinon.

## Ajouter ou corriger une date

1. Modifiez ou créez `data-src/dates/<année>.json` en suivant le format des fichiers existants.
2. Relancez `scripts/build.py`.
3. Vérifiez le résultat dans le navigateur.

Toute information doit provenir d'une source citée dans la fiche. Une donnée introuvable reste vide plutôt qu'estimée.

## Licences

Code sous licence MIT. Données et textes sous licence CC BY-SA 4.0. Détails et sources dans `LICENCE-DONNEES.md`.
