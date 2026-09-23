# Horizontal Scaling Stress Test

Projekt čiji je cilj **stress testing** web servisa: mjeriti kako se vrijeme odgovora sustava ponaša pod kontinuiranim, konstantnim opterećenjem dok se broj dostupnih instanci mijenja usred testa (postupno dodavanje odnosno gašenje instanci). Fokus je na **metodologiji opterećenja (k6), mjerenju performansi (latencija, percentili, distribucija) i analizi rezultata**.

## Ideja i cilj

Umjesto testiranja sustava u mirnom, stabilnom stanju, cilj je simulirati stvarne uvjete u kojima se kapacitet sustava mijenja dok je pod punim opterećenjem — npr. auto-scaling koji reagira na porast prometa (scale up) ili planirano smanjenje resursa (scale down). Mjeri se koliko takva promjena kapaciteta usred opterećenja utječe na vrijeme odgovora, broj obrađenih zahtjeva i pojavu ekstremnih kašnjenja (tail latency).

Backend servis je namjerno napravljen da simulira realističan, a ne trivijalan teret: vrijeme obrade prati **log-normalnu distribuciju** (većina zahtjeva brza, uz "long tail" sporijih) i dio tog vremena troši se na stvaran CPU rad, ne na pasivno čekanje — kako bi opterećenje instanci pod stresom bilo realno, a ne simulirano samo kašnjenjem.

## Arhitektura testnog okruženja

k6 generira opterećenje prema NGINX-u na portu `8080`, koji round-robin algoritmom raspoređuje zahtjeve na do četiri Node.js instance (`node1`–`node4`, svaka na portu `3000` u vlastitom Docker kontejneru). Ova postavka postoji isključivo da bi se moglo mijenjati kapacitet sustava (paliti/gasiti instance) dok generator opterećenja radi bez prekida. Svaka instanca radi neovisno, bez dijeljenog stanja.

## Tehnologije

- **k6** — generiranje kontinuiranog opterećenja i mjerenje performansi (glavni alat projekta)
- **Python** (NumPy, Matplotlib) — statistička analiza rezultata stresnog testa i generiranje grafova
- **Node.js** (čisti `http` modul) — backend servis koji se testira, simulira realno kašnjenje i CPU rad
- **Docker / Docker Compose** — omogućuje dinamičko paljenje/gašenje instanci tijekom testa
- **NGINX** (`nginx:alpine`) — raspoređuje promet na trenutno aktivne instance dok se kapacitet mijenja

## Stresno testiranje (`load-test.js`, k6)

Ovo je srž projekta. k6 skripta generira **konstantno opterećenje od 200 virtualnih korisnika kroz 5 minuta** (`constant-vus` executor) na `/ping` endpoint, neovisno o tome koliko je instanci trenutno aktivno iza NGINX-a. Za svaki zahtjev provjerava se status 200, prisutnost očekivanog sadržaja i identifikacijskih zaglavlja; mjere se vlastite metrike (ukupan broj zahtjeva, vrijeme odgovora, broj grešaka; pragovi `p(95)<3000ms` i `errors<100`). Po završetku testa ispisuje se sažetak i sprema `results/summary.json`, dok se sirovi vremenski niz svih mjerenja izvozi kao JSON (`k6 run --out json=...`) za kasniju detaljnu analizu.

## Scale up / scale down scenariji opterećenja

Dvije bash skripte automatiziraju stresni test tako da mijenjaju kapacitet sustava **dok k6 kontinuirano generira opterećenje**, bez prekidanja testa:

- **`run-scale-up.sh`** — test kreće s jednom aktivnom instancom pod punim opterećenjem (najgori mogući scenarij za start), pa svakih 75 sekundi pali po jednu dodatnu instancu (`node2` → `node3` → `node4`).
- **`run-scale-down.sh`** — test kreće sa sve četiri aktivne instance, pa svakih 75 sekundi gasi po jednu (`node4` → `node3` → `node2`), dok na kraju ne ostane samo `node1`.

