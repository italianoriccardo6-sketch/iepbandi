#!/usr/bin/env python3
"""
aggiorna.py — aggiornamento automatico del catalogo bandi di iepbandi.com

Cosa fa, in ordine:
  1. scarica il dataset open data MIMIT (incentivi.gov.it) dall'URL in INCENTIVI_CSV_URL
     (in mancanza, legge un file CSV locale passato come primo argomento);
  2. normalizza ogni riga e tiene solo le misure APERTE alla data odierna;
  3. converte nel formato "snello" letto dal sito;
  4. antepone le misure nazionali curate a mano (nazionali.json), che nel dataset
     ufficiale non compaiono e non vanno mai perse;
  5. scrive misure.json (l'array che il sito carica).

Pensato per girare in una GitHub Action su pianificazione.
"""
import sys, os, io, json, re
from datetime import date, datetime
import pandas as pd

OGGI = pd.Timestamp(date.today())
OUT = os.environ.get("OUT_FILE", "misure.json")
NAZ = os.environ.get("NAZIONALI_FILE", "nazionali.json")
CSV_URL = (os.environ.get("INCENTIVI_CSV_URL", "").strip()
           or "https://www.incentivi.gov.it/50fc8709-3628-49b3-b462-791aca27f74a")

DIMENSIONI = {
    "Microimpresa": "micro", "Piccola Impresa": "piccola",
    "Media Impresa": "media", "Grande Impresa": "grande",
}
FORME = {
    "Contributo/Fondo perduto": "fondo-perduto",
    "Agevolazione fiscale": "credito-imposta",
    "Prestito/Anticipo rimborsabile": "finanziamento",
    "Interventi a garanzia": "garanzia",
    "Capitale di rischio": "capitale-rischio",
    "Riduzione dei contributi di previdenza sociale": "decontribuzione",
}
REGIONI_IT = {"Abruzzo", "Basilicata", "Calabria", "Campania", "Emilia-Romagna",
    "Friuli-Venezia Giulia", "Lazio", "Liguria", "Lombardia", "Marche", "Molise",
    "Piemonte", "Puglia", "Sardegna", "Sicilia", "Toscana",
    "Trentino-Alto Adige/Südtirol", "Umbria", "Valle d'Aosta/Vallée d'Aoste", "Veneto"}
MEZZOGIORNO = {"Abruzzo", "Molise", "Campania", "Puglia", "Basilicata",
    "Calabria", "Sicilia", "Sardegna"}


def lista(v):
    if not v:
        return []
    v = v.replace("\\,", "\u0001")
    return [x.strip().replace("\u0001", ",") for x in v.split(",") if x.strip()]


def num(v):
    try:
        return int(float(v))
    except (ValueError, TypeError):
        return None


def iso(v):
    if not v or not str(v).strip():
        return None
    d = pd.to_datetime(v, errors="coerce")
    if pd.isna(d):
        return None
    return d.date().isoformat()


def normalizza(r):
    dim = sorted({DIMENSIONI[d] for d in lista(r["Dimensioni"]) if d in DIMENSIONI})
    forme = sorted({FORME[f] for f in lista(r["Forma_agevolazione"]) if f in FORME})
    regioni = [x for x in lista(r["Regioni"]) if x in REGIONI_IT]
    nazionale = len(regioni) >= 15
    mezzogiorno = bool(set(regioni) & MEZZOGIORNO)
    ateco_tutti = "Tutti i settori" in r["Codici_ATECO"]
    ap, ch = iso(r["Data_apertura"]), iso(r["Data_chiusura"])
    aperto = ((ap is None or pd.Timestamp(ap) <= OGGI) and
              (ch is None or pd.Timestamp(ch) >= OGGI))
    settori = lista(r["Settore_Attivita"])
    return {
        "id": r["ID_Incentivo"], "titolo": r["Titolo"].strip(),
        "ente": r["Soggetto_Concedente"].strip(),
        "obiettivo": r["Obiettivo_Finalita"].strip(),
        "forme": forme, "dimensioni": dim, "settori": settori,
        "atecoTutti": ateco_tutti, "regioni": regioni,
        "nazionale": nazionale, "mezzogiorno": mezzogiorno,
        "ambito": lista(r["Ambito_territoriale"]),
        "spesaMax": num(r["Spesa_Ammessa_max"]),
        "agevMax": num(r["Agevolazione_Concedibile_max"]),
        "dataChiusura": ch, "aperto": aperto,
        "link": r["Link_istituzionale"].strip(),
    }


def slim(m):
    s = {
        "id": m["id"], "t": m["titolo"], "e": m["ente"],
        "f": m["forme"], "d": m["dimensioni"],
        "at": 1 if m["atecoTutti"] else 0,
        "naz": 1 if m["nazionale"] else 0,
        "mez": 1 if m["mezzogiorno"] else 0,
        "amb": m["ambito"],
    }
    if m["spesaMax"] is not None:
        s["smax"] = m["spesaMax"]
    if m["agevMax"] is not None:
        s["amax"] = m["agevMax"]
    s["ch"] = m["dataChiusura"]
    s["ob"] = (m["obiettivo"] or "")[:120]
    s["l"] = m["link"]
    if not m["nazionale"]:
        s["r"] = m["regioni"]
    if len(m["settori"]) >= 18:
        s["sAll"] = 1
    else:
        s["s"] = m["settori"]
    return s


def carica_csv():
    # 1) file CSV locale passato come argomento (utile per i test)
    if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
        return pd.read_csv(sys.argv[1], dtype=str, keep_default_na=False)
    # 2) scarica dal sito ufficiale (con user-agent da browser)
    if CSV_URL:
        import urllib.request
        req = urllib.request.Request(CSV_URL, headers={
            "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                           "AppleWebKit/537.36 (KHTML, like Gecko) "
                           "Chrome/124.0 Safari/537.36"),
            "Accept": "text/csv,application/octet-stream,*/*",
        })
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = resp.read()
        return pd.read_csv(io.BytesIO(data), dtype=str, keep_default_na=False, encoding="utf-8")
    raise SystemExit("Nessuna fonte dati disponibile.")


def main():
    df = carica_csv()
    full = [normalizza(r) for _, r in df.iterrows()]
    aperti = [m for m in full if m["aperto"]]
    snelle = [slim(m) for m in aperti]
    snelle.sort(key=lambda x: (x.get("ch") or "9999"))

    curate = []
    if os.path.exists(NAZ):
        with open(NAZ, encoding="utf-8") as f:
            curate = json.load(f)

    out = curate + snelle
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"OK  {len(curate)} curate + {len(snelle)} aperte = {len(out)} -> {OUT}")


if __name__ == "__main__":
    main()
