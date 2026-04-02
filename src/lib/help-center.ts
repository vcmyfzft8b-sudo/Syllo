export type HelpArticle = {
  slug: string;
  title: string;
  category: "Pogosto" | "Snemanje in zapiski" | "Račun in dostop";
  content: string;
};

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "terms-of-use",
    title: "Pogoji uporabe",
    category: "Račun in dostop",
    content: `# Pogoji uporabe

Z ustvarjanjem računa ali nadaljevanjem v Memo se strinjaš s temi pogoji.

## Tvoje odgovornosti

- nalagaš, snemaš, lepiš ali povezuješ lahko samo gradivo, ki ga imaš v lasti ali ga smeš uporabljati
- odgovoren si za zakonitost vsebine, ki jo pošlješ
- Note ne smeš uporabljati za nalaganje zlonamerne programske opreme, zlorabo sistemov tretjih oseb, zajemanje zasebnih sistemov ali kršenje šolskih, službenih ali platformnih pravil

## AI obdelava

Memo je AI učno orodje. Za prepise, povzetke, kartice, kvize, odgovore v klepetu in izluščanje vsebine iz dokumentov lahko Memo tvojo vsebino obdela pri zunanjih AI in infrastrukturnih ponudnikih.

To lahko vključuje:

- zvočne posnetke in naložene zvočne datoteke
- prilepljeno besedilo in zapiske
- PDF-je in druge podprte dokumente
- javne spletne povezave, za katere želiš, da jih Memo prebere
- metapodatke, potrebne za delovanje, varnost in izboljšave storitve

Z nadaljevanjem soglašaš, da Memo to vsebino obdela za navedene funkcije izdelka.

## Brez jamstev

Memo lahko ustvari napake, nepopolne odgovore ali zavajajoče učno gradivo. Preden se zaneseš na rezultate pri izpitih, seminarskih nalogah, medicinskih, pravnih, finančnih, skladnostnih ali varnostno kritičnih odločitvah, jih moraš preveriti sam.

## Račun in ukrepanje

Dostop lahko začasno omejimo, onemogočimo nekatere funkcije ali odstranimo vsebino, kadar je uporaba videti zlorabna, nezakonita, nevarna ali škodljiva za storitev ali druge uporabnike.

## Spremembe

Ti pogoji se lahko posodobijo, ko se izdelek spreminja. Če po posodobitvi nadaljuješ z uporabo, to pomeni, da sprejemaš posodobljeno različico.

## Pravno obvestilo

Ta stran je osnovno produktno besedilo in ni pravni nasvet. Če potrebuješ besedilo za specifično jurisdikcijo, zaveze glede hrambe, pogoje za izobraževalni sektor ali enterprise pogodbe, naj jih pred uporabo pregleda pravni strokovnjak.`,
  },
  {
    slug: "family-plan",
    title: "Družinski paket?",
    category: "Pogosto",
    content: `# Družinski paket

Skupni družinski delovni prostor še ni podprt.

Za zdaj ima vsak račun svojo knjižnico zapiskov, zgodovino obdelav in izvoze.

## Kaj lahko narediš zdaj

- prijavi se z računom, ki naj bo lastnik zapiskov
- izvožene PDF ali Markdown datoteke deli ročno
- za bolj dosledne rezultate uporabljaj enake jezikovne nastavitve`,
  },
  {
    slug: "gift-coconote",
    title: "Ali lahko podarim Memo?",
    category: "Pogosto",
    content: `# Podarjanje dostopa

Darilne kode v tej različici še niso na voljo.

Če želiš, da Memo uporablja nekdo drug, je trenutno najbolj praktično, da si ustvari svoj račun ali da mu deliš izvožene zapiske.

## Kaj sledi

Ko bo sistem kod pripravljen, bo povezan z možnostjo **Unovči kodo** v nastavitvah.`,
  },
  {
    slug: "supported-language",
    title: "Ali podpirate moj jezik?",
    category: "Pogosto",
    content: `# Podprti jeziki

Aplikacija lahko obdela večjezično gradivo, vendar so rezultati najboljši, če pred ustvarjanjem zapiska izbereš pravi izvorni jezik.

## Priporočila

- pred oddajo izberi dejanski jezik posnetka ali besedila
- pri mešanju jezikov pomagajo krajši posnetki
- tehnični angleški izrazi lahko ostanejo v končnem rezultatu, kadar so del izvorne vsebine`,
  },
  {
    slug: "feature-request",
    title: "Predlog funkcije",
    category: "Pogosto",
    content: `# Predlagaj izboljšavo

Najbolj uporaben predlog je kratek in konkreten opis tvojega načina uporabe.

Koristno je vključiti:

- kaj si želel doseči
- kje si se zataknil
- kakšen rezultat si pričakoval
- ali gre za težavo pri zvoku, besedilu, PDF-ju ali povezavi`,
  },
  {
    slug: "video-isnt-working",
    title: "Video povezava ne deluje",
    category: "Snemanje in zapiski",
    content: `# Težave z video povezavo

Memo lahko obdela samo vsebino, ki je javno dostopna in dovolj berljiva za povzemanje.

## Poskusi to

- preveri, da stran ne zahteva prijave
- uporabi neposreden URL strani
- če imaš gradivo drugje, naloži PDF ali prilepi besedilo`,
  },
  {
    slug: "audio-upload-issue",
    title: "Ne morem naložiti zvoka",
    category: "Snemanje in zapiski",
    content: `# Težave pri nalaganju zvoka

Podprti formati so MP3, M4A, WAV, OGG in WEBM.

## Kontrolni seznam

- preveri, da datoteka ni poškodovana
- ostani pod trenutno omejitvijo velikosti
- če je zvok nastal s snemanjem zaslona, ga ponovno izvozi
- če se je nalaganje prej ustavilo, poskusi znova z domače strani`,
  },
  {
    slug: "transcript-cut-short",
    title: "Prepis je prekratek ali netočen",
    category: "Snemanje in zapiski",
    content: `# Kakovost prepisa

Kakovost prepisa je odvisna od čistosti zvoka, prekrivanja govorcev in izbranega izvornega jezika.

## Kako izboljšati rezultate

- pred obdelavo izberi pravilen jezik
- pri pogovorih omogoči zajem več govorcev
- zmanjša ozadni hrup
- zelo dolge posnetke razdeli na manjše dele`,
  },
  {
    slug: "redeem-code",
    title: "Unovči kodo",
    category: "Račun in dostop",
    content: `# Unovčenje kode

Promocijske in darilne kode bodo dodane v kasnejši fazi.

Vstopna točka že obstaja v nastavitvah, zato bo mogoče potek povezati brez nove prenove.`,
  },
  {
    slug: "privacy-policy",
    title: "Politika zasebnosti",
    category: "Račun in dostop",
    content: `# Politika zasebnosti

Tvoji zapiski ostanejo povezani s tvojim računom. Naloženo gradivo se uporablja za prepise, povzetke, strukturirane zapiske, izvoze, kartice, kvize in odgovore v klepetu znotraj aplikacije.

## Kaj posreduješ

Glede na način uporabe aplikacije lahko posreduješ:

- podatke o računu, kot so e-naslov in avtentikacijski podatki
- zvočne posnetke in naložene zvočne datoteke
- prilepljeno besedilo, zapiske, pozive in sporočila v klepetu
- PDF-je, dokumente in izvožene datoteke
- javne povezave, za katere želiš, da jih Memo prebere

## Kako storitev uporablja tvojo vsebino

Tvojo vsebino uporabljamo za:

- prijavo v račun in ohranjanje aktivne seje
- shranjevanje in urejanje tvoje knjižnice zapiskov
- prepisovanje in analizo izvornega gradiva
- ustvarjanje povzetkov, zapiskov, kartic, kvizov, izvozov in odgovorov v klepetu
- izvajanje ozadnih opravil, omejevanje zahtevkov in preprečevanje zlorab

## Obdelava pri tretjih ponudnikih

Za izvajanje AI funkcij lahko Memo ustrezno vsebino pošlje zunanjim ponudnikom, ki podpirajo prepisovanje, izluščanje dokumentov, embeddinge, generiranje besedila, gostovanje, shranjevanje in avtentikacijo.

To lahko po potrebi vključuje datoteke, besedilo, zvok in pozive, ki jih pošlješ za funkcijo, ki jo zahtevaš.

## Tvoje možnosti

Če ne želiš, da pride do takšne obdelave, te vsebine v Memo ne nalagaj, ne lepi, ne snemaj in ne poveži.

## Hramba in brisanje

Vsebina ostane povezana s tvojim računom, dokler je ne izbrišeš v izdelku ali je ne odstranimo prek podpore ali operativnega čiščenja. Če potrebuješ strožje pogoje glede hrambe, brisanja ali pogodbenih določil, se ne zanašaj samo na to privzeto politiko.

## Pravno obvestilo

To je povzetek za uporabniški vmesnik izdelka in ni pravni nasvet. Preden ga obravnavaš kot končno produkcijsko politiko zasebnosti, naj ga pregleda pravni strokovnjak.`,
  },
];

export const HELP_SECTIONS = [
  {
    title: "Pogosto",
    items: HELP_ARTICLES.filter((article) => article.category === "Pogosto"),
  },
  {
    title: "Snemanje in zapiski",
    items: HELP_ARTICLES.filter((article) => article.category === "Snemanje in zapiski"),
  },
  {
    title: "Račun in dostop",
    items: HELP_ARTICLES.filter((article) => article.category === "Račun in dostop"),
  },
];

export function getHelpArticle(slug: string) {
  return HELP_ARTICLES.find((article) => article.slug === slug) ?? null;
}