Oba scenarija traju ukupno 5 minuta i rezultat spremaju u `results/scale-up.json` odnosno `results/scale-down.json`. Cilj je usporediti kako sustav podnosi stres kad kreće poddimenzioniran i raste, naspram toga kad kreće punim kapacitetom i postupno se smanjuje.

## Analiza rezultata stresnog testa (`analyze.py`)

Python skripta učitava k6-ov JSON izlaz, filtrira `http_req_duration` metriku i generira:

- **graf percentila** (tail latency) — kako vrijeme odgovora raste za sve sporije i sporije zahtjeve (0–100 percentil)
- **histogram** distribucije vremena odgovora, s prosjekom, medijanom i standardnom devijacijom

```
python analyze.py results/scale-up.json "Scale Up"
python analyze.py results/scale-down.json "Scale Down"
```

Generirani grafovi (`results/scale-up-percentiles.png`, `results/scale-up-histogram.png`, `results/scale-down-percentiles.png`, `results/scale-down-histogram.png`) nalaze se u `project/results/`.

## Backend servis pod testom (`server.js`)

Servis koji se stresno testira simulira realistično ponašanje web aplikacije, gdje većina zahtjeva bude brza, ali postoji "long tail" sporijih. Kašnjenje se generira Box-Muller transformacijom u log-normalnu distribuciju (podesivi parametri `mu` i `sigma`), a dio tog vremena instanca provede radeći stvarni CPU-intenzivan posao (trigonometrijske operacije), a ne samo čekajući (`setTimeout`) — kako bi opterećenje bilo realno mjerljivo (CPU, ne samo latencija).

### Endpointi

| Endpoint  | Metoda | Opis |
|-----------|--------|------|
| `/ping`   | GET    | Endpoint koji se stresno testira. Vraća `pong` nakon umjetnog kašnjenja generiranog log-normalnom distribucijom. U odgovoru su i HTTP zaglavlja `X-Instance-ID` i `X-Response-Time`. |
| `/config` | GET    | Vraća trenutnu konfiguraciju generatora kašnjenja za tu instancu. |
| `/config` | POST (query params) | Mijenja parametre generatora: `mu`, `sigma`, `minDelay`, `maxDelay`, `cpuWork`, `diskWrite` — omogućuje podešavanje intenziteta stresa. |
| `/health` | GET    | Status instance (uptime, potrošnja memorije). |
| `/stats`  | GET    | Agregirane statistike te instance: broj zahtjeva, prosječno vrijeme, p50/p90/p95/p99. |
| `/reset`  | GET    | Resetira interne statistike (`requestCount`, `responseTimes`) na toj instanci. |

### Konfiguracija intenziteta stresa

Zadane vrijednosti (podesive preko `/config`):

- `mu = 4.5`, `sigma = 0.8` — parametri log-normalne distribucije kašnjenja
- `minDelay = 10 ms`, `maxDelay = 5000 ms` — donja i gornja granica kašnjenja
- `cpuWork = true` — dio kašnjenja se "troši" na stvaran CPU rad (realno opterećenje procesora)
- `diskWrite = false` — opcionalno pisanje privremene datoteke na disk radi simulacije I/O opterećenja

## NGINX konfiguracija (`nginx.conf`)

Podrška infrastrukturi za dinamičko skaliranje tijekom testa:

- Upstream grupa `nodejs_cluster`, round-robin raspodjela na aktivne instance
- `max_fails=3 fail_timeout=30s` po serveru — ugašena/nedostupna instanca privremeno se izbacuje iz rotacije
- `proxy_next_upstream` s retry logikom (do 3 pokušaja) na greškama/timeoutima/5xx odgovorima, kako gašenje instance usred testa ne bi rušilo zahtjeve klijenata
- Dodatna zaglavlja `X-Upstream-Addr` i `X-Upstream-Response-Time` radi praćenja koja je instanca obradila zahtjev i koliko je trebala
- `/nginx-health`, `/nginx-status` — health/status endpointi samog NGINX-a

