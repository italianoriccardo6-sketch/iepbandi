// Ponte lato server tra il sito e l'intelligenza artificiale.
// La chiave NON sta qui: vive nella variabile d'ambiente ANTHROPIC_API_KEY di Netlify.

const SETTORI = ["Agricoltura, silvicoltura e pesca","Agroalimentare","Alberghiero","Altri servizi","Artigianato","Autoveicoli e altri mezzi di trasporto","Chimica e Farmaceutica","Commercio","Cultura","Edilizia","Elettronica","Fornitura Energia, Acqua e gestione Rifiuti","ICT","Meccanica","Metallurgia","Mobili, Legno e Carta","Moda e Tessile","Ristorazione","Salute","Servizi di trasporto","Turismo"];
const REGIONI = ["Abruzzo","Basilicata","Calabria","Campania","Emilia-Romagna","Friuli-Venezia Giulia","Lazio","Liguria","Lombardia","Marche","Molise","Piemonte","Puglia","Sardegna","Sicilia","Toscana","Trentino-Alto Adige/Südtirol","Umbria","Valle d'Aosta/Vallée d'Aoste","Veneto"];

exports.handler = async function (event) {
  const H = { "Content-Type": "application/json; charset=utf-8" };

  // Controllo di salute: aprendo l'indirizzo nel browser si vede che il ponte è attivo.
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

  let testo = "";
  try { testo = (JSON.parse(event.body || "{}").testo || "").toString().slice(0, 2000); } catch (e) {}
  if (!testo.trim()) {
    return { statusCode: 400, headers: H, body: JSON.stringify({ error: "Testo mancante" }) };
  }

  const sistema =
"Sei un assistente che estrae il profilo di un'impresa italiana da una frase in linguaggio naturale, per un portale di incentivi. " +
"Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo, senza backtick. " +
"Deduci il più possibile in modo ragionevole (l'utente preferisce scrivere poco): se il settore o la dimensione si capiscono dal contesto, indicali. Lascia vuoto solo ciò che davvero non è deducibile. " +
"Campi da restituire: " +
"settore (uno ESATTO tra: " + SETTORI.join(" | ") + "; oppure \"\"), " +
"dimensione (uno tra: micro | piccola | media | grande; oppure \"\"; micro fino a 9 addetti, piccola fino a 49, media fino a 249, grande oltre), " +
"regione (una ESATTA tra: " + REGIONI.join(" | ") + "; oppure \"\"), " +
"forme (array, sottoinsieme di: fondo-perduto, credito-imposta, finanziamento, garanzia, capitale-rischio, decontribuzione; [] se non emerge), " +
"importo (numero intero in euro dell'investimento previsto, oppure null), " +
"kw (una parola o brevissima frase che sintetizza l'obiettivo del progetto, es. \"ristrutturazione\", \"internazionalizzazione\", \"macchinari\"; oppure \"\"), " +
"riepilogo (una frase breve e naturale che riassume cosa hai capito, del tipo \"Ho capito: PMI del turismo in Campania che vuole ristrutturare e assumere\").";

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        system: sistema,
        messages: [{ role: "user", content: testo }]
      })
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

    // normalizzazione difensiva
    campi.settore   = SETTORI.includes(campi.settore) ? campi.settore : "";
    campi.dimensione = ["micro","piccola","media","grande"].includes(campi.dimensione) ? campi.dimensione : "";
    campi.regione   = REGIONI.includes(campi.regione) ? campi.regione : "";
    campi.forme     = Array.isArray(campi.forme) ? campi.forme.filter(f => ["fondo-perduto","credito-imposta","finanziamento","garanzia","capitale-rischio","decontribuzione"].includes(f)) : [];
    campi.importo   = (typeof campi.importo === "number" && campi.importo > 0) ? Math.round(campi.importo) : null;
    campi.kw        = (typeof campi.kw === "string") ? campi.kw.slice(0, 60) : "";
    campi.riepilogo = (typeof campi.riepilogo === "string") ? campi.riepilogo.slice(0, 240) : "";

    return { statusCode: 200, headers: H, body: JSON.stringify(campi) };
  } catch (e) {
    return { statusCode: 500, headers: H, body: JSON.stringify({ error: "Errore ponte", dettaglio: String(e).slice(0, 200) }) };
  }
};
