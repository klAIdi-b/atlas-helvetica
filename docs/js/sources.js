/* Atlas Helvetica : page des sources. */
(function () {
  "use strict";
  var nombre = new Intl.NumberFormat("fr-CH");
  function sansAccents(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function el(tag, cls, texte) { var n = document.createElement(tag); if (cls) n.className = cls; if (texte !== undefined) n.textContent = texte; return n; }

  Promise.all([fetch("data/sources.json").then(function (r) { return r.json(); }), fetch("data/chronologie.json").then(function (r) { return r.json(); })])
    .then(function (r) {
      var sources = r[0], s = r[1].statistiques || {};
      var chiffres = document.getElementById("chiffres");
      [[s.dates, "cartes datées"], [s.communes, "communes cartographiées"], [s.fiches, "fiches de territoires"],
        [s.evenements, "événements racontés"], [s.territoires_distincts, "territoires distincts"], [s.sources, "articles du DHS cités"]].forEach(function (c) {
        var d = el("div"); d.appendChild(el("strong", "", nombre.format(c[0] || 0))); d.appendChild(el("span", "", c[1])); chiffres.appendChild(d);
      });

      var liste = document.getElementById("liste"), compte = document.getElementById("compte"), filtre = document.getElementById("filtre");
      sources.forEach(function (src) {
        var li = el("li");
        var a = el("a", "", src.titre.replace(/^DHS, /, "")); a.href = src.url; a.target = "_blank"; a.rel = "noopener";
        li.appendChild(a);
        var dates = el("span", "dates");
        src.dates.forEach(function (d) { var b = el("a", "", String(d)); b.href = "./#" + d; dates.appendChild(b); });
        li.appendChild(dates);
        li.dataset.cle = sansAccents(src.titre);
        liste.appendChild(li);
      });
      function maj() {
        var q = sansAccents(filtre.value.trim()), n = 0;
        Array.prototype.forEach.call(liste.children, function (li) { var ok = !q || li.dataset.cle.indexOf(q) >= 0; li.hidden = !ok; if (ok) n++; });
        compte.textContent = n + " article" + (n > 1 ? "s" : "") + (q ? " correspondant" + (n > 1 ? "s" : "") + " au filtre" : " au total") + ".";
      }
      filtre.addEventListener("input", maj);
      maj();
    })
    .catch(function () { document.getElementById("compte").textContent = "La liste des sources n'a pas pu être chargée."; });
})();
