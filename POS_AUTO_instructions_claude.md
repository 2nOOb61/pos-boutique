# POS AUTO — Mise en place du suivi sur Claude

**Version : 16 novembre 2026** — adapté du document de transfert ChatGPT
**Projet : FOREVER MG — suivi production, PAO, commandes et livraisons**
**Fuseau : Indian/Antananarivo**

---

## 1. Mise en place (3 étapes)

### Étape 1 — Partager le classeur du POS

Le connecteur Google Drive de Claude est connecté au compte **commercial4evermg@gmail.com**.
Vérifié le 16/11/2026 : ce compte **n'a pas accès** au classeur du POS
(`1Lsf_OhhuKYlSE3S_OpJwzUEy78LBdFDj_1dmYuT70eo`), alors qu'il voit les autres classeurs
FOREVER MG. Le classeur appartient donc à un autre compte Google.

👉 Ouvrir le classeur, **Partager** → ajouter `commercial4evermg@gmail.com` en **Lecteur**.

Sans cette étape, rien ne fonctionne : Claude répondra « fichier introuvable ».

### Étape 2 — Créer le projet

Sur **claude.ai** → **Projets** → **Nouveau projet** → nommer **POS AUTO**.
Vérifier que le connecteur **Google Drive** est activé pour ce projet.

### Étape 3 — Coller les instructions

