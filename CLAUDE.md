# CLAUDE.md — Contexte pour le merge sweep (password-manager)

## Contexte général

Ce repo est géré par une équipe de 7 agents Hermes AI. Le 18-19 septembre 2026, plusieurs
incidents de sécurité (token Telegram exposé) et un chantier de "merge sweep" ont été
traités en session interactive. Ce fichier transfère l'état et les leçons apprises pour
que tu (Claude Code) puisses continuer le travail en autonomie raisonnable, avec les
mêmes garde-fous.

**Ta mission : merger les PR ouvertes restantes vers `master`, dans l'ordre indiqué,
sans jamais sauter les étapes de vérification ci-dessous.**

## PR restantes, dans l'ordre à traiter

```
#40 (BE-001a: DB Migration System)
#41 (BE-001b: Core Tables Schema)
#42 (BE-001c: API Skeleton + OpenAPI + Health Endpoint)
#43 (BE-001d: Envelope Middleware)
#44 (BE-001f: Error Handler + Secret Scanning CI)
#14 (QA-001c: Playwright MCP + cross-browser E2E)
#15 (QA-001g: Evidence Collection — upload CI artifacts)
#17 (CI-001h: wire QA sign-off gate board audit as scheduled CI job)
#12 (QA-001d: wire SAST/truffleHog — VÉRIFIER D'ABORD si doublon de la PR #21 déjà
     mergée le 17/09, qui portait le même titre. Si oui, fermer #12 sans merger,
     comme on l'a fait pour la PR #22, doublon similaire.)
#16 (QA-001h: QA sign-off gate — probablement le plus gros morceau, prévoir du temps)
#18 (CI-001h follow-up — base = feature/t_430aa9a3, donc NE PAS merger avant #16)
```

