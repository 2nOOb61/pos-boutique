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

## 4. Alternative non retenue — l'API `/exec`

Le backend expose une trentaine d'actions GET en lecture seule
(`getDossiers`, `getTaches`, `getLivraisonsJournal`, `getLivraisonsEtats`,
`getBats`, `getFinition`, `getMachineSessions`, `getCommandes`, `getDashboard`,
`getControlPatron`…) qui renvoient du JSON propre, sans compte Google.

Ce serait techniquement plus fiable que la lecture du classeur comme texte.
Deux raisons de ne pas l'utiliser pour l'instant :

1. L'URL `/exec` est publique et le même déploiement expose des actions
   **d'écriture** (`doPost`) sans aucun contrôle de rôle côté serveur. Y
   brancher un agent élargit la surface d'exposition.
2. Claude ne peut pas appeler cette URL depuis un projet claude.ai.

À reconsidérer seulement si un jour le backend gagne un vrai contrôle d'accès
côté serveur, ou un déploiement séparé en lecture seule avec jeton.

---

## 5. Ce que ce document ne transfère pas

Les instructions et le contexte, oui. **Pas** les connexions, les autorisations,
les fichiers privés, les données du classeur ni l'accès GitHub.

Ne jamais coller dans une conversation : mot de passe, clé API, jeton OAuth,
secret Apps Script, ou lien contenant un jeton privé.