## Pokretanje projekta

### Preduvjeti

- Docker i Docker Compose
- [Grafana k6](https://k6.io/) (za generiranje opterećenja)
- Python s bibliotekama iz `requirements.txt` (`pip install -r requirements.txt`)

### Build

```
cd project
docker-compose build
```

### Scale Up test

```
./run-scale-up.sh
```

| Vrijeme | Događaj |
|---------|---------|
| 0:00 | Test kreće s 1 instancom pod punim opterećenjem |
| 1:15 | Pali se node2 |
| 2:30 | Pali se node3 |
| 3:45 | Pali se node4 |
| 5:00 | Test završava |

### Scale Down test

```
./run-scale-down.sh
```

| Vrijeme | Događaj |
|---------|---------|
| 0:00 | Test kreće s 4 instance |
| 1:15 | Gasi se node4 |
| 2:30 | Gasi se node3 |
| 3:45 | Gasi se node2 (ostaje samo node1) |
| 5:00 | Test završava |

### Generiranje grafova

```
python analyze.py results/scale-up.json "Scale Up"
python analyze.py results/scale-down.json "Scale Down"
```

## Rezultati

| Scenarij | Ukupno zahtjeva | Prosjek (ms) | Medijan (ms) | p90 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
|----------|-----------------|--------------|---------------|----------|----------|----------|----------|
| Scale Up | 99 022 | 505.84 | 448.17 | 868.84 | 1036.59 | 1567.46 | 8899.05 |
| Scale Down | 115 888 | 417.71 | 368.46 | 746.51 | 883.71 | 1171.78 | 6226.30 |

### Zaključak

Scale Down scenarij obradio je 17% više zahtjeva uz niže vrijeme odgovora u svim mjerenim kategorijama — prosječno vrijeme bilo je niže za 88 ms, a maksimalno čak 43% niže nego u Scale Up scenariju. Oba histograma potvrđuju log-normalnu distribuciju vremena odgovora s glavnim vrhom u području 200–400 ms i asimetričnim "dugim repom".

Scale Up scenarij ima znatno veću standardnu devijaciju (397.6 ms nasuprot 246.8 ms) i vidljive izolirane skupine zahtjeva iznad 4000 ms — posljedica zagušenja sustava dok pod stresom radi samo jedna instanca. Scale Down distribucija je kompaktnija, s manje outliera, jer sustav kreće s dovoljno kapaciteta i kapacitet se smanjuje postupno.

Najveća razlika vidljiva je na p99 razini (1567 ms u odnosu na 1172 ms, razlika ~400 ms), što pokazuje da dodatni kapacitet najviše koristi upravo najsporijim, "najgorim" zahtjevima pod stresom. Sustav je osjetno osjetljiviji na pokretanje s nedovoljno resursa pod punim opterećenjem nego na postupno smanjenje kapaciteta postojećeg sustava.

## Struktura projekta

```
project/
├── load-test.js             # k6 stresni test — srž projekta
├── run-scale-up.sh           # stresni test uz postupno dodavanje instanci
├── run-scale-down.sh         # stresni test uz postupno gašenje instanci
├── analyze.py                 # analiza rezultata stresnog testa i generiranje grafova
├── requirements.txt           # Python ovisnosti (analiza)
├── results/                   # k6 JSON izlazi i generirani grafovi
├── server.js                 # Node.js backend koji se testira (simulacija realnog opterećenja)
├── package.json
├── Dockerfile                 # slika za Node.js instance
├── docker-compose.yml         # NGINX + 4 Node.js instance (infrastruktura za skaliranje)
└── nginx.conf                  # load balancer konfiguracija
```
