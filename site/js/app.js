/* Atlas Helvetica: logique de la page (sans dépendance autre que Leaflet). */
(function () {
  "use strict";

  var CATEGORIES = {
    "canton": { libelle: "Cantons", singulier: "Canton", opacite: 0.78 },
    "allie": { libelle: "Pays alliés", singulier: "Pays allié", opacite: 0.5 },
    "bailliage-commun": { libelle: "Bailliages communs", singulier: "Bailliage commun", opacite: 0.85 },
    "etranger": { libelle: "Puissances étrangères", singulier: "Puissance étrangère", opacite: 0.55 },
    "autre": { libelle: "Autres territoires", singulier: "Autre territoire", opacite: 0.6 }
  };
  var ORDRE = ["canton", "allie", "bailliage-commun", "etranger", "autre"];

  var etat = {
    chronologie: [],
    disponibles: [],
    date: null,
    donnees: null,
    selection: null,
    cache: {}
  };

  var $ = function (id) { return document.getElementById(id); };
  var nombre = new Intl.NumberFormat("fr-CH");

  function el(tag, attrs, enfants) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "texte") n.textContent = attrs[k];
      else if (k === "classe") n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (enfants || []).forEach(function (e) { if (e) n.appendChild(typeof e === "string" ? document.createTextNode(e) : e); });
    return n;
  }

  function lien(source) {
    return el("a", { href: source.url, target: "_blank", rel: "noopener", texte: source.titre });
  }

  /* Carte */
  var carte = L.map("carte", {
    zoomSnap: 0.1, zoomDelta: 0.5, minZoom: 6, maxZoom: 12, attributionControl: true, renderer: L.svg({ padding: 0.5 })
  });
  carte.attributionControl.setPrefix(false);
  carte.attributionControl.addAttribution("Fond communal 1850 © OFS · Textes d'après le DHS (CC BY-SA)");
  var LIMITES = L.latLngBounds([45.80, 5.95], [47.82, 10.50]);
  carte.fitBounds(LIMITES, { padding: [12, 12] });  carte.setMaxBounds(LIMITES.pad(0.35));

  var BoutonVue = L.Control.extend({
    options: { position: "topleft" },
    onAdd: function () {
      var div = L.DomUtil.create("div", "leaflet-bar");
      var a = L.DomUtil.create("a", "", div);
      a.href = "#";
      a.title = "Vue d'ensemble";
      a.setAttribute("role", "button");
      a.setAttribute("aria-label", "Revenir à la vue d'ensemble");
      a.textContent = "⌂";
      L.DomEvent.on(a, "click", function (e) {
        L.DomEvent.preventDefault(e);
        carte.flyToBounds(LIMITES, { padding: [12, 12], duration: 0.6 });
      });
      return div;
    }
  });
  new BoutonVue().addTo(carte);

  var coucheTerritoires = null;
  var coucheContexte = null;
  var calques = {};

  function svgDefs() {
    var svg = carte.getPanes().overlayPane.querySelector("svg");
    if (!svg) return null;
    var defs = svg.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      svg.insertBefore(defs, svg.firstChild);
    }
    return defs;
  }

  function hachure(couleur) {
    var id = "h-" + couleur.replace("#", "");
    var defs = svgDefs();
    if (defs && !defs.querySelector("#" + id)) {
      var ns = "http://www.w3.org/2000/svg";
      var p = document.createElementNS(ns, "pattern");
      p.setAttribute("id", id);
      p.setAttribute("patternUnits", "userSpaceOnUse");
      p.setAttribute("width", "7");
      p.setAttribute("height", "7");
      p.setAttribute("patternTransform", "rotate(45)");
      var fond = document.createElementNS(ns, "rect");
      fond.setAttribute("width", "7"); fond.setAttribute("height", "7"); fond.setAttribute("fill", couleur);
      var raie = document.createElementNS(ns, "rect");
      raie.setAttribute("width", "2.5"); raie.setAttribute("height", "7"); raie.setAttribute("fill", "rgba(255,255,255,.6)");
      p.appendChild(fond); p.appendChild(raie);
      defs.appendChild(p);
    }
    return "url(#" + id + ")";
  }

  function territoire(id) {
    return etat.donnees && etat.donnees.territoires.find(function (t) { return t.id === id; });
  }

  function style(feature) {
    var t = territoire(feature.properties.t) || { categorie: "autre", couleur: "#bbb" };
    var cat = CATEGORIES[t.categorie] || CATEGORIES.autre;
    var choisi = etat.selection === t.id;
    return {
      color: choisi ? "#1f2a3a" : getComputedStyle(document.documentElement).getPropertyValue("--contour").trim() || "#fff",
      weight: choisi ? 3 : 1,
      dashArray: t.categorie === "allie" && !choisi ? "4 3" : null,
      fillColor: t.categorie === "bailliage-commun" ? hachure(t.couleur) : t.couleur,
      fillOpacity: choisi ? Math.min(1, cat.opacite + 0.15) : cat.opacite
    };
  }

  function dessinerContexte(geojson) {
    var css = getComputedStyle(document.documentElement);
    coucheContexte = L.geoJSON(geojson, {
      interactive: true,
      style: function (f) {
        var lac = f.properties.type === "lac";
        return {
          color: lac ? css.getPropertyValue("--lac").trim() : "#999",
          weight: lac ? 0.5 : 0.8,
          fillColor: lac ? css.getPropertyValue("--lac").trim() : css.getPropertyValue("--etranger").trim(),
          fillOpacity: lac ? 1 : 0.9
        };
      },
      onEachFeature: function (f, couche) {
        if (f.properties.type === "etranger") couche.bindTooltip(f.properties.nom + " (hors de la carte historique)", { sticky: true });
        else couche.options.interactive = false;
      }
    });
  }

  function dessinerTerritoires(geojson) {
    if (coucheTerritoires) carte.removeLayer(coucheTerritoires);
    calques = {};
    coucheTerritoires = L.geoJSON(geojson, {
      style: style,
      onEachFeature: function (f, couche) {
        var t = territoire(f.properties.t);
        calques[f.properties.t] = couche;
        couche.bindTooltip(t ? t.nom : f.properties.t, { sticky: true, className: "etiquette" });
        couche.on({
          click: function () { choisir(f.properties.t, true); },
          mouseover: function () { couche.setStyle({ weight: 2.5, color: "#1f2a3a" }); couche.bringToFront(); },
          mouseout: function () { coucheTerritoires.resetStyle(couche); if (etat.selection) calques[etat.selection] && calques[etat.selection].bringToFront(); }
        });
      }
    }).addTo(carte);
    // Les motifs de hachure ont besoin du conteneur SVG: on restyle une fois qu'il existe.
    coucheTerritoires.setStyle(style);
    if (coucheContexte) { carte.removeLayer(coucheContexte); coucheContexte.addTo(carte); coucheContexte.bringToFront(); }
  }

  /* Frise */
  function construireFrise() {
    var frise = $("frise");
    frise.textContent = "";
    var epilogue = false;
    etat.chronologie.forEach(function (d) {
      if (d.epilogue && !epilogue) {
        epilogue = true;
        frise.appendChild(el("span", { classe: "frise-separateur", "aria-hidden": "true" }));
      }
      var b = el("button", {
        classe: "frise-date" + (d.epilogue ? " epilogue" : ""),
        "data-date": d.date,
        title: d.disponible ? d.titre : d.titre + " (en préparation)"
      }, [el("strong", { texte: String(d.date) }), el("small", { texte: d.titre })]);
      if (!d.disponible) b.disabled = true;
      b.addEventListener("click", function () { allerA(d.date); });
      frise.appendChild(b);
    });
  }

  function majFrise() {
    document.querySelectorAll(".frise-date").forEach(function (b) {
      var actif = Number(b.dataset.date) === etat.date;
      b.setAttribute("aria-current", actif ? "true" : "false");
      if (actif) b.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    });
    var i = etat.disponibles.indexOf(etat.date);
    $("precedent").disabled = i <= 0;
    $("suivant").disabled = i >= etat.disponibles.length - 1;
  }

  /* Panneau de gauche */
  function afficherDate() {
    var d = etat.donnees;
    var chrono = etat.chronologie.find(function (c) { return c.date === d.date; }) || {};
    $("date-annee").textContent = d.date;
    $("date-nom").textContent = d.titre || chrono.titre || "";
    $("carte-annee").textContent = d.date;
    $("date-recit").textContent = d.recit || "";
    document.title = d.date + " · " + (d.titre || "") + " · Atlas Helvetica";

    $("fiabilite-confiance").textContent = d.confiance || "";
    var approx = $("fiabilite-approx");
    approx.textContent = "";
    (d.approximations || []).forEach(function (a) { approx.appendChild(el("li", { texte: a })); });
    $("fiabilite").hidden = !d.confiance && !(d.approximations || []).length;

    var src = $("date-sources");
    src.textContent = "";
    if ((d.sources_recit || []).length) {
      src.appendChild(document.createTextNode("Sources : "));
      d.sources_recit.forEach(function (s, i) {
        if (i) src.appendChild(document.createTextNode(", "));
        src.appendChild(lien(s));
      });
    }

    var total = d.superficie_totale_km2 || 1;
    $("qui-sous-titre").textContent = "Territoires représentés en " + d.date + ", par superficie (en % de la carte).";
    var liste = $("liste-territoires");
    liste.textContent = "";
    ORDRE.forEach(function (cat) {
      var membres = d.territoires.filter(function (t) { return t.categorie === cat && t.communes > 0; });
      if (!membres.length) return;
      liste.appendChild(el("h3", { classe: "groupe-titre", texte: CATEGORIES[cat].libelle + " (" + membres.length + ")" }));
      membres.forEach(function (t) {
        var pastille = el("span", { classe: "pastille" + (cat === "bailliage-commun" ? " hachure" : "") + (cat === "allie" ? " allie" : "") });
        pastille.style.backgroundColor = t.couleur;
        var pct = Math.round(100 * t.superficie_km2 / total * 10) / 10;
        var b = el("button", { classe: "territoire-ligne", "data-id": t.id }, [
          pastille,
          el("span", { classe: "territoire-nom", texte: t.nom }),
          el("span", { classe: "territoire-surface", texte: "≈" + nombre.format(t.superficie_km2) + " km² (" + nombre.format(pct) + " %)" })
        ]);
        b.addEventListener("click", function () { choisir(t.id, true, true); });
        liste.appendChild(b);
      });
    });

    var hors = $("hors-carte");
    hors.textContent = "";
    if ((d.hors_carte || []).length) {
      var ul = el("ul");
      d.hors_carte.forEach(function (h) {
        var r = territoire(h.rattachement);
        ul.appendChild(el("li", { texte: h.nom + (r ? " (" + r.nom + ")" : "") + (h.note ? ". " + h.note : "") }));
      });
      hors.appendChild(el("div", { classe: "hors-carte" }, [el("strong", { texte: "Hors de la carte" }), ul]));
    }

    var bloc = $("bloc-changements");
    var ch = d.changements;
    if (ch && ch.liste.length) {
      bloc.hidden = false;
      $("changements-sous-titre").textContent = "Territoires qui changent de mains entre " + ch.depuis + " et " + d.date + ".";
      var ol = $("liste-changements");
      ol.textContent = "";
      ch.liste.slice(0, 10).forEach(function (c) {
        ol.appendChild(el("li", {}, [
          document.createTextNode(c.de_nom + " → "),
          el("strong", { texte: c.vers_nom }),
          el("span", { classe: "chiffres", texte: c.communes + " commune" + (c.communes > 1 ? "s" : "") + " de 1850, ≈" + nombre.format(c.superficie_km2) + " km²" })
        ]));
      });
    } else {
      bloc.hidden = true;
    }
  }

  function legende() {
    var leg = $("legende");
    leg.textContent = "";
    var presentes = {};
    etat.donnees.territoires.forEach(function (t) { if (t.communes > 0) presentes[t.categorie] = true; });
    ORDRE.forEach(function (cat) {
      if (!presentes[cat]) return;
      var p = el("span", { classe: "pastille" + (cat === "bailliage-commun" ? " hachure" : "") });
      p.style.opacity = CATEGORIES[cat].opacite;
      if (cat === "allie") p.style.border = "1.5px dashed #555";
      leg.appendChild(el("span", {}, [p, CATEGORIES[cat].singulier]));
    });
  }

  /* Fiche */
  function afficherFiche() {
    var fiche = $("fiche");
    fiche.textContent = "";
    var t = etat.selection && territoire(etat.selection);
    if (!t) {
      fiche.appendChild(el("p", { classe: "fiche-vide", texte: "Cliquez sur une région de la carte ou sur un nom de la liste pour lire sa fiche." }));
      return;
    }
    var bandeau = el("div", { classe: "fiche-bandeau" });
    bandeau.style.background = t.couleur;
    fiche.appendChild(bandeau);
    fiche.appendChild(el("span", { classe: "badge", texte: (CATEGORIES[t.categorie] || CATEGORIES.autre).singulier + " en " + etat.date }));
    fiche.appendChild(el("h2", { texte: t.nom }));

    var faits = el("dl", { classe: "fiche-faits" });
    function fait(libelle, valeur) {
      if (valeur === null || valeur === undefined || valeur === "") return;
      faits.appendChild(el("dt", { texte: libelle }));
      faits.appendChild(typeof valeur === "string" ? el("dd", { texte: valeur }) : el("dd", {}, [valeur]));
    }
    fait("Régime", t.regime);
    fait(t.categorie === "bailliage-commun" ? "Gouverné par" : "Dirigeants", t.dirigeants);
    fait("Chef-lieu", t.chef_lieu);
    fait("Langues", t.langues);
    fait("Religion", t.religion);
    if (t.population && t.population.valeur) {
      var texte = nombre.format(t.population.valeur) + " hab." +
        (t.population.annee ? " (" + t.population.annee + ")" : " (vers " + etat.date + ", année non précisée)");
      if (t.population.note) texte += ". " + t.population.note.charAt(0).toUpperCase() + t.population.note.slice(1);
      fait("Population", texte);
    } else {
      fait("Population", "Non documentée pour cette date");
    }
    if (t.superficie_km2) fait("Superficie", "≈" + nombre.format(t.superficie_km2) + " km² sur la carte");
    fiche.appendChild(faits);

    if (t.resume) fiche.appendChild(el("p", { classe: "fiche-resume", texte: t.resume }));

    var sources = (t.sources || []).slice();
    if (t.population && t.population.source && !sources.some(function (s) { return s.url === t.population.source; })) {
      sources.push({ titre: "Source du chiffre de population", url: t.population.source });
    }
    if (sources.length) {
      fiche.appendChild(el("h3", { texte: "Sources" }));
      var ul = el("ul", { classe: "fiche-sources" });
      sources.forEach(function (s) { ul.appendChild(el("li", {}, [lien(s)])); });
      fiche.appendChild(ul);
    }
  }

  function choisir(id, majUrl, centrer) {
    etat.selection = id;
    if (coucheTerritoires) coucheTerritoires.setStyle(style);
    if (id && calques[id]) {
      calques[id].bringToFront();
      if (centrer) carte.flyToBounds(calques[id].getBounds(), { maxZoom: 9, duration: 0.6, padding: [40, 40] });
    }
    document.querySelectorAll(".territoire-ligne").forEach(function (b) {
      b.setAttribute("aria-current", b.dataset.id === id ? "true" : "false");
    });
    afficherFiche();
    if (majUrl) majHash();
  }

  /* Navigation */
  function charger(url) {
    if (!etat.cache[url]) {
      etat.cache[url] = fetch(url).then(function (r) {
        if (!r.ok) throw new Error(url + " : " + r.status);
        return r.json();
      });
    }
    return etat.cache[url];
  }

  function allerA(date, selection) {
    if (etat.disponibles.indexOf(date) < 0) date = etat.disponibles[etat.disponibles.length - 1];
    return Promise.all([charger("data/" + date + ".json"), charger("data/cartes/" + date + ".geojson")]).then(function (r) {
      etat.date = date;
      etat.donnees = r[0];
      var garde = selection !== undefined ? selection : etat.selection;
      etat.selection = territoire(garde) ? garde : null;
      dessinerTerritoires(r[1]);
      afficherDate();
      legende();
      majFrise();
      choisir(etat.selection, false);
      majHash();
    });
  }

  function majHash() {
    var h = "#" + etat.date + (etat.selection ? "/" + etat.selection : "");
    if (location.hash !== h) history.replaceState(null, "", h);
  }

  function lireHash() {
    var m = location.hash.match(/^#(\d{3,4})(?:\/([a-z0-9-]+))?/);
    return m ? { date: Number(m[1]), selection: m[2] || null } : null;
  }

  function decaler(pas) {
    var i = etat.disponibles.indexOf(etat.date) + pas;
    if (i >= 0 && i < etat.disponibles.length) allerA(etat.disponibles[i]);
  }

  $("precedent").addEventListener("click", function () { decaler(-1); });
  $("suivant").addEventListener("click", function () { decaler(1); });
  document.addEventListener("keydown", function (e) {
    if (e.target.closest && e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowLeft") decaler(-1);
    if (e.key === "ArrowRight") decaler(1);
    if (e.key === "Escape") choisir(null, true);
  });
  window.addEventListener("hashchange", function () {
    var h = lireHash();
    if (h && (h.date !== etat.date || h.selection !== etat.selection)) allerA(h.date, h.selection);
  });

  Promise.all([charger("data/chronologie.json"), charger("data/contexte.geojson")]).then(function (r) {
    etat.chronologie = r[0].dates;
    etat.disponibles = etat.chronologie.filter(function (d) { return d.disponible; }).map(function (d) { return d.date; });
    dessinerContexte(r[1]);
    construireFrise();
    var h = lireHash();
    return allerA(h ? h.date : etat.disponibles[0], h ? h.selection : null);
  }).catch(function (e) {
    $("date-recit").textContent = "Les données n'ont pas pu être chargées. " + e.message;
  });
})();
