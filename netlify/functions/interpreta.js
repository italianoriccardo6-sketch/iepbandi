// Ponte lato server tra il sito e l'intelligenza artificiale.
// La chiave NON sta qui: vive nella variabile d'ambiente ANTHROPIC_API_KEY di Netlify.
// Due modalita':
//   - "interpreta" (predefinita): estrae il profilo impresa da una frase.
//   - "dialoga": conversa proponendo SOLO i bandi reali forniti dal sito.

const SETTORI = ["Agricoltura, silvicoltura e pesca","Agroalimentare","Alberghiero","Altri servizi","Artigianato","Autoveicoli e altri mezzi di trasporto","Chimica e Farmaceutica","Commercio","Cultura","Edilizia","Elettronica","Fornitura Energia, Acqua e gestione Rifiuti","ICT","Meccanica","Metallurgia","Mobili, Legno e Carta","Moda e Tessile","Ristorazione","Salute","Servizi di trasporto","Turismo"];
const REGIONI = ["Abruzzo","Basilicata","Calabria","Campania","Emilia-Romagna","Friuli-Venezia Giulia","Lazio","Liguria","Lombardia","Marche","Molise","Piemonte","Puglia","Sardegna","Sicilia","Toscana","Trentino-Alto Adige/Südtirol","Umbria","Valle d'Aosta/Vallée d'Aoste","Veneto"];
const MODEL = "claude-haiku-4-5-20251001";
const API = "https://api.anthropic.com/v1/messages";

exports.handler = async function (event) {
  const H = { "Content-Type": "application/json; charset=utf-8" };

  // Controllo di salute: aprendo l'indirizzo nel browser si vede che il ponte e' attivo.
  if (event.httpMethod === "GET") {
    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: true, msg: "Ponte attivo" }) };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: H, body: JSON.stringify({ error: "Metodo non consentito" }) };
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { statusCode: 500, headers: H, body: JSON.stringify({ error: "Chiave non configurata" }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) {}
  const modo = body.modo || "interpreta";

  // ============ MODALITA' DIALOGA: la chat che propone i bandi reali ============
  if (modo === "dialoga") {
    const pf = body.profilo || {};
    const bandi = Array.isArray(body.bandi) ? body.bandi.slice(0, 6) : [];
    const storico = Array.isArray(body.storico) ? body.storico.slice(-12) : [];

    const profTxt = [
      "Settore: " + (pf.settore || "non indicato"),
      "Dimensione: " + (pf.dimensione || "non indicata"),
      "Regione: " + (pf.regione || "non indicata"),
      "Forme cercate: " + (Array.isArray(pf.forme) && pf.forme.length ? pf.forme.join(", ") : "qualsiasi"),
      "Investimento previsto: " + (pf.importo ? pf.importo + " euro" : "non indicato"),
      "Obiettivo: " + (pf.kw || "non indicato")
    ].join("; ");

    const lista = bandi.map(function (b, i) {
      const p = [(i + 1) + ") " + (b.t || "Bando")];
      if (b.e) p.push("Ente: " + b.e);
      if (Array.isArray(b.f) && b.f.length) p.push("Forma agevolazione: " + b.f.join(", "));
      if (b.amax) p.push("Agevolazione fino a " + b.amax + " euro");
      if (b.smax) p.push("Spesa ammessa fino a " + b.smax + " euro");
      p.push("Scadenza: " + (b.ch || "a sportello"));
      if (b.ob) p.push("Obiettivo: " + b.ob);
      return p.join(" | ");
    }).join("\n");

    const sistema =
"Sei l'assistente virtuale di Italiano & Partners, studio italiano specializzato in finanza agevolata e incentivi alle imprese. " +
"Parli in italiano, con tono professionale, caldo e concreto, come un consulente esperto che mette a proprio agio. " +
"Ti vengono forniti il profilo di un'impresa e un elenco di BANDI REALI gia' selezionati dal motore dello studio per quel profilo. " +
"Il tuo compito: presentare i bandi e spiegarne la funzionalita' (a cosa servono, cosa finanziano, che forma ha l'agevolazione, a chi convengono), rispondere alle domande dell'utente e ragionare sul suo caso. " +
"REGOLE INDEROGABILI: " +
"1) Parla SOLO dei bandi presenti nell'elenco qui sotto. Non inventarne altri, non citare importi, scadenze o requisiti che non siano nell'elenco. Se un dettaglio non c'e', dillo con onesta' e proponi di verificarlo insieme allo studio. " +
"2) Non promettere l'ottenimento del contributo ne' garantire esiti: la fattibilita' va sempre verificata dallo studio. " +
"3) Scrivi in modo discorsivo e sintetico, massimo 110 parole a risposta. Evita elenchi puntati lunghi. " +
"4) Non usare mai trattini lunghi. " +
"5) Nell'interfaccia e' sempre presente un pulsante \"Prenota una call\" che apre direttamente il calendario dello studio. Quando l'utente mostra interesse o chiede di fissare una call, confermaglielo in modo caldo e sintetico (una o due frasi al massimo) e invitalo a premere il pulsante \"Prenota una call\" che vede sullo schermo. NON chiedere come preferisce prenotare, NON offrirti di cercare recapiti, numeri di telefono o email, NON inventare contatti: al resto pensa il pulsante. " +
"PROFILO IMPRESA: " + profTxt + ". " +
"BANDI REALI DISPONIBILI:\n" + (lista || "(nessun bando fornito)");

    const seed = { role: "user", content: "Presentami in breve i bandi che hai trovato per la mia impresa e spiega a cosa serve ciascuno. Poi chiedimi su quale vuoi che approfondisca." };
    const conv = storico.map(function (m) {
      return { role: (m.ruolo === "ai" ? "assistant" : "user"), content: (m.testo || "").toString().slice(0, 1200) };
    });
    const messages = [seed].concat(conv);

    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: 420, system: sistema, messages: messages })
      });
      if (!r.ok) {
        const t = await r.text();
        return { statusCode: 502, headers: H, body: JSON.stringify({ error: "Errore AI", dettaglio: t.slice(0, 300) }) };
      }
      const data = await r.json();
      let testo = (data.content && data.content[0] && data.content[0].text) ? data.content[0].text : "";
      testo = testo.replace(/\u2014/g, ",").trim();
      if (!testo) testo = "Ho individuato alcuni bandi adatti al tuo profilo. Su quale vuoi che ti dia qualche dettaglio?";
      return { statusCode: 200, headers: H, body: JSON.stringify({ testo: testo }) };
    } catch (e) {
      return { statusCode: 500, headers: H, body: JSON.stringify({ error: "Errore ponte", dettaglio: String(e).slice(0, 200) }) };
    }
  }

  // ============ MODALITA' INTERPRETA: estrazione del profilo dalla frase ============
  let testo = "";
  try { testo = (body.testo || "").toString().slice(0, 2000); } catch (e) {}
  if (!testo.trim()) {
    return { statusCode: 400, headers: H, body: JSON.stringify({ error: "Testo mancante" }) };
  }

  const sistema =
