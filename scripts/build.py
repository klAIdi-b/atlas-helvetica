#!/usr/bin/env python3
"""Construit les données du site à partir des fichiers de data-src/.

Étapes
1. Télécharge (une seule fois) les limites communales de 1850 publiées par l'OFS.
2. Simplifie le fond communal en conservant la topologie (mapshaper).
3. Pour chaque date de data-src/dates/, attribue chaque commune à un territoire
   selon les règles (commune > district > canton), vérifie la couverture,
   fusionne les communes par territoire et écrit la carte de la date.
4. Calcule superficies, nombre de communes et changements entre dates.
5. Écrit docs/data/*.json et copie Leaflet dans docs/vendor/.

Usage: python3 scripts/build.py   (depuis la racine du dépôt)
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

import geopandas as gpd

RACINE = Path(__file__).resolve().parent.parent
CACHE = RACINE / ".cache"
SRC = RACINE / "data-src"
SITE = RACINE / "docs"
SORTIE = SITE / "data"
MAPSHAPER = RACINE / "node_modules" / ".bin" / "mapshaper"

GPKG_URL = (
    "https://data.geo.admin.ch/ch.bfs.historisierte-administrative_grenzen_g0/"
    "historisierte-administrative_grenzen_g0_1850-01-01/"
    "historisierte-administrative_grenzen_g0_1850-01-01_2056.gpkg"
)
GPKG = CACHE / "communes_1850.gpkg"
COUCHE = "Communes_G0_18500101"

CATEGORIES = {"canton", "allie", "bailliage-commun", "etranger", "autre"}
CHAMPS_TEXTE = ("nom", "regime", "chef_lieu", "langues", "religion", "dirigeants", "resume")
INTERDITS = ("—",)  # tiret quadratin
SIMPLIFICATION = "12%"


def erreur(msg: str) -> None:
    print(f"ERREUR {msg}", file=sys.stderr)
    sys.exit(1)


def telecharger_fond() -> None:
    if GPKG.exists():
        return
    CACHE.mkdir(exist_ok=True)
    print("Téléchargement des communes de 1850 (OFS)...")
    urllib.request.urlretrieve(GPKG_URL, GPKG)


def mapshaper(*args: str) -> None:
    if not MAPSHAPER.exists():
        erreur("mapshaper introuvable, lancez d'abord `npm install`.")
    subprocess.run([str(MAPSHAPER), "-quiet", *args], check=True)


def preparer_fond() -> gpd.GeoDataFrame:
    """Renvoie toutes les entités (communes, lacs, étranger) simplifiées, en WGS84."""
    simplifie = CACHE / f"fond_simplifie_{SIMPLIFICATION.rstrip('%')}.geojson"
    brut = gpd.read_file(GPKG, layer=COUCHE)
    brut["superficie_km2"] = brut.geometry.area / 1e6
    if not simplifie.exists():
        tmp = CACHE / "fond_wgs84.geojson"
        colonnes = ["GDEHISTID", "geometry"]
        brut[colonnes].to_crs(4326).to_file(tmp, driver="GeoJSON")
        mapshaper(
            "-i", str(tmp),
            "-simplify", SIMPLIFICATION, "keep-shapes",
            "-o", str(simplifie), "precision=0.00001", "format=geojson",
        )
    geo = gpd.read_file(simplifie)
    attributs = brut.drop(columns="geometry")
    return geo.merge(attributs, on="GDEHISTID", how="left")


def verifier_textes(objet, chemin: str) -> None:
    if isinstance(objet, str):
        for c in INTERDITS:
            if c in objet:
                erreur(f"tiret quadratin dans {chemin}: {objet[:80]}")
    elif isinstance(objet, dict):
        for k, v in objet.items():
            verifier_textes(v, f"{chemin}.{k}")
    elif isinstance(objet, list):
        for i, v in enumerate(objet):
            verifier_textes(v, f"{chemin}[{i}]")


def attribuer(fond: gpd.GeoDataFrame, regles: list[dict], date: int) -> gpd.GeoSeries:
    # Les lacs (GARTE 13) sont dessinés dans la couche de contexte, pas attribués.
    communes = fond[(fond["CODE_ISO"] == "CH") & (fond["GARTE"] != 13)]
    par_canton, par_district, par_commune = {}, {}, {}
    for r in regles:
        niveau, cle, t = r["niveau"], r["cle"], r["territoire"]
        if niveau == "canton":
            par_canton[str(cle)] = t
        elif niveau == "district":
            par_district[int(cle)] = t
        elif niveau == "commune":
            par_commune[int(cle)] = t
        else:
            erreur(f"{date}: niveau de règle inconnu {niveau}")

    def territoire(ligne) -> str | None:
        if ligne.GDEHISTID in par_commune:
            return par_commune[ligne.GDEHISTID]
        if ligne.BEZHISTID == ligne.BEZHISTID and int(ligne.BEZHISTID) in par_district:
            return par_district[int(ligne.BEZHISTID)]
        return par_canton.get(ligne.KTKZ)

    resultat = communes.apply(territoire, axis=1)
    manquantes = communes[resultat.isna()]
    if len(manquantes):
        noms = ", ".join(manquantes.GDENAME.head(15))
        erreur(f"{date}: {len(manquantes)} entités sans territoire ({noms}...)")
    return resultat


def construire_date(fond, donnees: dict, couleurs: dict) -> tuple[dict, dict]:
    date = donnees["date"]
    verifier_textes(donnees, str(date))
    ids = {t["id"] for t in donnees["territoires"]}
    for t in donnees["territoires"]:
        if t["categorie"] not in CATEGORIES:
            erreur(f"{date}/{t['id']}: catégorie inconnue {t['categorie']}")
    for r in donnees["regles"]:
        if r["territoire"] not in ids:
            erreur(f"{date}: la règle {r} vise un territoire non décrit")

    attribution = attribuer(fond, donnees["regles"], date)
    communes = fond.loc[attribution.index].copy()
    communes["t"] = attribution
    terrestres = communes

    stats = terrestres.groupby("t").agg(
        superficie_km2=("superficie_km2", "sum"), communes=("GDEHISTID", "count")
    )
    hors = {h.get("rattachement") for h in donnees.get("hors_carte", [])}
    for t in donnees["territoires"]:
        if t["id"] not in stats.index and t["id"] not in hors:
            print(f"  attention {date}: {t['id']} n'a aucune commune et n'est pas dans hors_carte")

    tmp = CACHE / f"attribution_{date}.geojson"
    terrestres[["t", "geometry"]].to_file(tmp, driver="GeoJSON")
    carte = SORTIE / "cartes" / f"{date}.geojson"
    # dissolve2 + snap referme les interstices laissés par la simplification
    # (les lacs, absents de cette couche, sont bien plus grands que le seuil).
    mapshaper(
        "-i", str(tmp), "snap", "-dissolve2", "t", "gap-fill-area=2km2",
        "-o", str(carte), "precision=0.00001", "format=geojson",
    )

    etiquettes = points_etiquettes(terrestres)

    territoires = []
    for t in donnees["territoires"]:
        t = dict(t)
        if t["id"] in stats.index:
            t["superficie_km2"] = round(float(stats.loc[t["id"], "superficie_km2"]))
            t["communes"] = int(stats.loc[t["id"], "communes"])
            t["etiquette"] = etiquettes.get(t["id"])
        else:
            t["superficie_km2"] = None
            t["communes"] = 0
        t["couleur"] = couleur(t, couleurs)
        territoires.append(t)
    territoires.sort(key=lambda t: -(t["superficie_km2"] or 0))

    sortie = {k: v for k, v in donnees.items() if k not in ("regles", "territoires")}
    sortie["territoires"] = territoires
    sortie["superficie_totale_km2"] = round(float(stats["superficie_km2"].sum()))
    return sortie, dict(zip(terrestres["GDEHISTID"], terrestres["t"]))


def points_etiquettes(communes: gpd.GeoDataFrame) -> dict:
    """Point le plus « intérieur » de la plus grande partie de chaque territoire."""
    from shapely.ops import polylabel, unary_union

    projete = communes[["t", "geometry"]].to_crs(2056)
    points = {}
    for t, groupe in projete.groupby("t"):
        forme = unary_union(list(groupe.geometry.buffer(0)))
        if forme.geom_type == "MultiPolygon":
            forme = max(forme.geoms, key=lambda g: g.area)
        try:
            p = polylabel(forme, tolerance=200)
        except Exception:
            p = forme.representative_point()
        p = gpd.GeoSeries([p], crs=2056).to_crs(4326).iloc[0]
        points[t] = [round(p.y, 4), round(p.x, 4)]
    return points


def index_communes(fond, attributions: dict, noms: dict) -> dict:
    """Pour la recherche « Votre commune à travers les siècles »."""
    communes = fond[(fond["CODE_ISO"] == "CH") & (fond["GARTE"] != 13)].copy()
    pts = communes.geometry.to_crs(2056).representative_point().to_crs(4326)
    dates = sorted(attributions)
    ids = sorted({t for d in dates for t in attributions[d].values()})
    rang = {t: i for i, t in enumerate(ids)}
    liste = []
    for (_, c), p in zip(communes.iterrows(), pts):
        gid = c.GDEHISTID
        liste.append([
            c.GDENAME, c.KTKZ, round(p.y, 4), round(p.x, 4),
            [rang[attributions[d][gid]] for d in dates],
        ])
    liste.sort(key=lambda x: x[0])
    return {"dates": dates, "ids": ids, "noms": {str(d): noms[d] for d in dates}, "communes": liste}


def collecter_sources(sorties: list[dict]) -> list[dict]:
    vues: dict[str, dict] = {}

    def ajouter(s: dict, date: int) -> None:
        url = (s.get("url") or "").strip()
        if not url:
            return
        cle = url.rstrip("/").replace("http://", "https://")
        e = vues.setdefault(cle, {"titre": s.get("titre") or url, "url": url, "dates": set()})
        e["dates"].add(date)

    for s in sorties:
        d = s["date"]
        for src in s.get("sources_recit", []):
            ajouter(src, d)
        for t in s["territoires"]:
            for src in t.get("sources", []):
                ajouter(src, d)
        for e in s.get("evenements", []):
            for src in e.get("sources", []):
                ajouter(src, d)
    liste = [{**v, "dates": sorted(v["dates"])} for v in vues.values()]
    liste.sort(key=lambda v: v["titre"].lower())
    return liste


def voisins() -> None:
    """Pays voisins actuels, dessinés en fond neutre et sans nom (Natural Earth, domaine public)."""
    source = RACINE / "node_modules" / "world-atlas" / "countries-10m.json"
    tmp = CACHE / "voisins.geojson"
    mapshaper("-i", str(source), "-target", "countries", "-clip", "bbox=4.6,45.2,11.6,48.5", "-o", str(tmp), "format=geojson")
    data = json.loads(tmp.read_text(encoding="utf-8"))
    data["features"] = [
        {"type": "Feature", "properties": {}, "geometry": f["geometry"]}
        for f in data["features"]
        if f.get("geometry") and (f.get("properties") or {}).get("name") not in ("Switzerland", "Liechtenstein")
    ]
    tmp2 = CACHE / "voisins_filtre.geojson"
    tmp2.write_text(json.dumps(data), encoding="utf-8")
    mapshaper("-i", str(tmp2), "-o", str(SORTIE / "voisins.geojson"), "precision=0.0001", "format=geojson")


def copier_polices() -> None:
    cible = SITE / "fonts"
    cible.mkdir(exist_ok=True)
    fichiers = {
        "cormorant-garamond": ["latin-500-normal", "latin-600-normal", "latin-700-normal", "latin-500-italic"],
        "inter": ["latin-400-normal", "latin-500-normal", "latin-600-normal", "latin-700-normal"],
    }
    for famille, variantes in fichiers.items():
        for v in variantes:
            nom = f"{famille}-{v}.woff2"
            shutil.copy(RACINE / "node_modules" / "@fontsource" / famille / "files" / nom, cible / nom)


def couleur(t: dict, couleurs: dict) -> str:
    if t["id"] in couleurs["territoires"]:
        return couleurs["territoires"][t["id"]]
    palette = couleurs["palettes"].get(t["categorie"], couleurs["palettes"]["autre"])
    h = sum(ord(c) * (i + 1) for i, c in enumerate(t["id"]))
    return palette[h % len(palette)]


def changements(avant: dict, apres: dict, fond, noms_avant: dict, noms_apres: dict) -> list[dict]:
    surfaces = dict(zip(fond["GDEHISTID"], fond["superficie_km2"]))
    flux = defaultdict(lambda: [0, 0.0])
    for gid, t_apres in apres.items():
        t_avant = avant.get(gid)
        if t_avant and t_avant != t_apres:
            flux[(t_avant, t_apres)][0] += 1
            flux[(t_avant, t_apres)][1] += surfaces.get(gid, 0)
    liste = [
        {
            "de": a, "de_nom": noms_avant.get(a, a),
            "vers": b, "vers_nom": noms_apres.get(b, b),
            "communes": n, "superficie_km2": round(s),
        }
        for (a, b), (n, s) in flux.items()
        if s >= 1
    ]
    liste.sort(key=lambda x: -x["superficie_km2"])
    return liste


def contexte(fond) -> None:
    lacs = fond[fond["GARTE"] == 13].assign(type="lac", nom="Lac")
    etranger = fond[fond["CODE_ISO"] != "CH"].copy()
    noms = {"LI": "Liechtenstein", "DE": "Enclave allemande", "IT": "Enclave italienne (Campione)"}
    etranger["type"] = "etranger"
    etranger["nom"] = etranger["CODE_ISO"].map(noms)
    etranger.loc[etranger["GARTE"] == 13, "type"] = "lac"
    tous = gpd.GeoDataFrame(
        gpd.pd.concat([lacs, etranger])[["type", "nom", "geometry"]], crs=fond.crs
    )
    tmp = CACHE / "contexte.geojson"
    tous.to_file(tmp, driver="GeoJSON")
    mapshaper(
        "-i", str(tmp), "-dissolve", "type,nom",
        "-o", str(SORTIE / "contexte.geojson"), "precision=0.00001", "format=geojson",
    )


def main() -> None:
    telecharger_fond()
    (SORTIE / "cartes").mkdir(parents=True, exist_ok=True)
    fond = preparer_fond()
    couleurs = json.loads((SRC / "couleurs.json").read_text(encoding="utf-8"))
    chronologie = json.loads((SRC / "chronologie.json").read_text(encoding="utf-8"))
    verifier_textes(chronologie, "chronologie")

    fichiers = sorted(SRC.glob("dates/*.json"), key=lambda p: int(p.stem))
    precedent = None
    disponibles = []
    sorties, attributions, tous_noms = [], {}, {}
    for f in fichiers:
        donnees = json.loads(f.read_text(encoding="utf-8"))
        print(f"Date {donnees['date']}")
        sortie, attribution = construire_date(fond, donnees, couleurs)
        noms = {t["id"]: t["nom"] for t in sortie["territoires"]}
        if precedent:
            sortie["changements"] = {
                "depuis": precedent[0],
                "liste": changements(precedent[1], attribution, fond, precedent[2], noms),
            }
        (SORTIE / f"{donnees['date']}.json").write_text(
            json.dumps(sortie, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        precedent = (donnees["date"], attribution, noms)
        disponibles.append(donnees["date"])
        sorties.append(sortie)
        attributions[donnees["date"]] = attribution
        tous_noms[donnees["date"]] = {
            t["id"]: [t["nom"], t["categorie"], t["couleur"]] for t in sortie["territoires"]
        }

    for d in chronologie["dates"]:
        d["disponible"] = d["date"] in disponibles
        s = next((s for s in sorties if s["date"] == d["date"]), None)
        if s:
            d["territoires"] = sum(1 for t in s["territoires"] if t["communes"])
            d["evenements"] = len(s.get("evenements", []))
    presence: dict[str, list[int]] = defaultdict(list)
    for s in sorties:
        for t in s["territoires"]:
            if t["communes"]:
                presence[t["id"]].append(s["date"])
    chronologie["presence"] = presence
    sources = collecter_sources(sorties)
    chronologie["statistiques"] = {
        "dates": len(sorties),
        "communes": int(((fond["CODE_ISO"] == "CH") & (fond["GARTE"] == 11)).sum()),
        "fiches": sum(len(s["territoires"]) for s in sorties),
        "territoires_distincts": len({t["id"] for s in sorties for t in s["territoires"]}),
        "evenements": sum(len(s.get("evenements", [])) for s in sorties),
        "sources": len(sources),
    }
    (SORTIE / "chronologie.json").write_text(
        json.dumps(chronologie, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    (SORTIE / "sources.json").write_text(
        json.dumps(sources, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    (SORTIE / "communes.json").write_text(
        json.dumps(index_communes(fond, attributions, tous_noms), ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    contexte(fond)
    voisins()
    copier_polices()

    vendor = SITE / "vendor" / "leaflet"
    if vendor.exists():
        shutil.rmtree(vendor)
    source = RACINE / "node_modules" / "leaflet" / "dist"
    shutil.copytree(source, vendor, ignore=shutil.ignore_patterns("*.map", "*esm*", "leaflet-src.js"))
    print("Terminé.")


if __name__ == "__main__":
    main()
