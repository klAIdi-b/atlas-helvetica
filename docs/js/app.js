/* Atlas Helvetica : logique de la page. Seule dépendance : Leaflet. */
(function () {
  "use strict";

  /* ---------- Réglages ---------- */
  var ACCUEIL = { date: 1848, territoire: "geneve" };
  var DUREE_VISITE = 11000; // ms par date pendant la visite guidée
  var CATEGORIES = {
    "canton": { libelle: "Cantons", singulier: "Canton", opacite: 0.72 },
    "allie": { libelle: "Pays alliés", singulier: "Pays allié", opacite: 0.5 },
    "bailliage-commun": { libelle: "Bailliages communs", singulier: "Bailliage commun", opacite: 0.8 },
    "etranger": { libelle: "Puissances étrangères", singulier: "Puissance étrangère", opacite: 0.55 },
    "autre": { libelle: "Autres seigneuries et États", singulier: "Seigneurie ou État", opacite: 0.58 }
  };
  var ORDRE = ["canton", "allie", "bailliage-commun", "etranger", "autre"];
  var CANTONS_1850 = { ZH: "de Zurich", BE: "de Berne", LU: "de Lucerne", UR: "d'Uri", SZ: "de Schwytz", OW: "d'Obwald", NW: "de Nidwald",
    GL: "de Glaris", ZG: "de Zoug", FR: "de Fribourg", SO: "de Soleure", BS: "de Bâle-Ville", BL: "de Bâle-Campagne", SH: "de Schaffhouse",
    AR: "d'Appenzell Rhodes-Extérieures", AI: "d'Appenzell Rhodes-Intérieures", SG: "de Saint-Gall", GR: "des Grisons", AG: "d'Argovie",
    TG: "de Thurgovie", TI: "du Tessin", VD: "de Vaud", VS: "du Valais", NE: "de Neuchâtel", GE: "de Genève" };
  var COULEURS_EPOQUES = ["#8fa8c8", "#c99a5b", "#a3271f", "#6a8f6b", "#8e7cc3", "#c9a24a"];
  var ICONES = {
    bataille: '<path d="M5 19 19 5M14 5h5v5M5 5l14 14M10 19H5v-5"/>',
    traite: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
    alliance: '<path d="M7 12l3 3 7-7"/><circle cx="12" cy="12" r="9"/>',
    conquete: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    revolution: '<path d="M12 3v6M12 15v6M3 12h6M15 12h6M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
    institution: '<path d="M3 10h18L12 4zM5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>',
    autre: '<circle cx="12" cy="12" r="4"/>'
  };

  /* ---------- Outils ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var nombre = new Intl.NumberFormat("fr-CH");
  function el(tag, attrs, enfants) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "texte") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "classe") n.className = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    (enfants || []).forEach(function (e) { if (e !== null && e !== undefined && e !== false) n.appendChild(typeof e === "string" ? document.createTextNode(e) : e); });
    return n;
  }
  function vider(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function lien(s) { return el("a", { href: s.url, target: "_blank", rel: "noopener", texte: s.titre }); }
  function icone(type) {
    return el("span", { classe: "evenement-icone", html: '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONES[type] || ICONES.autre) + "</svg>" });
  }
  function sansAccents(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function court(nom) {
    if (/^Principauté épiscopale de /i.test(nom)) return nom.replace(/^Principauté épiscopale de /i, "Évêché de ").replace(/\s*\(.*\)\s*$/, "");
    return nom
      .replace(/^(République et canton|Canton|Bailliage commun|Bailliage|Comté|Landgraviat|Principauté abbatiale|Principauté épiscopale|Principauté|Seigneurie|Ville et terres de l'évêque)\s+(de la |de l'|des |du |d'|de )/i, "")
      .replace(/\s*\(.*\)\s*$/, "");
  }
  function stockage(cle, valeur) {
    try { if (valeur === undefined) return localStorage.getItem(cle); localStorage.setItem(cle, valeur); } catch (e) { return null; }
  }

  /* ---------- État ---------- */
  var etat = {
    chrono: null, dates: [], date: null, donnees: null, selection: null,
    commune: null, communes: null, cache: {}, visite: null
  };
  function territoire(id) {
    return etat.donnees && etat.donnees.territoires.find(function (t) { return t.id === id; });
  }
  function charger(url) {
    if (!etat.cache[url]) etat.cache[url] = fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + " (" + r.status + ")");
      return r.json();
    });
    return etat.cache[url];
  }

  /* ---------- Carte ---------- */
  var LIMITES = L.latLngBounds([45.80, 5.95], [47.82, 10.50]);
  var carte = L.map("carte", { zoomSnap: 0.1, zoomDelta: 0.5, minZoom: 6, maxZoom: 13, renderer: L.svg({ padding: 0.5 }) });
  carte.attributionControl.setPrefix(false);
  carte.attributionControl.addAttribution("Communes 1850 © OFS · Relief © swisstopo · Textes d'après le DHS");
  carte.fitBounds(LIMITES, { padding: [16, 16] });
  carte.setMaxBounds(LIMITES.pad(0.5));

  carte.createPane("voisins").style.zIndex = 250;
  carte.createPane("relief").style.zIndex = 450;
  carte.getPane("relief").classList.add("leaflet-relief-pane");
  carte.createPane("lacs").style.zIndex = 460;
  carte.createPane("etiquettes").style.zIndex = 640;
  carte.getPane("etiquettes").style.pointerEvents = "none";

  L.tileLayer("https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.leichte-basiskarte_reliefschattierung/default/current/3857/{z}/{x}/{y}.png", {
    pane: "relief", bounds: LIMITES.pad(0.08), minZoom: 6, maxZoom: 13, maxNativeZoom: 16, crossOrigin: true
  }).addTo(carte);

  var BoutonVue = L.Control.extend({
    options: { position: "topleft" },
    onAdd: function () {
      var div = L.DomUtil.create("div", "leaflet-bar");
      var a = L.DomUtil.create("a", "", div);
      a.href = "#"; a.title = "Vue d'ensemble"; a.setAttribute("role", "button"); a.setAttribute("aria-label", "Revenir à la vue d'ensemble");
      a.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" style="margin-top:7px" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
      L.DomEvent.on(a, "click", function (e) { L.DomEvent.preventDefault(e); carte.flyToBounds(LIMITES, { padding: [16, 16], duration: 0.7 }); });
      return div;
    }
  });
  new BoutonVue().addTo(carte);

  var coucheTerritoires = null, coucheLacs = null, coucheEtiquettes = L.layerGroup().addTo(carte), marqueur = null;
  var calques = {};

  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  function hachure(couleur) {
    var id = "h-" + couleur.replace("#", "");
    var svg = carte.getPanes().overlayPane.querySelector("svg");
    if (svg && !svg.querySelector("#" + id)) {
      var ns = "http://www.w3.org/2000/svg";
      var defs = svg.querySelector("defs") || svg.insertBefore(document.createElementNS(ns, "defs"), svg.firstChild);
      var p = document.createElementNS(ns, "pattern");
      p.setAttribute("id", id); p.setAttribute("patternUnits", "userSpaceOnUse");
      p.setAttribute("width", "8"); p.setAttribute("height", "8"); p.setAttribute("patternTransform", "rotate(45)");
      p.innerHTML = '<rect width="8" height="8" fill="' + couleur + '"/><rect width="3" height="8" fill="rgba(255,255,255,.55)"/>';
      defs.appendChild(p);
    }
    return "url(#" + id + ")";
  }

  function style(f) {
    var t = territoire(f.properties.t) || { categorie: "autre", couleur: "#bbb" };
    var cat = CATEGORIES[t.categorie] || CATEGORIES.autre;
    var choisi = etat.selection === t.id;
    var attenue = etat.selection && !choisi;
    return {
      color: choisi ? "#16202e" : css("--contour"),
      weight: choisi ? 3.2 : 1.1,
      dashArray: t.categorie === "allie" && !choisi ? "5 4" : null,
      fillColor: t.categorie === "bailliage-commun" ? hachure(t.couleur) : t.couleur,
      fillOpacity: choisi ? Math.min(0.95, cat.opacite + 0.2) : attenue ? cat.opacite * 0.7 : cat.opacite
    };
  }

  function dessinerFond(voisins, contexte) {
    L.geoJSON(voisins, {
      pane: "voisins", interactive: false,
      style: { color: css("--voisins-trait"), weight: 0.8, fillColor: css("--voisins"), fillOpacity: 1 }
    }).addTo(carte);
    coucheLacs = L.geoJSON(contexte, {
      pane: "lacs",
      style: function (f) {
        var lac = f.properties.type === "lac";
        return { color: lac ? css("--lac") : "#9a917f", weight: lac ? 0.6 : 0.8, fillColor: lac ? css("--lac") : css("--voisins"), fillOpacity: 1 };
      },
      onEachFeature: function (f, c) {
        if (f.properties.type === "etranger") c.bindTooltip(f.properties.nom + " (hors de la carte historique)", { sticky: true, className: "survol" });
        else c.options.interactive = false;
      }
    }).addTo(carte);
  }

  function dessinerTerritoires(geojson) {
    if (coucheTerritoires) carte.removeLayer(coucheTerritoires);
    calques = {};
    coucheTerritoires = L.geoJSON(geojson, {
      style: style,
      onEachFeature: function (f, c) {
        var t = territoire(f.properties.t);
        calques[f.properties.t] = c;
        c.bindTooltip(t ? t.nom : f.properties.t, { sticky: true, className: "survol", direction: "top", offset: [0, -8] });
        c.on({
          click: function () { choisir(f.properties.t, { url: true }); },
          mouseover: function () { c.setStyle({ weight: 2.6, color: "#16202e" }); },
          mouseout: function () { coucheTerritoires.resetStyle(c); }
        });
      }
    }).addTo(carte);
    coucheTerritoires.setStyle(style);
    dessinerEtiquettes();
  }

  function seuilEtiquette() { return 1100 / Math.pow(4, carte.getZoom() - 7.6); }
  function dessinerEtiquettes() {
    coucheEtiquettes.clearLayers();
    if (!etat.donnees) return;
    var seuil = seuilEtiquette(), places = [];
    var candidats = etat.donnees.territoires.filter(function (t) {
      return t.etiquette && t.superficie_km2 && (t.superficie_km2 >= (t.categorie === "canton" ? seuil * 0.12 : seuil) || t.id === etat.selection);
    }).sort(function (a, b) { return (b.id === etat.selection) - (a.id === etat.selection) || (b.categorie === "canton") - (a.categorie === "canton") || b.superficie_km2 - a.superficie_km2; });
    var petit = window.matchMedia("(max-width: 900px)").matches;
    candidats.forEach(function (t) {
      var nom = court(t.nom);
      var taille = t.superficie_km2 > 4500 ? "grande" : t.superficie_km2 > 1200 ? "moyenne" : "petite";
      if (nom.length > 16) taille += " longue";
      var lignes = nom.length > 22 ? 2 : 1;
      var px = (petit ? { grande: 13, moyenne: 12, petite: 12 } : { grande: 17, moyenne: 14, petite: 12 })[taille.split(" ")[0]];
      var largeur = (lignes === 2 ? Math.ceil(nom.length / 2) : nom.length) * px * (/grande/.test(taille) && !/longue/.test(taille) ? 0.75 : 0.52);
      var hauteur = px * 1.15 * lignes;
      var c = carte.latLngToContainerPoint(t.etiquette);
      var boite = { g: c.x - largeur / 2 - 3, d: c.x + largeur / 2 + 3, h: c.y - hauteur / 2 - 2, b: c.y + hauteur / 2 + 2 };
      var collision = places.some(function (o) { return boite.g < o.d && boite.d > o.g && boite.h < o.b && boite.b > o.h; });
      if (collision && t.id !== etat.selection) return;
      places.push(boite);
      if (lignes === 2) nom = nom.replace(/^(\S+\s+\S+\s+\S+)\s+/, "$1<br>");
      coucheEtiquettes.addLayer(L.tooltip({ permanent: true, direction: "center", className: "etiquette-carte " + taille, pane: "etiquettes", interactive: false })
        .setLatLng(t.etiquette).setContent(nom));
    });
  }
  carte.on("zoomend", dessinerEtiquettes);

  /* ---------- Frise chronologique ---------- */
  function position(annee) {
    var n = etat.dates.length, i = etat.dates.indexOf(annee);
    if (i < 0) { i = 0; while (i < n - 1 && etat.dates[i + 1] <= annee) i++; }
    return 3 + i * (94 / Math.max(1, n - 1));
  }
  function construireFrise() {
    var epoques = vider($("frise-epoques")), pas = 94 / Math.max(1, etat.dates.length - 1);
    (etat.chrono.epoques || []).forEach(function (e, i) {
      var dedans = etat.dates.filter(function (d) { return d >= e.de && (d < e.a || (e.a >= 1979 && d <= e.a)); });
      if (!dedans.length) return;
      var g = position(dedans[0]) - pas / 2 + 0.4, d = position(dedans[dedans.length - 1]) + pas / 2 - 0.4;
      var b = el("div", { classe: "frise-epoque", title: e.nom + " (" + e.de + " à " + e.a + ")", texte: e.nom });
      b.style.left = Math.max(0, g) + "%"; b.style.width = (Math.min(100, d) - Math.max(0, g)) + "%";
      b.style.setProperty("--c", COULEURS_EPOQUES[i % COULEURS_EPOQUES.length]);
      epoques.appendChild(b);
    });
    var points = vider($("frise-points"));
    var premierEpilogue = etat.chrono.dates.filter(function (d) { return d.disponible && d.epilogue; })[0];
    etat.chrono.dates.forEach(function (d) {
      if (!d.disponible) return;
      var b = el("button", {
        type: "button", classe: "frise-point" + (d.epilogue ? " epilogue" : ""), "data-date": d.date,
        "aria-label": d.date + ", " + d.titre,
        onclick: function (e) { e.stopPropagation(); arreterVisite(); allerA(d.date); }
      }, [el("span", { classe: "annee", texte: String(d.date) }), el("span", { classe: "infobulle", texte: d.date + " · " + d.titre })]);
      b.style.left = position(d.date) + "%";
      points.appendChild(b);
    });
    if (premierEpilogue) {
      var sep = el("div", { classe: "frise-separateur", title: "Épilogue" });
      sep.style.left = (position(premierEpilogue.date) - pas / 2) + "%";
      points.parentNode.insertBefore(sep, points);
    }

    var axe = $("frise"), curseur = $("frise-curseur"), glisse = false;
    function dateLaPlusProche(x) {
      var r = axe.getBoundingClientRect(), p = (x - r.left) / r.width * 100, meilleure = etat.dates[0], ecart = 1e9;
      etat.dates.forEach(function (d) { var e = Math.abs(position(d) - p); if (e < ecart) { ecart = e; meilleure = d; } });
      return { date: meilleure, pct: Math.max(0, Math.min(100, p)) };
    }
    axe.addEventListener("pointerdown", function (e) {
      if (e.target.closest(".frise-point")) return;
      glisse = true; curseur.classList.add("glisse"); axe.setPointerCapture(e.pointerId);
      var r = dateLaPlusProche(e.clientX); curseur.style.left = r.pct + "%"; curseur.dataset.annee = r.date;
    });
    axe.addEventListener("pointermove", function (e) {
      if (!glisse) return;
      var r = dateLaPlusProche(e.clientX); curseur.style.left = r.pct + "%"; curseur.dataset.annee = r.date;
    });
    function lacher(e) {
      if (!glisse) return;
      glisse = false; curseur.classList.remove("glisse");
      arreterVisite(); allerA(dateLaPlusProche(e.clientX).date);
    }
    axe.addEventListener("pointerup", lacher);
    axe.addEventListener("pointercancel", function () { glisse = false; curseur.classList.remove("glisse"); majFrise(); });
    curseur.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); decaler(-1); }
      if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); decaler(1); }
      if (e.key === "Home") { e.preventDefault(); allerA(etat.dates[0]); }
      if (e.key === "End") { e.preventDefault(); allerA(etat.dates[etat.dates.length - 1]); }
    });
  }
  function majFrise() {
    var c = $("frise-curseur");
    c.style.left = position(etat.date) + "%";
    c.dataset.annee = etat.date;
    c.setAttribute("aria-valuenow", etat.date);
    var defile = $("frise-defile");
    if (defile.scrollWidth > defile.clientWidth) {
      var cible = position(etat.date) / 100 * defile.scrollWidth - defile.clientWidth / 2;
      defile.scrollTo({ left: Math.max(0, cible), behavior: "smooth" });
    }
    c.setAttribute("aria-valuetext", etat.date + ", " + (etat.donnees.titre || ""));
    document.querySelectorAll(".frise-point").forEach(function (p) { p.setAttribute("aria-current", Number(p.dataset.date) === etat.date ? "true" : "false"); });
    var i = etat.dates.indexOf(etat.date);
    $("precedent").disabled = i <= 0;
    $("suivant").disabled = i >= etat.dates.length - 1;
  }

  /* ---------- Panneau gauche ---------- */
  function epoqueDe(annee) {
    var e = (etat.chrono.epoques || []).filter(function (x) { return annee >= x.de && annee < x.a; })[0];
    if (!e && etat.chrono.epoques) e = etat.chrono.epoques[etat.chrono.epoques.length - 1];
    return e ? e.nom : "";
  }
  function presents() { return etat.donnees.territoires.filter(function (t) { return t.communes > 0; }); }

  function afficherDate() {
    var d = etat.donnees;
    $("date-epoque").textContent = epoqueDe(d.date);
    $("date-annee").textContent = d.date;
    $("date-nom").textContent = d.titre || "";
    $("carte-annee").textContent = d.date;
    $("carte-titre").textContent = d.titre || "";
    document.title = d.date + " · " + (d.titre || "") + " · Atlas Helvetica";

    // Chiffres
    var p = presents(), ch = vider($("chiffres"));
    var compte = function (cat) { return p.filter(function (t) { return t.categorie === cat; }).length; };
    ch.appendChild(el("div", { classe: "chiffre" }, [el("strong", { texte: String(p.length) }), el("span", { texte: "territoires sur la carte" })]));
    ch.appendChild(el("div", { classe: "chiffre" }, [el("strong", { texte: String(compte("canton")) }), el("span", { texte: compte("canton") > 1 ? "cantons" : "canton" })]));
    if (compte("bailliage-commun")) ch.appendChild(el("div", { classe: "chiffre" }, [el("strong", { texte: String(compte("bailliage-commun")) }), el("span", { texte: "bailliages communs" })]));
    if (compte("allie")) ch.appendChild(el("div", { classe: "chiffre" }, [el("strong", { texte: String(compte("allie")) }), el("span", { texte: "pays alliés" })]));
    var grand = p.slice().sort(function (a, b) { return b.superficie_km2 - a.superficie_km2; })[0];
    if (grand) {
      var pa = el("span", { classe: "pastille" }); pa.style.background = grand.couleur;
      ch.appendChild(el("button", { classe: "chiffre large", type: "button", style: "cursor:pointer;text-align:left", onclick: function () { choisir(grand.id, { url: true, centrer: true }); } },
        [pa, el("div", {}, [el("strong", { texte: court(grand.nom) }), el("span", { texte: "le plus vaste territoire, ≈" + nombre.format(grand.superficie_km2) + " km²" })])]));
    }

    $("date-recit").textContent = d.recit || "";
    $("fiabilite-confiance").textContent = d.confiance || "";
    var approx = vider($("fiabilite-approx"));
    (d.approximations || []).forEach(function (a) { approx.appendChild(el("li", { texte: a })); });
    $("fiabilite").hidden = !d.confiance && !(d.approximations || []).length;
    var src = vider($("date-sources"));
    if ((d.sources_recit || []).length) {
      src.appendChild(document.createTextNode("Sources du récit : "));
      d.sources_recit.forEach(function (s, i) { if (i) src.appendChild(document.createTextNode(", ")); src.appendChild(lien(s)); });
    }

    // Qui gouverne
    var total = d.superficie_totale_km2 || 1, max = grand ? grand.superficie_km2 : 1;
    $("pouvoirs-intro").textContent = "Les " + p.length + " territoires de " + d.date + ", par superficie (en % de la carte).";
    var liste = vider($("liste-territoires"));
    ORDRE.forEach(function (cat) {
      var membres = p.filter(function (t) { return t.categorie === cat; });
      if (!membres.length) return;
      liste.appendChild(el("h3", { classe: "groupe-titre" }, [el("span", { texte: CATEGORIES[cat].libelle }), el("span", { texte: String(membres.length) })]));
      membres.forEach(function (t) {
        var pastille = el("span", { classe: "pastille" + (cat === "bailliage-commun" ? " hachure" : "") + (cat === "allie" ? " allie" : "") });
        pastille.style.backgroundColor = t.couleur;
        var barre = el("span"); barre.style.width = Math.max(2, 100 * t.superficie_km2 / max) + "%"; barre.style.background = t.couleur;
        var pct = Math.round(1000 * t.superficie_km2 / total) / 10;
        liste.appendChild(el("button", { type: "button", classe: "territoire-ligne", "data-id": t.id, onclick: function () { choisir(t.id, { url: true, centrer: true }); } }, [
          pastille, el("span", { classe: "territoire-nom", texte: t.nom }),
          el("span", { classe: "territoire-surface", texte: nombre.format(t.superficie_km2) + " km² · " + nombre.format(pct) + " %" }),
          el("span", { classe: "barre" }, [barre])
        ]));
      });
    });
    var hors = vider($("hors-carte"));
    if ((d.hors_carte || []).length) {
      var ul = el("ul");
      d.hors_carte.forEach(function (h) {
        var r = territoire(h.rattachement);
        ul.appendChild(el("li", { texte: h.nom + (r ? " (" + r.nom + ")" : "") }));
      });
      hors.appendChild(el("div", { classe: "hors-carte" }, [el("strong", { texte: "Hors du cadre de la carte" }), ul]));
    }

    // Événements
    var ev = d.evenements || [];
    $("nb-evenements").textContent = ev.length || "";
    var prec = etat.dates[etat.dates.indexOf(d.date) - 1];
    $("evenements-intro").textContent = ev.length ? "Ce qui s'est joué " + (prec ? "entre " + prec + " et " + d.date : "jusqu'en " + d.date) + "." : "Aucun événement saisi pour cette date.";
    var le = vider($("liste-evenements"));
    ev.slice().sort(function (a, b) { return (a.annee || 0) - (b.annee || 0); }).forEach(function (e) {
      var corps = el("div", { classe: "evenement-corps" }, [el("p", { texte: e.texte })]);
      if (e.camps || e.issue) corps.appendChild(el("span", { classe: "evenement-issue" }, [
        e.camps ? el("b", { texte: e.camps }) : null, e.camps && e.issue ? document.createTextNode(". ") : null, e.issue ? document.createTextNode(e.issue + ".") : null]));
      (e.sources || []).slice(0, 2).forEach(function (s) { corps.appendChild(el("span", { classe: "evenement-source" }, [lien(s)])); });
      le.appendChild(el("li", { classe: "evenement" }, [
        icone(e.type), el("span", { classe: "evenement-date", texte: e.date_precise || String(e.annee) }),
        el("h3", { texte: e.titre }), e.lieu ? el("p", { classe: "evenement-lieu", texte: e.lieu }) : null, corps
      ]));
    });

    // Changements
    var chg = d.changements;
    $("onglet-changements").hidden = !(chg && chg.liste.length);
    if (chg && chg.liste.length) {
      $("changements-intro").textContent = "Les territoires qui changent de mains entre " + chg.depuis + " et " + d.date + ", des plus vastes aux plus petits.";
      var ol = vider($("liste-changements"));
      var couleurs = {};
      d.territoires.forEach(function (t) { couleurs[t.id] = t.couleur; });
      chg.liste.slice(0, 14).forEach(function (c) {
        var pv = el("span", { classe: "pastille" }); pv.style.background = couleurs[c.vers] || "#bbb";
        ol.appendChild(el("li", {}, [
          el("span", { classe: "fleche" }, [document.createTextNode(c.de_nom), el("span", { texte: "→", "aria-label": "passe à" }), pv, el("strong", { texte: c.vers_nom })]),
          el("span", { classe: "chiffres-ligne", texte: "≈" + nombre.format(c.superficie_km2) + " km², " + c.communes + " commune" + (c.communes > 1 ? "s" : "") + " de 1850" })
        ]));
      });
    } else if ($("onglet-changements").getAttribute("aria-selected") === "true") {
      ouvrirOnglet("onglet-recit");
    }
  }

  function legende() {
    var leg = vider($("legende")), vus = {};
    presents().forEach(function (t) { vus[t.categorie] = true; });
    ORDRE.forEach(function (cat) {
      if (!vus[cat]) return;
      var p = el("span", { classe: "pastille" + (cat === "bailliage-commun" ? " hachure" : "") + (cat === "allie" ? " allie" : "") });
      leg.appendChild(el("span", {}, [p, CATEGORIES[cat].singulier]));
    });
  }

  /* ---------- Onglets ---------- */
  function ouvrirOnglet(id) {
    document.querySelectorAll(".onglets [role=tab]").forEach(function (b) {
      var actif = b.id === id;
      b.setAttribute("aria-selected", actif ? "true" : "false");
      b.tabIndex = actif ? 0 : -1;
      $(b.getAttribute("aria-controls")).hidden = !actif;
    });
  }
  document.querySelectorAll(".onglets [role=tab]").forEach(function (b, i, tous) {
    b.addEventListener("click", function () { ouvrirOnglet(b.id); });
    b.addEventListener("keydown", function (e) {
      var visibles = Array.prototype.filter.call(tous, function (x) { return !x.hidden; });
      var j = visibles.indexOf(b);
      if (e.key === "ArrowRight") { visibles[(j + 1) % visibles.length].focus(); ouvrirOnglet(visibles[(j + 1) % visibles.length].id); }
      if (e.key === "ArrowLeft") { var k = (j - 1 + visibles.length) % visibles.length; visibles[k].focus(); ouvrirOnglet(visibles[k].id); }
    });
  });

  /* ---------- Fiche ---------- */
  function afficherFiche() {
    var fiche = vider($("fiche"));
    if (etat.commune) fiche.appendChild(blocCommune());
    var t = etat.selection && territoire(etat.selection);
    if (!t) { if (!etat.commune) fiche.appendChild(ficheAccueil()); return; }
    var cat = CATEGORIES[t.categorie] || CATEGORIES.autre;

    var bandeau = el("div", { classe: "fiche-bandeau" + (t.categorie === "bailliage-commun" ? " hachure" : "") });
    bandeau.style.backgroundColor = t.couleur;
    bandeau.appendChild(el("img", { classe: "embleme", src: "img/emblem.svg", alt: "" }));
    fiche.appendChild(bandeau);
    var c = el("div", { classe: "fiche-contenu fiche" });
    c.appendChild(el("span", { classe: "badge", texte: cat.singulier + " · " + etat.date }));
    c.appendChild(el("h2", { texte: t.nom }));
    if (t.chef_lieu) c.appendChild(el("p", { classe: "fiche-sous", texte: "Chef-lieu " + t.chef_lieu }));

    var stats = el("div", { classe: "fiche-stats" });
    if (t.superficie_km2) {
      var pct = Math.round(1000 * t.superficie_km2 / (etat.donnees.superficie_totale_km2 || 1)) / 10;
      stats.appendChild(el("div", {}, [el("strong", { texte: "≈" + nombre.format(t.superficie_km2) + " km²" }), el("span", { texte: nombre.format(pct) + " % de la carte" })]));
      stats.appendChild(el("div", {}, [el("strong", { texte: nombre.format(t.communes) }), el("span", { texte: "communes de 1850" })]));
    }
    if (t.population && t.population.valeur) {
      stats.appendChild(el("div", { style: "grid-column:1/-1" }, [
        el("strong", { texte: nombre.format(t.population.valeur) + " hab." }),
        el("span", { texte: (t.population.annee ? "en " + t.population.annee : "vers " + etat.date + ", année non précisée") + (t.population.note ? ". " + t.population.note.charAt(0).toUpperCase() + t.population.note.slice(1) : "") })
      ]));
    }
    c.appendChild(stats);

    var faits = el("dl", { classe: "fiche-faits" });
    function fait(l, v) { if (v) { faits.appendChild(el("dt", { texte: l })); faits.appendChild(el("dd", { texte: v })); } }
    fait("Régime", t.regime);
    fait(t.categorie === "bailliage-commun" ? "Gouverné par" : "Dirigeants", t.dirigeants);
    fait("Langues", t.langues);
    fait("Religion", t.religion);
    if (!(t.population && t.population.valeur)) fait("Population", "Non documentée pour cette date");
    c.appendChild(faits);
    if (t.resume) c.appendChild(el("p", { classe: "fiche-resume", texte: t.resume }));

    var presence = (etat.chrono.presence || {})[t.id] || [];
    if (presence.length > 1) {
      c.appendChild(el("h3", { texte: "À travers les siècles" }));
      var dates = el("div", { classe: "fiche-dates" });
      etat.dates.forEach(function (d) {
        var ici = presence.indexOf(d) >= 0;
        dates.appendChild(el("button", { type: "button", texte: String(d), disabled: !ici, "aria-current": d === etat.date ? "true" : "false",
          title: ici ? "Voir ce territoire en " + d : "Absent de la carte en " + d,
          onclick: function () { arreterVisite(); allerA(d, t.id); } }));
      });
      c.appendChild(dates);
    }

    var sources = (t.sources || []).slice();
    if (t.population && t.population.source && !sources.some(function (s) { return s.url === t.population.source; }))
      sources.push({ titre: "Source du chiffre de population", url: t.population.source });
    if (sources.length) {
      c.appendChild(el("h3", { texte: "Sources" }));
      var ul = el("ul", { classe: "fiche-sources" });
      sources.forEach(function (s) { ul.appendChild(el("li", {}, [lien(s)])); });
      c.appendChild(ul);
    }
    fiche.appendChild(c);
  }

  function ficheAccueil() {
    var box = el("div", { classe: "fiche-accueil" });
    box.appendChild(el("h2", { texte: "Explorer " + etat.date }));
    box.appendChild(el("p", { texte: "Cliquez sur une région de la carte pour lire son histoire. Voici les trois plus vastes territoires de cette date." }));
    presents().slice().sort(function (a, b) { return b.superficie_km2 - a.superficie_km2; }).slice(0, 3).forEach(function (t) {
      var haut = el("div", { classe: "haut" }); haut.style.background = t.couleur;
      box.appendChild(el("button", { type: "button", classe: "carte-puissance", onclick: function () { choisir(t.id, { url: true, centrer: true }); } }, [
        haut, el("div", { classe: "corps" }, [el("small", { texte: (CATEGORIES[t.categorie] || CATEGORIES.autre).singulier }), el("strong", { texte: t.nom }),
          el("span", { texte: "≈" + nombre.format(t.superficie_km2) + " km²" + (t.chef_lieu ? " · " + t.chef_lieu : "") })])
      ]));
    });
    box.appendChild(el("p", { texte: "Astuce : tapez le nom de votre commune dans la barre de recherche pour voir à qui elle appartenait à chaque époque." }));
    return box;
  }

  function blocCommune() {
    var c = etat.commune, communes = etat.communes;
    var box = el("div", { classe: "fiche-accueil", style: "border-bottom:1px solid var(--trait)" });
    box.appendChild(el("div", { style: "display:flex;justify-content:space-between;align-items:start;gap:8px" }, [
      el("div", {}, [el("span", { classe: "badge", texte: "Votre commune" }), el("h2", { style: "margin-top:10px", texte: c[0] })]),
      el("button", { type: "button", classe: "frise-bouton", "aria-label": "Fermer la commune", style: "width:32px;height:32px", html: "×",
        onclick: function () { etat.commune = null; if (marqueur) { carte.removeLayer(marqueur); marqueur = null; } afficherFiche(); } })
    ]));
    box.appendChild(el("p", { texte: "Commune du canton " + (CANTONS_1850[c[1]] || c[1]) + " en 1850. Voici à qui elle appartenait à chaque date de l'atlas." }));
    var ol = el("ol", { classe: "commune-frise" });
    communes.dates.forEach(function (d, i) {
      var id = communes.ids[c[4][i]], info = (communes.noms[String(d)] || {})[id] || [id, "autre", "#bbb"];
      var p = el("span", { classe: "pastille" + (info[1] === "bailliage-commun" ? " hachure" : "") }); p.style.background = info[2];
      ol.appendChild(el("li", { "aria-current": d === etat.date ? "true" : "false", tabindex: "0", role: "button",
        onclick: function () { arreterVisite(); allerA(d, id); },
        onkeydown: function (e) { if (e.key === "Enter") allerA(d, id); } }, [el("b", { texte: String(d) }), p, el("span", { texte: info[0] })]));
    });
    box.appendChild(ol);
    return box;
  }

  function choisir(id, o) {
    o = o || {};
    etat.selection = id || null;
    if (coucheTerritoires) coucheTerritoires.setStyle(style);
    if (id && calques[id]) {
      calques[id].bringToFront();
      if (o.centrer) carte.flyToBounds(calques[id].getBounds(), { maxZoom: 9.5, duration: 0.7, padding: [50, 50] });
    }
    document.querySelectorAll(".territoire-ligne").forEach(function (b) { b.setAttribute("aria-current", b.dataset.id === id ? "true" : "false"); });
    dessinerEtiquettes();
    afficherFiche();
    if (o.url) majHash();
  }

  /* ---------- Navigation ---------- */
  var jeton = 0;
  function allerA(date, selection) {
    if (etat.dates.indexOf(date) < 0) date = etat.dates[etat.dates.length - 1];
    var moi = ++jeton, cadre = document.querySelector(".carte-cadre");
    var changement = etat.date !== null && etat.date !== date;
    if (changement) cadre.classList.add("en-transition");
    return Promise.all([charger("data/" + date + ".json"), charger("data/cartes/" + date + ".geojson"),
      new Promise(function (r) { setTimeout(r, changement ? 180 : 0); })]).then(function (r) {
      if (moi !== jeton) return;
      etat.date = date;
      etat.donnees = r[0];
      var garde = selection !== undefined ? selection : etat.selection;
      if (etat.commune) garde = etat.communes.ids[etat.commune[4][etat.communes.dates.indexOf(date)]];
      etat.selection = territoire(garde) ? garde : null;
      dessinerTerritoires(r[1]);
      afficherDate();
      legende();
      majFrise();
      choisir(etat.selection, {});
      majHash();
      requestAnimationFrame(function () { cadre.classList.remove("en-transition"); });
    }).catch(function (e) { cadre.classList.remove("en-transition"); $("date-recit").textContent = "Les données n'ont pas pu être chargées (" + e.message + ")."; });
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
    var i = etat.dates.indexOf(etat.date) + pas;
    if (i >= 0 && i < etat.dates.length) { arreterVisite(); allerA(etat.dates[i]); }
  }
  $("precedent").addEventListener("click", function () { decaler(-1); });
  $("suivant").addEventListener("click", function () { decaler(1); });
  document.addEventListener("keydown", function (e) {
    if (e.target.closest && e.target.closest("input, textarea, select, [role=tab], [role=slider]")) return;
    if (e.key === "ArrowLeft") decaler(-1);
    if (e.key === "ArrowRight") decaler(1);
    if (e.key === "Escape") { arreterVisite(); choisir(null, { url: true }); }
  });
  window.addEventListener("hashchange", function () {
    var h = lireHash();
    if (h && (h.date !== etat.date || h.selection !== etat.selection)) allerA(h.date, h.selection);
  });

  /* ---------- Recherche de commune ---------- */
  var champ = $("recherche-commune"), sugg = $("suggestions"), resultats = [], actif = -1;
  function chargerCommunes() {
    return charger("data/communes.json").then(function (c) {
      if (!etat.communes) {
        etat.communes = c;
        c.communes.forEach(function (x) { x.cle = sansAccents(x[0]); });
      }
      return c;
    });
  }
  champ.addEventListener("focus", chargerCommunes);
  champ.addEventListener("input", function () {
    var q = sansAccents(champ.value.trim());
    if (q.length < 2) { fermerSuggestions(); return; }
    chargerCommunes().then(function (c) {
      var debut = [], milieu = [];
      c.communes.forEach(function (x) {
        var i = x.cle.indexOf(q);
        if (i === 0) debut.push(x); else if (i > 0) milieu.push(x);
      });
      resultats = debut.concat(milieu).slice(0, 12);
      actif = resultats.length ? 0 : -1;
      vider(sugg);
      if (!resultats.length) sugg.appendChild(el("li", { "aria-disabled": "true", texte: "Aucune commune trouvée" }));
      resultats.forEach(function (x, i) {
        sugg.appendChild(el("li", { role: "option", id: "sugg-" + i, "aria-selected": i === actif ? "true" : "false",
          onmousedown: function (e) { e.preventDefault(); choisirCommune(x); } }, [el("span", { texte: x[0] }), el("small", { texte: x[1] })]));
      });
      sugg.hidden = false; champ.setAttribute("aria-expanded", "true");
    });
  });
  champ.addEventListener("keydown", function (e) {
    if (sugg.hidden || !resultats.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      actif = (actif + (e.key === "ArrowDown" ? 1 : -1) + resultats.length) % resultats.length;
      Array.prototype.forEach.call(sugg.children, function (li, i) { li.setAttribute("aria-selected", i === actif ? "true" : "false"); });
      champ.setAttribute("aria-activedescendant", "sugg-" + actif);
    }
    if (e.key === "Enter" && actif >= 0) { e.preventDefault(); choisirCommune(resultats[actif]); }
    if (e.key === "Escape") fermerSuggestions();
  });
  champ.addEventListener("blur", function () { setTimeout(fermerSuggestions, 120); });
  function fermerSuggestions() { sugg.hidden = true; champ.setAttribute("aria-expanded", "false"); }
  function choisirCommune(x) {
    fermerSuggestions();
    champ.value = x[0];
    champ.blur();
    arreterVisite();
    etat.commune = x;
    if (marqueur) carte.removeLayer(marqueur);
    marqueur = L.marker([x[2], x[3]], { icon: L.divIcon({ className: "", html: '<div class="marqueur-commune"></div>', iconSize: [22, 22], iconAnchor: [11, 26] }), keyboard: false, title: x[0] }).addTo(carte);
    carte.flyTo([x[2], x[3]], 9.6, { duration: 0.8 });
    var id = etat.communes.ids[x[4][etat.communes.dates.indexOf(etat.date)]];
    choisir(id, { url: true });
    if (window.matchMedia("(max-width: 900px)").matches) $("fiche").scrollIntoView({ behavior: "smooth" });
  }

  /* ---------- Visite guidée ---------- */
  function phrases(texte, n) {
    var m = (texte || "").match(/[^.!?]+[.!?]+(\s|$)/g) || [texte || ""];
    return m.slice(0, n).join("").trim();
  }
  function lancerVisite() {
    fermerAccueil();
    etat.commune = null; if (marqueur) { carte.removeLayer(marqueur); marqueur = null; }
    etat.visite = { index: 0, pause: false, debut: 0, ecoule: 0, minuteur: null };
    $("visite-bandeau").hidden = false;
    $("visite-pause").textContent = "Pause";
    carte.flyToBounds(LIMITES, { padding: [16, 16], duration: 0.6 });
    etapeVisite();
  }
  function etapeVisite() {
    var v = etat.visite; if (!v) return;
    var d = etat.dates[v.index];
    allerA(d, null).then(function () {
      if (!etat.visite) return;
      $("visite-texte").textContent = phrases(etat.donnees.recit, 2);
      ouvrirOnglet("onglet-recit");
      v.ecoule = 0; v.debut = Date.now();
      tic();
    });
  }
  function tic() {
    var v = etat.visite; if (!v) return;
    clearTimeout(v.minuteur);
    if (v.pause) return;
    var t = v.ecoule + (Date.now() - v.debut);
    var pct = (v.index + Math.min(1, t / DUREE_VISITE)) / etat.dates.length * 100;
    $("visite-barre").style.width = pct + "%";
    if (t >= DUREE_VISITE) {
      if (v.index >= etat.dates.length - 1) { arreterVisite(); return; }
      v.index++; etapeVisite(); return;
    }
    v.minuteur = setTimeout(tic, 200);
  }
  function arreterVisite() {
    if (!etat.visite) return;
    clearTimeout(etat.visite.minuteur);
    etat.visite = null;
    $("visite-bandeau").hidden = true;
  }
  $("visite-pause").addEventListener("click", function () {
    var v = etat.visite; if (!v) return;
    if (v.pause) { v.pause = false; v.debut = Date.now(); this.textContent = "Pause"; tic(); }
    else { v.pause = true; v.ecoule += Date.now() - v.debut; this.textContent = "Reprendre"; }
  });
  $("visite-quitter").addEventListener("click", arreterVisite);
  $("bouton-visite").addEventListener("click", lancerVisite);

  /* ---------- Accueil et chiffres ---------- */
  function chiffresProjet() {
    var s = etat.chrono.statistiques || {};
    return [[s.dates, "cartes datées"], [s.communes, "communes cartographiées"], [s.fiches, "fiches de territoires"],
      [s.evenements, "événements racontés"], [s.territoires_distincts, "territoires distincts"], [s.sources, "articles du DHS cités"]];
  }
  function remplirChiffres() {
    var b = vider($("bandeau-chiffres")), a = vider($("accueil-chiffres"));
    chiffresProjet().forEach(function (c, i) {
      b.appendChild(el("div", {}, [el("strong", { texte: nombre.format(c[0] || 0) }), el("span", { texte: c[1] })]));
      if (i === 0 || i === 1 || i === 2 || i === 5) a.appendChild(el("div", {}, [el("strong", { texte: nombre.format(c[0] || 0) }), el("span", { texte: c[1] })]));
    });
  }
  function fermerAccueil() { $("accueil").hidden = true; stockage("atlas-accueil-vu", "1"); }
  $("accueil-visite").addEventListener("click", lancerVisite);
  $("accueil-explorer").addEventListener("click", fermerAccueil);
  $("accueil").addEventListener("click", function (e) { if (e.target === this) fermerAccueil(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("accueil").hidden) fermerAccueil(); });

  /* ---------- Démarrage ---------- */
  Promise.all([charger("data/chronologie.json"), charger("data/voisins.geojson"), charger("data/contexte.geojson")]).then(function (r) {
    etat.chrono = r[0];
    etat.dates = r[0].dates.filter(function (d) { return d.disponible; }).map(function (d) { return d.date; });
    dessinerFond(r[1], r[2]);
    construireFrise();
    remplirChiffres();
    var h = lireHash();
    if (!h && !stockage("atlas-accueil-vu")) $("accueil").hidden = false;
    return allerA(h ? h.date : ACCUEIL.date, h ? h.selection : ACCUEIL.territoire);
  }).catch(function (e) { $("date-recit").textContent = "Les données n'ont pas pu être chargées (" + e.message + ")."; });
})();
