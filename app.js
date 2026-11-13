// Memoria proef 0a: video offline bewaren in de browser. Testpagina, alleen voorbeeldmateriaal (mock).
// Twee manieren van bewaren worden vergeleken:
//   opfs = bestandsopslag van de browser (Origin Private File System)
//   idb  = IndexedDB, het bestand in stukken van 8 MB
"use strict";

const MB = 1024 * 1024;
const MATEN = [50, 200, 1024];
const STUK = 8 * MB;
const $ = (id) => document.getElementById(id);
const fmt = (bytes) => (bytes == null ? "onbekend" : bytes >= 1024 * MB ? (bytes / (1024 * MB)).toFixed(2) + " GB" : (bytes / MB).toFixed(1) + " MB");

// ---------- verslag (blijft bewaard over herstarts heen) ----------
function log(regel) {
  const tijd = new Date().toLocaleString("nl-BE");
  const tekst = (localStorage.getItem("proef0a-log") || "") + `[${tijd}] ${regel}\n`;
  localStorage.setItem("proef0a-log", tekst);
  $("verslag").value = tekst;
  $("verslag").scrollTop = $("verslag").scrollHeight;
}

// ---------- IndexedDB: stukken + gegevens over elk bewaard bestand ----------
let dbBelofte;
function db() {
  dbBelofte ??= new Promise((ok, fout) => {
    const r = indexedDB.open("proef0a", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("stukken"); // sleutel: [naam, volgnummer]
      r.result.createObjectStore("meta"); // sleutel: "methode:naam"
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fout(r.error);
  });
  return dbBelofte;
}
async function tx(store, modus, werk) {
  const d = await db();
  return new Promise((ok, fout) => {
    const t = d.transaction(store, modus);
    const uit = werk(t.objectStore(store));
    t.oncomplete = () => ok(uit && "result" in uit ? uit.result : undefined);
    t.onerror = t.onabort = () => fout(t.error);
  });
}

const opslag = {
  opfs: {
    async schrijver(naam) {
      const map = await navigator.storage.getDirectory();
      const handle = await map.getFileHandle(naam, { create: true });
      const w = await handle.createWritable();
      return { schrijf: (stuk) => w.write(stuk), sluit: () => w.close(), breekAf: () => w.abort().catch(() => {}) };
    },
    async bestand(naam) {
      const map = await navigator.storage.getDirectory();
      return (await map.getFileHandle(naam)).getFile();
    },
    async wis(naam) {
      const map = await navigator.storage.getDirectory();
      await map.removeEntry(naam).catch(() => {});
    },
  },
  idb: {
    async schrijver(naam) {
      await opslag.idb.wis(naam);
      let buffer = [];
      let lengte = 0;
      let nr = 0;
      const spoel = async () => {
        const blob = new Blob(buffer, { type: "video/mp4" });
        buffer = [];
        lengte = 0;
        await tx("stukken", "readwrite", (s) => s.put(blob, [naam, nr++]));
      };
      return {
        async schrijf(stuk) {
          buffer.push(stuk);
          lengte += stuk.byteLength;
          if (lengte >= STUK) await spoel();
        },
        async sluit() {
          if (lengte > 0) await spoel();
        },
        breekAf: () => opslag.idb.wis(naam),
      };
    },
    async bestand(naam) {
      const stukken = await tx("stukken", "readonly", (s) => s.getAll(IDBKeyRange.bound([naam, 0], [naam, Infinity])));
      if (!stukken.length) throw new Error("geen stukken gevonden");
      return new Blob(stukken, { type: "video/mp4" });
    },
    async wis(naam) {
      await tx("stukken", "readwrite", (s) => s.delete(IDBKeyRange.bound([naam, 0], [naam, Infinity])));
    },
  },
};

// ---------- bronnen: waar komen de bytes vandaan ----------
async function* vanStroom(stroom) {
  const lezer = stroom.getReader();
  for (;;) {
    const { done, value } = await lezer.read();
    if (done) return;
    yield value;
  }
}
// Gesimuleerd bestand: korte echte voorbeeldvideo + een opvulblok ("free"-blok in MP4) tot de gevraagde grootte.
// Het resultaat is een geldig, afspeelbaar MP4-bestand van precies de gevraagde grootte.
async function* gesimuleerd(doelBytes) {
  const basis = new Uint8Array(await (await fetch("basis.mp4")).arrayBuffer());
  yield basis;
  const vul = doelBytes - basis.byteLength;
  const kop = new Uint8Array(8);
  new DataView(kop.buffer).setUint32(0, vul);
  kop.set([0x66, 0x72, 0x65, 0x65], 4); // "free"
  yield kop;
  let rest = vul - 8;
  const blok = new Uint8Array(4 * MB);
  for (let i = 0; i < blok.length; i += 65536) crypto.getRandomValues(blok.subarray(i, i + 65536));
  let teller = 0;
  while (rest > 0) {
    new DataView(blok.buffer).setUint32(0, teller++); // elk blok net anders
    const deel = rest >= blok.length ? blok.slice() : blok.slice(0, rest);
    rest -= deel.byteLength;
    yield deel;
  }
}

async function proefsom(blob) {
  // Snelle controle: vingerafdruk van de eerste en de laatste MB.
  const delen = [blob.slice(0, MB), blob.slice(Math.max(0, blob.size - MB))];
  const bytes = new Uint8Array(await new Blob(delen).arrayBuffer());
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let bezig = false;
async function bewaar(methode, naam, bron, verwachteBytes, bronTekst) {
  if (bezig) throw new Error("er loopt al een opdracht");
  bezig = true;
  $("bezig").hidden = false;
  const start = performance.now();
  let geschreven = 0;
  let schrijver;
  try {
    schrijver = await opslag[methode].schrijver(naam);
    let laatste = 0;
    for await (const stuk of bron) {
      await schrijver.schrijf(stuk);
      geschreven += stuk.byteLength;
      const nu = performance.now();
      if (nu - laatste > 200) {
        laatste = nu;
        $("voortgang").value = verwachteBytes ? geschreven / verwachteBytes : 0;
        $("bezigTekst").textContent = `${naam} bewaren: ${fmt(geschreven)}${verwachteBytes ? " van " + fmt(verwachteBytes) : ""}`;
      }
    }
    await schrijver.sluit();
    const ms = Math.round(performance.now() - start);
    const blob = await opslag[methode].bestand(naam);
    const meta = { methode, naam, grootte: geschreven, bron: bronTekst, som: await proefsom(blob), bewaardOp: new Date().toISOString(), ms };
    await tx("meta", "readwrite", (s) => s.put(meta, `${methode}:${naam}`));
    log(`BEWAARD ${naam} via ${methode}: ${fmt(geschreven)} in ${(ms / 1000).toFixed(1)} s (${(geschreven / MB / (ms / 1000)).toFixed(0)} MB/s), bron: ${bronTekst}`);
    return meta;
  } catch (e) {
    await schrijver?.breekAf?.();
    await opslag[methode].wis(naam).catch(() => {});
    const vol = e && (e.name === "QuotaExceededError" || /quota/i.test(e.message));
    log(`MISLUKT ${naam} via ${methode} na ${fmt(geschreven)}: ${vol ? "OPSLAG VOL (browser weigert meer ruimte)" : e.name + ": " + e.message}`);
    throw e;
  } finally {
    bezig = false;
    $("bezig").hidden = true;
    await toonAlles();
  }
}

async function lijst() {
  const d = await db();
  return new Promise((ok, fout) => {
    const r = d.transaction("meta").objectStore("meta").getAll();
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fout(r.error);
  });
}

async function controleer() {
  const uit = [];
  for (const m of await lijst()) {
    let staat;
    try {
      const blob = await opslag[m.methode].bestand(m.naam);
      if (blob.size !== m.grootte) staat = `FOUT: grootte ${fmt(blob.size)} in plaats van ${fmt(m.grootte)}`;
      else if ((await proefsom(blob)) !== m.som) staat = "FOUT: inhoud wijkt af";
      else staat = "OK";
    } catch (e) {
      staat = `WEG: ${e.message}`;
    }
    uit.push({ ...m, staat });
    log(`CONTROLE ${m.naam} via ${m.methode} (${fmt(m.grootte)}, bewaard ${new Date(m.bewaardOp).toLocaleString("nl-BE")}): ${staat}`);
  }
  if (!uit.length) log("CONTROLE: er staan geen bestanden (nooit bewaard, of de opslag is gewist)");
  await toonLijst(uit);
  return uit;
}

async function wis(methode, naam) {
  await opslag[methode].wis(naam);
  await tx("meta", "readwrite", (s) => s.delete(`${methode}:${naam}`));
  await toonAlles();
}

// Afspeeltest: laden, naar 90 % springen, 2 seconden afspelen.
let vorigeUrl;
async function speel(methode, naam) {
  const video = $("video");
  const start = performance.now();
  const uit = { methode, naam, online: navigator.onLine };
  try {
    const blob = await opslag[methode].bestand(naam);
    if (vorigeUrl) URL.revokeObjectURL(vorigeUrl);
    vorigeUrl = URL.createObjectURL(blob);
    video.hidden = false;
    const wacht = (gebeurtenis, ms = 20000) =>
      new Promise((ok, fout) => {
        const klok = setTimeout(() => fout(new Error(`geen "${gebeurtenis}" binnen ${ms / 1000} s`)), ms);
        video.addEventListener(gebeurtenis, () => (clearTimeout(klok), ok()), { once: true });
        video.addEventListener("error", () => (clearTimeout(klok), fout(new Error(video.error?.message || "video kan niet afgespeeld worden"))), { once: true });
      });
    const geladen = wacht("loadeddata");
    video.src = vorigeUrl;
    await geladen;
    uit.laadMs = Math.round(performance.now() - start);
    uit.duurS = Math.round(video.duration);
    const t1 = performance.now();
    const gesprongen = wacht("seeked");
    video.currentTime = video.duration * 0.9;
    await gesprongen;
    uit.springMs = Math.round(performance.now() - t1);
    const beginpunt = video.currentTime;
    await video.play();
    await new Promise((r) => setTimeout(r, 2000));
    uit.speelt = video.currentTime > beginpunt + 0.5;
    video.pause();
    video.currentTime = 0;
    log(`AFSPELEN ${naam} via ${methode} (${navigator.onLine ? "online" : "OFFLINE"}): ${uit.speelt ? "OK" : "SPEELT NIET"}, laden ${uit.laadMs} ms, sprong naar 90 % ${uit.springMs} ms, videoduur ${uit.duurS} s`);
  } catch (e) {
    uit.fout = e.message;
    log(`AFSPELEN ${naam} via ${methode}: MISLUKT (${e.message})`);
  }
  $("speelUitslag").innerHTML = uit.fout
    ? `<span class="fout">Afspelen mislukt: ${uit.fout}</span>`
    : `<span class="${uit.speelt ? "goed" : "fout"}">${naam}: ${uit.speelt ? "speelt af" : "speelt niet"}</span> <small>(laden ${uit.laadMs} ms, sprong ${uit.springMs} ms)</small>`;
  return uit;
}

// ---------- toestel en opslagruimte ----------
async function status() {
  const s = {
    browser: navigator.userAgent,
    geheugenGB: navigator.deviceMemory ?? null,
    online: navigator.onLine,
    geinstalleerd: matchMedia("(display-mode: standalone)").matches || navigator.standalone === true,
    serviceWorker: "serviceWorker" in navigator ? (navigator.serviceWorker.controller ? "actief" : "nog niet actief") : "niet ondersteund",
    opfs: !!navigator.storage?.getDirectory,
    idb: !!window.indexedDB,
  };
  if (navigator.storage?.estimate) {
    const e = await navigator.storage.estimate();
    s.gebruikt = e.usage ?? null;
    s.toegestaan = e.quota ?? null;
  }
  s.blijvend = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  return s;
}
async function toonToestel() {
  const s = await status();
  const rij = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
  const janee = (v, ja = "ja", nee = "nee") => (v == null ? "onbekend" : v ? `<span class="goed">${ja}</span>` : `<span class="waarsch">${nee}</span>`);
  $("toestel").innerHTML =
    rij("Verbinding", s.online ? "online" : '<span class="goed">offline</span>') +
    rij("Pagina werkt offline", s.serviceWorker === "actief" ? '<span class="goed">ja</span>' : `<span class="waarsch">${s.serviceWorker} (herlaad één keer)</span>`) +
    rij("Geïnstalleerd als app", janee(s.geinstalleerd, "ja", "nee, open in browser")) +
    rij("Ruimte die de browser toestaat", fmt(s.toegestaan)) +
    rij("Daarvan in gebruik", fmt(s.gebruikt)) +
    rij("Blijvende opslag", janee(s.blijvend, "toegekend", "niet toegekend (browser mag wissen bij plaatsgebrek)")) +
    rij("Bestandsopslag (OPFS)", janee(s.opfs, "beschikbaar", "niet beschikbaar")) +
    rij("Werkgeheugen (schatting)", s.geheugenGB ? s.geheugenGB + " GB" : "onbekend") +
    rij("Browser", s.browser);
  return s;
}
async function logStatus(titel) {
  const s = await status();
  log(`${titel}: toegestaan ${fmt(s.toegestaan)}, in gebruik ${fmt(s.gebruikt)}, blijvende opslag ${s.blijvend ? "JA" : "NEE"}, ${s.online ? "online" : "OFFLINE"}, als app: ${s.geinstalleerd ? "ja" : "nee"}, OPFS: ${s.opfs ? "ja" : "nee"}, offline-pagina: ${s.serviceWorker}`);
  log(`BROWSER: ${s.browser}`);
  return s;
}

async function toonLijst(metStaat) {
  const items = metStaat ?? (await lijst());
  const el = $("lijst");
  if (!items.length) return void (el.innerHTML = "<small>Nog niets bewaard.</small>");
  el.innerHTML = "";
  for (const m of items) {
    const rij = document.createElement("div");
    rij.className = "rij";
    const staat = m.staat ? `<span class="${m.staat === "OK" ? "goed" : "fout"}">${m.staat === "OK" ? "aanwezig en intact" : m.staat}</span>` : "";
    rij.innerHTML = `<b>${m.naam}</b> <small>${fmt(m.grootte)} · ${m.methode === "opfs" ? "OPFS" : "IndexedDB"} · ${new Date(m.bewaardOp).toLocaleString("nl-BE")}</small> ${staat}`;
    const speelKnop = Object.assign(document.createElement("button"), { textContent: "Speel af", onclick: () => speel(m.methode, m.naam) });
    const wisKnop = Object.assign(document.createElement("button"), { textContent: "Wis", onclick: () => wis(m.methode, m.naam) });
    rij.append(speelKnop, wisKnop);
    el.append(rij);
  }
}
async function toonAlles() {
  await toonToestel();
  await toonLijst();
}

// ---------- knoppen ----------
const naamVoor = (mb) => (mb >= 1024 ? "test-1gb.mp4" : `test-${mb}mb.mp4`);
async function maakOpToestel(methode, mb) {
  return bewaar(methode, naamVoor(mb), gesimuleerd(mb * MB), mb * MB, "gesimuleerd (voorbeeldvideo + opvulling)");
}
async function downloadVanServer(methode, mb) {
  const antwoord = await fetch(`testvideos/${naamVoor(mb)}`);
  if (!antwoord.ok) {
    log(`DOWNLOAD ${naamVoor(mb)}: staat niet op de server (${antwoord.status}). Gebruik "Maak op toestel".`);
    throw new Error("niet op de server");
  }
  const lengte = Number(antwoord.headers.get("content-length")) || 0;
  return bewaar(methode, naamVoor(mb), vanStroom(antwoord.body), lengte, "echte testvideo van de server");
}

function bouwKnoppen() {
  for (const mb of MATEN) {
    const rij = document.createElement("div");
    rij.className = "rij";
    rij.innerHTML = `<b>${mb >= 1024 ? "1 GB" : mb + " MB"}</b>`;
    const veilig = (f) => () => f($("methode").value, mb).catch(() => {});
    rij.append(
      Object.assign(document.createElement("button"), { textContent: "Maak op toestel", className: "hoofd", onclick: veilig(maakOpToestel) }),
      Object.assign(document.createElement("button"), { textContent: "Download", onclick: veilig(downloadVanServer) }),
    );
    $("maten").append(rij);
  }
  $("eigen").onchange = (e) => {
    const f = e.target.files[0];
    if (f) bewaar($("methode").value, "eigen-" + f.name, vanStroom(f.stream()), f.size, "eigen bestand").catch(() => {});
  };
  $("persist").onclick = async () => {
    const gelukt = navigator.storage?.persist ? await navigator.storage.persist() : false;
    log(`BLIJVENDE OPSLAG aangevraagd: ${gelukt ? "TOEGEKEND" : "NIET toegekend"}`);
    await logStatus("OPSLAG");
    await toonAlles();
  };
  $("vernieuw").onclick = async () => {
    await logStatus("OPSLAG");
    await toonAlles();
  };
  $("controleer").onclick = async () => {
    await logStatus("OPSLAG");
    await controleer();
  };
  $("wisalles").onclick = async () => {
    if (!confirm("Alle bewaarde testbestanden wissen?")) return;
    for (const m of await lijst()) await wis(m.methode, m.naam);
    log("ALLES GEWIST");
  };
  $("kopieer").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("verslag").value);
      $("kopieer").textContent = "Gekopieerd";
    } catch {
      $("verslag").select();
    }
  };
  $("wislog").onclick = () => {
    localStorage.removeItem("proef0a-log");
    $("verslag").value = "";
  };
}

// Voor de automatische test op de laptop.
window.proef = { status, maakOpToestel, downloadVanServer, controleer, speel, lijst, wis };

(async () => {
  bouwKnoppen();
  $("verslag").value = localStorage.getItem("proef0a-log") || "";
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("sw.js");
      await navigator.serviceWorker.ready;
    } catch (e) {
      log(`SERVICE WORKER mislukt: ${e.message}`);
    }
  }
  await logStatus("PAGINA GEOPEND");
  await toonAlles();
  addEventListener("online", toonToestel);
  addEventListener("offline", toonToestel);
  navigator.serviceWorker?.addEventListener("controllerchange", toonToestel);
})();