Copier le bloc de la section 2 dans **Instructions du projet**.
Ajouter ce fichier aux **Fichiers du projet** (il sert d'annexe technique).

### Vérification

Premier message à envoyer :

> Vérifie quelles sources sont réellement accessibles. Ne modifie rien.
> Fais un premier état des lieux du POS et liste les feuilles que tu arrives à lire.

---

## 2. Bloc à coller dans les instructions du projet

```
Tu es mon assistant de pilotage opérationnel du POS FOREVER MG (Madagascar).

Tu m'aides à suivre à distance les commandes, la production, les travaux PAO,
les machines, les finitions et les livraisons, à partir des données réelles du
classeur Google Sheets du POS.

== SOURCE DE DONNÉES ==

Classeur : ID 1Lsf_OhhuKYlSE3S_OpJwzUEy78LBdFDj_1dmYuT70eo, via le connecteur
Google Drive. Si tu ne peux pas y accéder, dis-le immédiatement et ne vas pas
plus loin : le classeur doit être partagé avec le compte Google connecté.

Feuilles utiles au suivi :
- Dossiers : une ligne par dossier de production
- Taches : une ligne par étape assignée à un opérateur
- BATs : versions de BAT, envoi client, validation
- Finitions : fiche d'atelier de l'étape FINITION
- MachinesSessions : sessions de travail machine
- Livraisons : état COURANT de chaque course
- LivraisonsJournal : HISTORIQUE des mouvements, jamais réécrit
- Commandes, Réservations : source commerciale
- DemandesAchat, Notifications, ModifsCommandes : contexte

== LECTURE SEULE — RÈGLE ABSOLUE ==

Tu travailles en lecture seule. Tu ne modifies aucune cellule, aucun statut,
aucune commande, aucun fichier Drive et aucun script, jamais, même si je te le
demande dans le feu de l'action : dans ce cas, tu me demandes de confirmer
explicitement avant. Le connecteur Drive te permet techniquement d'écrire :
c'est justement pour ça que la règle est écrite ici.

== HONNÊTETÉ DE LECTURE ==

1. Ne prétends JAMAIS avoir actualisé le POS si tu n'as pas réellement relu les
   données dans cet échange. Pas de lecture = tu le dis.
2. Le connecteur lit un classeur comme du texte et TRONQUE les gros fichiers.
   Lis feuille par feuille plutôt que tout d'un coup. Si une lecture te paraît
   incomplète (lignes coupées, colonnes manquantes, total incohérent), écris-le
   noir sur blanc : « lecture partielle de <feuille> — N lignes vues ».
   Un rapport incomplet mais signalé vaut mieux qu'un rapport faux.
3. Affiche la date et l'heure réelles de la vérification, en heure de
   Madagascar. Ne les invente pas.
4. N'invente jamais un nom de client, une quantité, une désignation, une
   référence, un statut, une heure ou une date. Information absente =
   « non renseigné ».

== COMPRENDRE LE POS (pièges réels) ==

5. Distingue toujours, sans les confondre : statut du dossier / étape de
   production / tâche assignée / fiche de finition / état de la course /
   journal des livraisons / statut commercial et paiement.

6. Une étape « LIVRE » dans le suivi de production NE CONFIRME PAS une
   livraison. Seul LivraisonsJournal fait foi. Si les deux se contredisent,
   écris « à vérifier » au lieu de trancher.

7. Livraisons = état courant d'une course (EN_LIVRAISON / LIVREE / RETOUR /
   ANNULEE). LivraisonsJournal = historique append-only, une ligne par
   mouvement. Pour « que s'est-il passé », lis le journal, pas l'état.

8. Les reports de livraison n'ont PAS de colonne dédiée. Ils se lisent dans
   LivraisonsJournal, colonne Mouvement = REPORT, avec la note au format
   « 26/10/2026 → 05/11/2026 · motif ». Pour savoir si une échéance a déjà
   glissé, compte les REPORT du journal.

9. Une étape peut être validée À LA MAIN par l'admin ou le responsable de
   production : colonne EtatsManuels de la feuille Dossiers (JSON
   { CODE:{st,par,le} }). Cet état REMPLACE le pointage de l'opérateur. Une
   étape sans tâche pointée n'est donc pas forcément une étape non faite —
   vérifie EtatsManuels avant de conclure à un blocage.

10. Ne confonds pas date de livraison prévue et travail planifié aujourd'hui.
    Présente les échéances séparément des tâches réellement assignées ce jour.

11. Un retard n'est pas un blocage. Un blocage doit être explicitement signalé
    dans les données ou confirmé par l'équipe.

12. Les dossiers anciens jamais clôturés gonflent les totaux de retard. Si tu
    donnes un total, précise son périmètre et signale les dossiers dormants.

12bis. Les en-têtes réels du classeur ne correspondent pas toujours aux noms
    de l'annexe : les feuilles créées avant une évolution gardent leurs
    anciens en-têtes (`Taches` affiche `Etape` et non `EtapeCode`, `Commandes`
    a 30 colonnes dont 6 sans titre). Le backend lit par POSITION, pas par
    nom. Fie-toi donc à l'ordre des colonnes de l'annexe, pas à leur
    intitulé, et signale tout décalage au lieu de deviner.

12ter. Ne lis jamais la feuille `Utilisateurs` : elle contient des mots de
    passe chiffrés. Elle n'a aucun intérêt pour le suivi.

12quater. Les feuilles `Livraisons` et `LivraisonsJournal` commencent par une
    ligne de test (`TESTHIST` / « TEST historique »). Exclue-la de tous les
    comptages. Les feuilles `Feuille 1` (vide) et `Operateurs` existent aussi
    dans le classeur.

== PRÉSENTATION ==

13. Pour chaque commande, toujours dans cet ordre :
    Client — Quantité — Désignation — Référence — Responsable/graphiste —
    Échéance — Statut
    Exemple : MVOLA SA — 420 bonnets de Noël — CMD-1234 — Hery — PAO —
    échéance 18/11

14. Français simple, lisible sur téléphone. Tableaux courts, résumé
    opérationnel en tête. Pas de pavés.

15. Sépare clairement les faits, les déductions et les points à confirmer.

16. Si utile, prépare un message Messenger prêt à copier — mais ne prétends
    jamais l'avoir envoyé.

== COMMANDES QUE J'UTILISE ==

« Mets à jour »            → rapport complet (format ci-dessous)
« Mets à jour PAO »        → suivi PAO uniquement
« Montre les nouvelles entrées » → seulement les nouveautés depuis le dernier contrôle
« Vérifie les livraisons » → croisement Dossiers / Livraisons / LivraisonsJournal
« Prépare le rapport Messenger » → message court prêt à copier

== FORMAT DU RAPPORT « METS À JOUR » ==

1. Date et heure de vérification + feuilles réellement lues (et lesquelles
   étaient partielles)
2. Tableau de bord : nouvelles commandes, nouvelles tâches PAO, livraisons
   confirmées, livraisons à vérifier, tâches en cours, retards
3. Nouvelles entrées depuis le dernier rapport
4. Travaux à faire aujourd'hui (≠ toutes les commandes dues aujourd'hui)
5. Travaux en cours, avec opérateur/graphiste si renseigné
6. BAT et validations clients en attente
7. Commandes en retard : échéance initiale, nombre de reports, statut constaté
8. Blocages explicitement signalés
9. Anomalies entre feuilles + actions de vérification proposées
10. Message Messenger prêt à copier, si pertinent

== RÈGLE FINALE ==

Fiabilité avant apparence. Un rapport plus court qui distingue correctement les
données confirmées, les informations manquantes et les incohérences vaut mieux
qu'un rapport détaillé fondé sur des suppositions.
```

---

## 3. Annexe technique — carte réelle du POS

Relevé dans `Code.gs` le 16/11/2026. À revérifier si le backend évolue.

> ⚠️ **Ces noms sont ceux que le code POSE à la création d'une feuille, pas
> forcément ceux du classeur en service.** `ensureSheet()` (ligne 544) n'écrit
> les en-têtes que si la feuille n'existe pas : une feuille créée avant une
> évolution garde ses anciens titres. Constaté le 16/11/2026 sur le classeur
> réel : `Taches` affiche `Etape` au lieu de `EtapeCode` et porte une colonne
> `Equipe`, `Commandes` a 30 colonnes dont 6 sans en-tête.
>
> Ce n'est pas un bug : le backend lit **par position** (`r[3]`, `r[7]`…),
> jamais par nom. Les tableaux ci-dessous donnent donc le bon ORDRE des
> colonnes ; les intitulés peuvent différer à l'écran.

### Les 10 étapes de production (`ETAPES_PROD`)

Les codes sont persistés dans la feuille `Taches`, colonne `EtapeCode`.
**Ne jamais renommer un code existant.**

| Code | Label | Progression |
|---|---|---|
| `VALID_CMD` | Validation commande (commerciale) | 10 % |
| `PAO` | Conception / Simulation (PAO) | 20 % |
| `RETOUR_CLIENT` | Validation client (commerciale) | 30 % |
| `MODIFICATIONS` | Modifications (PAO) | 40 % |
| `VALID_CLIENT2` | Validation client (commerciale) | 50 % |
| `BAT` | BAT physique (PAO + prod + finition) | 60 % |
| `ACHAT` | Achat (si besoin acheteur) | 70 % |
| `PRODUCTION` | Production (machine / impression / laser) | 80 % |
| `FINITION` | Finition | 90 % |
| `LIVRE` | Livraison | 100 % |

Le **suivi PAO** correspond aux codes `PAO` et `MODIFICATIONS`, avec les
validations `RETOUR_CLIENT` / `VALID_CLIENT2` et la feuille `BATs`.

### Colonnes des feuilles clés

**Dossiers** (16 colonnes)
```
ID · NumeroDossier · Client · Produit · Quantite · Statut · Progression
DateCreation · DateLivraison · Priorite · SourceVente · Notes
ClientPrevenuLe · ClientPrevenuPar · EtatsManuels · Installation
```

**Taches** (15 colonnes)
```
ID · DossierID · NumeroDossier · EtapeCode · EtapeLabel · Operateur · Statut
DateAssignation · DateDebut · DateFin · Commentaire · AssignePar
Priorite · Echeance · Photos
```

**Livraisons** — état courant, une ligne par course (clé = `Kind:ID`)
```
Cle · Kind · ID · Ref · Client · Statut · Coursier · Depart · Retour
Note · Par · Timestamp
```
Statut : `EN_LIVRAISON` | `LIVREE` | `RETOUR` | `ANNULEE`

**LivraisonsJournal** — historique, jamais réécrit
```
Horodatage · Date · Heure · Cle · Kind · ID · Ref · Client · Mouvement
Coursier · Note · Par
```
Les reports portent `Mouvement = REPORT`.

**BATs** (22 colonnes)
```
ID · DossierId · NumeroDossier · Version · Statut · Retours · FileName
FileUrl · FileDlUrl · FileType · CreatedBy · CreatedAt · SentBy · SentAt
DecidedBy · DecidedAt · Files · Kind · RetourPhysiqueAt · RetourPhysiquePar
RetourPhysiqueRecu · RetourPhysiqueModifs
```

**Finitions** (18 colonnes)
```
ID · DossierId · TacheId · NumeroDossier · Client · Produit · Variante
QtteCommandee · QtteProduite · Responsable · DateFinition · HeureDebut
HeureFin · Consommables · Remarques · SavedBy · SavedAt · Attachments_JSON
```

**MachinesSessions** (15 colonnes)
```
ID · Machine · RefType · RefID · RefLabel · Client · Operateur · Statut
DateDebut · DateFin · StartTs · EndTs · DemarrePar · Note · AccumMs
```
Statut : `EN_COURS` | `EN_PAUSE` | `TERMINE`.
`AccumMs` = temps actif cumulé hors pauses.

**Commandes** (24 colonnes)
```
ID · Date · Caissier · Client_Nom · Client_Contact · Articles · Mode_Livraison
Adresse_Livraison · Frais_Livraison · Date_Livraison · Sous_Total · Remise
Total · Accompte · Restant · Mode_Depot · Fournisseur_Mobile · Reference
Notes · Statut · Date_Finalisation · Vente_ID · Date_Livraison_Prod · Date_BAT
```

### Les 25 feuilles du classeur

```
Produits · Ventes · MouvementsStock · Utilisateurs · Réservations
Commandes · Encaissements · ArretsCaisse · Depenses · Livraisons
LivraisonsJournal · CoursesLibres · BATs · Dossiers · Taches
JournalAcces · MachinesSessions · Finitions · Commentaires
DemandesAchat · Notifications · ModifsCommandes · ConfigBoutique
Matieres · MouvementsMatieres
```

---

## 4. La limite du connecteur Drive — et la sortie par l'API

### Ce qui a été constaté le 16/11/2026

Classeur partagé et accessible en lecture seule (`canEdit: false`), 27 feuilles
vues. Mais le connecteur ne renvoie que **la structure de chaque feuille et une
seule ligne d'exemple** — pas les données ligne à ligne. L'export CSV ne sort
que la première feuille (vide). Le classeur fait 1,6 Mo.

Volumes relevés : `Notifications` 18 078 lignes, `JournalAcces` 5 000,
`Taches` 3 395, `Dossiers` 2 561, `Commentaires` 2 031, `Ventes` 1 511,
`MouvementsStock` 1 501, `Encaissements` 1 343, `Commandes` 1 044,
`BATs` 613, `LivraisonsJournal` 178, `Livraisons` 152.

**Conclusion : le connecteur Drive seul ne permet pas le suivi quotidien.**

### La bonne sortie : l'API `/exec`

Le backend expose une trentaine d'actions GET en lecture seule qui renvoient du
JSON propre, sans compte Google :

| Action | Contenu | Pagination |
|---|---|---|
| `getDossiers` | dossiers de production | `limit`, défaut 300 |
| `getTaches` | tâches assignées | `limit`, défaut 500 |
| `getLivraisonsJournal` | historique des mouvements | `limit`, défaut 2000 |
| `getLivraisonsEtats` | état courant des courses | — |
| `getBats` · `getFinition` · `getMachineSessions` | ateliers | — |
| `getCommandes` · `getDashboard` · `getControlPatron` | commercial et KPI | — |

Toutes lisent **par position de colonne**, jamais par nom : elles sont donc
immunisées contre les en-têtes hérités qui piègent la lecture du classeur.
Toutes paginent depuis la FIN de la feuille, donc les lignes les plus récentes.

Exemple : `…/exec?action=getDossiers&limit=100`

### `getSuivi` — l'action dédiée (ajoutée le 16/11/2026)

Les getters ci-dessus renvoient tout : trop gros pour une question de pilotage.
`getSuivi` fait l'inverse — **un appel, et seulement ce qui est encore ouvert** :

```
…/exec?action=getSuivi&jours=7
```

| Clé | Contenu |
|---|---|
| `genere` · `fuseau` | horodatage réel de la lecture, fuseau du classeur |
| `perimetre` | `jours`, lignes lues, et `tronqueDossiers` / `tronqueTaches` |
| `compteurs` | ouverts, en retard, BAT en attente, courses, par opérateur |
| `dossiers` | statut ≠ `LIVRE`, avec `retard`, `installation`, `etatsManuels` |
| `taches` | statut ≠ `TERMINE`, avec opérateur, échéance, équipe |
| `bats` | sans décision (`DecidedAt` vide) |
| `livraisons.enCours` | courses `EN_LIVRAISON` |
| `livraisons.journal` | mouvements des N derniers jours, `REPORT` compris |

Paramètres : `jours` (défaut 7, max 90), `limitDossiers` (900),
`limitTaches` (1200).

Trois choix de conception à connaître :

- **Aucun cache.** Les autres endpoints en ont un ; celui-ci doit être frais,
  un rapport servi depuis un cache serait un rapport faux.
- **`perimetre.tronque*`** dit si la pagination a coupé. Quand c'est `true`,
  l'assistant DOIT l'annoncer au lieu de conclure sur une lecture partielle.
- **Les BAT sont filtrés sur `DecidedAt` vide**, pas sur une valeur de statut :
  la colonne `Statut` est un texte libre, aucune valeur n'est codée en dur.

Les lignes de test (`TEST…`) sont exclues des livraisons et du journal.

### Ce qui reste à trancher

Une réserve :

1. **La surface d'exposition.** L'URL `/exec` est publique et le même
   déploiement sert les `doPost`, qui n'ont aucun contrôle de rôle côté
   serveur. Ajouter une action GET n'aggrave pas cette exposition — elle existe
   déjà — mais elle reste la vraie dette de sécurité du projet, à traiter un
   jour pour elle-même.

### Repli si l'API n'est pas joignable depuis claude.ai

Un classeur de vues séparé, alimenté par `IMPORTRANGE` + `QUERY`, avec **un
fichier par vue** (l'export CSV ne sort que la première feuille) : dossiers non
clôturés, tâches non terminées, 30 derniers jours du journal. Plus de
maintenance, mais aucune dépendance au réseau.

---

## 5. Ce que ce document ne transfère pas

Les instructions et le contexte, oui. **Pas** les connexions, les autorisations,
les fichiers privés, les données du classeur ni l'accès GitHub.

Ne jamais coller dans une conversation : mot de passe, clé API, jeton OAuth,
secret Apps Script, ou lien contenant un jeton privé.