"Sei un assistente che estrae il profilo di un'impresa italiana da una frase in linguaggio naturale, per un portale di incentivi. " +
"Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo, senza backtick. " +
"Deduci il piu' possibile in modo ragionevole (l'utente preferisce scrivere poco): se il settore o la dimensione si capiscono dal contesto, indicali. Lascia vuoto solo cio' che davvero non e' deducibile. " +
"Campi da restituire: " +
"settore (uno ESATTO tra: " + SETTORI.join(" | ") + "; oppure \"\"), " +
"dimensione (uno tra: micro | piccola | media | grande; oppure \"\"; micro fino a 9 addetti, piccola fino a 49, media fino a 249, grande oltre), " +
"regione (una ESATTA tra: " + REGIONI.join(" | ") + "; oppure \"\"), " +
"forme (array, sottoinsieme di: fondo-perduto, credito-imposta, finanziamento, garanzia, capitale-rischio, decontribuzione; [] se non emerge), " +
"importo (numero intero in euro dell'investimento previsto, oppure null), " +
"kw (una parola o brevissima frase che sintetizza l'obiettivo del progetto, es. \"ristrutturazione\", \"internazionalizzazione\", \"macchinari\"; oppure \"\"), " +
"riepilogo (una frase breve e naturale che riassume cosa hai capito, del tipo \"Ho capito: PMI del turismo in Campania che vuole ristrutturare e assumere\").";

  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 500, system: sistema, messages: [{ role: "user", content: testo }] })
    });

    if (!r.ok) {
      const t = await r.text();
      return { statusCode: 502, headers: H, body: JSON.stringify({ error: "Errore AI", dettaglio: t.slice(0, 300) }) };
    }
    const data = await r.json();
    let out = (data.content && data.content[0] && data.content[0].text) ? data.content[0].text : "{}";
    out = out.replace(/```json/gi, "").replace(/```/g, "").trim();
    let campi;
    try { campi = JSON.parse(out); }
    catch (e) { return { statusCode: 502, headers: H, body: JSON.stringify({ error: "Risposta AI non leggibile" }) }; }

    campi.settore    = SETTORI.includes(campi.settore) ? campi.settore : "";
    campi.dimensione = ["micro","piccola","media","grande"].includes(campi.dimensione) ? campi.dimensione : "";
    campi.regione    = REGIONI.includes(campi.regione) ? campi.regione : "";
    campi.forme      = Array.isArray(campi.forme) ? campi.forme.filter(f => ["fondo-perduto","credito-imposta","finanziamento","garanzia","capitale-rischio","decontribuzione"].includes(f)) : [];
    campi.importo    = (typeof campi.importo === "number" && campi.importo > 0) ? Math.round(campi.importo) : null;
    campi.kw         = (typeof campi.kw === "string") ? campi.kw.slice(0, 60) : "";
    campi.riepilogo  = (typeof campi.riepilogo === "string") ? campi.riepilogo.slice(0, 240) : "";

    return { statusCode: 200, headers: H, body: JSON.stringify(campi) };
  } catch (e) {
    return { statusCode: 500, headers: H, body: JSON.stringify({ error: "Errore ponte", dettaglio: String(e).slice(0, 200) }) };
  }
};