Les 5 PR backend (#40-#44) sont indépendantes du reste et n'ont jamais eu de PR avant
aujourd'hui (les branches existaient, mais avaient été oubliées). Respecte l'ordre
entre elles (chacune dépend probablement de la précédente : migrations → schéma → API
→ middleware → error handler).

## Procédure standard pour chaque PR

1. `gh pr view <N> --json mergeable,mergeStateStatus,baseRefName` — ne jamais se fier
   aux checks CI affichés sans vérifier ça d'abord (voir "Piège n°2" plus bas).
2. Si `CONFLICTING`/`DIRTY` : `git fetch origin && git checkout <branche> && git merge origin/master`.
3. Résoudre les conflits (voir règles ci-dessous).
4. `pnpm install` à la racine.
5. **Toujours** avant de push : `cd apps/web && pnpm typecheck && pnpm test && cd ..`
   (et lancer aussi tout script QA spécifique à la PR : `node scripts/qa/scan-test-data.mjs`,
   `node scripts/qa/signoff-gate.selftest.mjs`, etc. — vérifie le contenu de la PR).
6. Si un script comme `scan-test-data.mjs` échoue à cause d'une URL/domaine type
   `example.com` dans un test, remplace par `example.test` (domaine réservé RFC 2606) —
   déjà fait une fois dans ce projet, c'est la convention attendue.
7. `git push origin <branche>`, attendre ~15-20s, puis `gh pr checks <N>` ET
   `gh pr view <N> --json mergeable,mergeStateStatus` (les deux, pas un seul).
8. Si tout est vert et `CLEAN`/`MERGEABLE` : `gh pr merge <N> --squash --delete-branch`.
9. **Immédiatement après**, vérifier si une autre PR de la liste dépendait de la
   branche qui vient d'être supprimée (`gh pr view <N+1> --json state,baseRefName`).
   Si `CLOSED` : voir "Piège n°1" plus bas.

## Règle de résolution de conflit sur les 4 fichiers "mécaniques"

Ces 4 fichiers ont TOUJOURS le même pattern de résolution aujourd'hui : garder la
version de `master` (`--theirs`), car `master` a systématiquement une version plus
récente/complète :

```bash
git checkout --theirs .github/workflows/ci.yml
git checkout --theirs PROJECT_BRIEF.md
git checkout --theirs pnpm-lock.yaml
git checkout --theirs pnpm-workspace.yaml
git add .github/workflows/ci.yml PROJECT_BRIEF.md pnpm-lock.yaml pnpm-workspace.yaml
```

**Exception `package.json`** (racine ou `apps/web/`) : souvent un vrai conflit de
contenu (les deux côtés ajoutent des scripts différents). NE PAS trancher en bloc —
lire le diff (`git diff HEAD:package.json origin/master:package.json`) et fusionner
les deux ensembles de scripts/dépendances à la main. Exemple déjà vu : `master` avait
`format`/`format:check`, la branche avait `scan:test-data`/`validate:fixtures` — il
fallait garder les deux.

**Tout autre fichier en conflit** (du vrai code) : lire le diff des deux côtés avant
de trancher. Ne jamais choisir `--ours`/`--theirs` en bloc sur un fichier de logique
sans avoir vu le contenu. Règle générale observée : si une branche date d'avant une
autre PR déjà mergée qui touchait le même fichier, `master` a probablement la version
plus à jour sur les sous-parties déjà livrées, mais la branche courante a la vraie
valeur ajoutée de sa propre tâche — il faut souvent fusionner les deux, pas choisir.

## Piège n°1 — PR fille fermée automatiquement

Quand une PR A a pour base une PR B (au lieu de `master`), et que B est mergée +
sa branche supprimée, GitHub **ferme automatiquement A** sans pouvoir la rouvrir
(`gh pr reopen`/`gh api ... state=open` échouent avec "branch has been deleted").

**Remède** : recréer une nouvelle PR sur `master` :
```bash
gh pr create --base master --head <branche-de-A> \
  --title "<titre original>" \
  --body "Recreated — original PR #<N> was auto-closed by GitHub when its base branch was deleted. Supersedes #<N>."
```
Puis reprendre la procédure standard sur le nouveau numéro de PR.

## Piège n°2 — Les checks CI affichés peuvent être périmés

`gh pr checks <N>` peut afficher un ancien run (même après un push récent) si
GitHub n'a pas encore recalculé. Toujours croiser avec
`gh pr view <N> --json mergeable,mergeStateStatus` — si `mergeStateStatus` est
`CLEAN` et `mergeable` est `MERGEABLE`, c'est fiable. Si `UNKNOWN`, réessayer après
quelques secondes ou relancer le cycle merge.

## Piège n°3 — `vitest.config.ts` / `vitest.integration.config.ts` / `vitest.a11y.config.ts`

Bug découvert et corrigé plusieurs fois aujourd'hui : d'anciennes branches ont
`plugins: [react()]` (import `@vitejs/plugin-react`) dans ces configs, ce qui casse
le typecheck avec un conflit de type `Plugin<any>` entre deux versions de `vite`
installées en parallèle. Le fix, déjà sur `master`, est :
```ts
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { environment: 'jsdom', globals: true /* ne pas oublier, sinon les tests
    React Testing Library ne se nettoient plus entre eux et échouent en cascade */ },
})
```
Si un conflit apparaît sur un de ces 3 fichiers, vérifier s'il contient encore
`plugins: [react()]` et appliquer ce pattern **avant** de lancer les tests.

## Piège n°4 — worktree déjà utilisé

Si `git checkout <branche>` échoue avec `'<branche>' is already used by worktree
at '<chemin>'`, ne PAS forcer. Vérifier `git worktree list` et `ps aux | grep hermes`
(si aucun process actif hors gateway/dashboard, c'est un reliquat sûr à réutiliser :
`cd <chemin-du-worktree>` et travailler directement dedans). Si `gh pr merge --delete-branch`
échoue avec une erreur similaire après un merge réussi, le merge a quand même
fonctionné — vérifier avec `gh pr view <N> --json state,mergedAt` puis nettoyer
manuellement (`git worktree remove`, `git branch -d`, `git push origin --delete`).

## Piège n°5 — perte d'ancêtre après un squash-merge (PR empilées)

Quand une PR B est forkée d'une branche A, et que A est ensuite squash-mergée dans
`master`, B perd tout ancêtre commun avec `master` sur les fichiers que A avait déjà
modifiés. Résultat : un `git merge origin/master` sur B marque **tous** ces fichiers
en conflit `add/add`, même s'il n'y a aucune vraie divergence de contenu — B contient
juste (contenu de A déjà sur master) + (le vrai apport de B par-dessus).

**Ne pas paniquer sur un `add/add` massif.** Differ chaque fichier à la main
(`git diff HEAD:<f> origin/master:<f>`) : si le contenu de la branche = contenu de
master + des ajouts propres (nouvelles fonctions, nouveaux index, etc.), c'est un
sur-ensemble strict → garder `--ours` (branche) sans hésiter. Déjà rencontré sur
BE-001b (#41) empilée sur BE-001a (#40), et BE-001c (#42) empilée sur #41.

## Piège n°6 — `tsconfig.json` `rootDir` peut casser le build silencieusement

Un changement de `rootDir` (ex: `"."` → `"../../.."`) peut passer le `tsc --noEmit`
(typecheck) sans erreur, alors qu'il casse le chemin d'émission réel au `build`
(`tsc` sans `--noEmit`) — le typecheck ne suffit donc pas à détecter ce genre de
régression. Si un conflit touche `rootDir`, vérifier :
1. Est-ce que le code actuel a besoin de cet élargissement (import cross-package type
   `@shared/*`) ? Si non, garder la version de `master`.
2. Lancer un vrai `pnpm build` (pas juste `typecheck`) pour confirmer que le chemin
   d'émission correspond au `"main"` déclaré dans `package.json`.

**Bug préexistant connu, non corrigé délibérément** : sur `apps/services/api`,
`package.json` dit `"main": "dist/index.js"` mais `tsc` avec `rootDir: "."` émet en
réalité vers `dist/src/index.js`. Présent depuis le premier commit de BE-001a, sur
`master`. Fix identifié (`"main": "dist/src/index.js"`) mais volontairement PAS
appliqué — noté sur la carte Kanban `t_f8a5c949` (commentaire #174). Ne pas le
corriger à l'improviste dans une autre PR ; c'est un suivi à part.

## Piège n°7 — `scan:test-data` / `scan-test-data.mjs` faux-positifs sur les ccTLD

Le scanner de données synthétiques (AR-4) détecte les domaines réels dans les
fixtures de test via un motif qui peut confondre un **accès de propriété** avec un
domaine, quand le nom de la propriété correspond à un ccTLD existant (ex: `fk.to` —
accès à `.to` sur un objet `fk`, faussement lu comme le TLD des Tonga ; même chose
pour `doc.info`, `.tv`, `.ai`, etc.). Rencontré sur plusieurs PR backend (#40, #41,
et propagé via `migration.test.ts`/`openapi.test.ts` sur #42-#44).

**Ne pas renommer les variables ni modifier le scanner sans validation humaine.**
Vérifier d'abord si c'est un vrai littéral de domaine dans une fixture (auquel cas
le corriger, comme pour `errors.test.ts` avec `example.com` → `example.test`) ou un
accès de propriété/syntaxe source normale confondu par le scanner (auquel cas :
laisser passer en rouge, documenter comme faux-positif connu dans la description de
la PR ou un commentaire de commit, ne pas bloquer le merge dessus). Si ça devient
fréquent sur la chaîne QA aussi, ce sera le signe qu'il faut une tâche dédiée pour
durcir la regex du scanner (mot-limite/exclusion des accès de propriété) — mais ça
reste une tâche séparée, jamais mêlée à une PR de fonctionnalité.

## Piège n°8 - 
Avant de supprimer une branche liée à un incident de sécurité, vérifier si son nom ou 
un hash de commit précis est cité dans les commentaires de clôture d'autres cartes déjà 
fermées (grep sur les commentaires Kanban). Une branche "morte pour sa propre tâche" 
peut rester la preuve vérifiable d'une autre tâche déjà close. 

## Piège n°9 — deux runs d'agents peuvent livrer le même scope sous deux task IDs différents

Constaté sur BE-001e (`t_143990ec`) et BE-001g (`t_f93d4d46`, cité via PR #50/#51) : les
deux cartes ont produit un `query.ts`/`query.test.ts` quasi identique (58 tests, ~500
lignes) de façon indépendante — le middleware de query params (BE-001e) et sa couverture
de tests unitaires (une partie de BE-001g) se recoupaient entièrement sans que ce soit
détecté avant dispatch. Un seul des deux runs a fini par atterrir sur `master` (PR #48) ;
l'autre task est restée marquée `done` en citant la mauvaise PR.

**À faire :** avant de dispatcher deux tâches backend adjacentes (ex. une tâche "middleware"
et une tâche "tests" sur le même sous-système), l'architecte doit vérifier explicitement
qu'elles ne se recouvrent pas en substance — pas seulement après coup quand une citation
kanban ne colle plus à la PR réelle.

## Piège n°10 — un écart de nombre de fichiers (pattern Piège n°5) doit être expliqué
## fichier par fichier AVANT le merge, pas après

Constaté sur PR #53 → #54 (BE-002a/BE-002b) : la PR d'origine (#53, branche stale
`feature/t_7918f010`) touchait 60 fichiers ; la PR de remplacement que j'ai créée (#54)
n'en touchait que 18. J'ai mergé #54 sur cette seule base — mon raisonnement de haut
niveau pendant la reconstruction ("les fichiers non repris sont soit identiques à
master, soit dépassés par master") était correct sur le fond, mais je ne l'avais pas
vérifié fichier par fichier avant de merger, seulement après coup quand l'utilisateur
a posé la question. Un diff systématique des 60 fichiers contre master a confirmé que
l'écart était légitime (fichiers strictement identiques, ou master en avance suite à
des fixes déjà mergés comme le mirroring `@shared/query` de BE-001e) — mais cette
vérification aurait dû faire partie du cycle de vérification standard, pas être faite
en réaction à une question de l'utilisateur après le merge.

**À faire :** quand une PR de remplacement (pattern Piège n°5 : ancêtre perdu après un
squash-merge) touche sensiblement moins de fichiers que la PR/branche d'origine qu'elle
remplace, faire un diff fichier par fichier de CHAQUE fichier de la branche d'origine
contre `master` actuel — au même niveau de priorité que typecheck/test/build — **avant**
de push et merger, pas après. Classer chaque fichier explicitement :
- identique à master → correctement exclu ;
- master plus récent/complet (fix déjà mergé, meilleure version) → correctement exclu,
  mais noter POURQUOI (quel PR/commit a apporté le fix) ;
- contenu unique de la branche non repris → à investiguer avant de merger, pas un
  écart de compte de fichiers qu'on explique après coup.
Un écart de nombre de fichiers, seul, n'est jamais une justification suffisante pour
merger — il doit être expliqué, fichier par fichier, avant.

## Point non résolu — à investiguer si le temps le permet

La tâche Kanban `t_df8e644a` est marquée `done` ("VERDICT_LOOSE_RE still parses a
cited file name as a verdict token... keeps t_80fc0326 red on a false positive")
mais n'a jamais été vérifiée dans la session précédente. Vérifier si un fix existe
réellement sur une branche/PR, comme cela a été le cas pour `t_c3cb6842` (où
l'annonce "done" était fausse — le fix n'avait jamais été committé).

## Après chaque PR mergée : refaire le diagnostic de couverture

Pour vérifier la progression et détecter d'éventuelles autres tâches "done" sans
PR (comme découvert pour BE-001a-f aujourd'hui) :

```bash
sqlite3 ~/.hermes/kanban.db "SELECT title FROM tasks WHERE status='done';" | \
  grep -oE '^[A-Z]+-[0-9]+[a-z]?' | sort -u > /tmp/codes.txt

git log origin/master --oneline > /tmp/master-commits.txt
git log --all --oneline > /tmp/all-commits.txt

while read code; do
  in_all=$(grep -c "$code" /tmp/all-commits.txt)
  in_master=$(grep -c "$code" /tmp/master-commits.txt)
  [ "$in_master" -eq 0 ] && [ "$in_all" -gt 0 ] && echo "⚠️  $code: code existe mais pas sur master"
  [ "$in_all" -eq 0 ] && echo "❌ $code: aucune trace nulle part"
done < /tmp/codes.txt
```

Et pour les tâches `done` sans code produit dans le titre (incidents, fixes de gate),
vérifier séparément qu'elles ne cachent pas du travail non mergé :
```bash
sqlite3 ~/.hermes/kanban.db "SELECT id, title FROM tasks WHERE status='done';" | \
  grep -vE '\|[A-Z]+-[0-9]+[a-z]?[: ]'
```

## Ce que tu ne dois jamais faire seul, sans repasser par l'humain

- Ne jamais modifier `kanban.db` directement sans backup préalable
  (`cp kanban.db kanban.db.bak-$(date +%s)`).
- Ne jamais coller, logger, ou committer une valeur de credential/token, même révoqué —
  fingerprint SHA256 uniquement.
- Ne jamais réécrire l'historique git de `master` (force-push) sans confirmation explicite.
- Si un conflit touche de la vraie logique métier (pas un des 4 fichiers mécaniques,
  pas une config vitest connue), t'arrêter et résumer la situation plutôt que de
  trancher seul.
