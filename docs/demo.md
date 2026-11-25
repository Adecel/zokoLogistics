# Version de démonstration en ligne

Chaque `git push` sur la branche `main` met à jour automatiquement la démo :

- Application client : https://zoko.expo.app
- Tableau de bord : https://zoko.expo.app/admin/login

La construction se fait sur les serveurs de GitHub (fichier
[`.github/workflows/deploy-demo.yml`](../.github/workflows/deploy-demo.yml)), puis le site est
publié gratuitement sur Expo Hosting.

## Mise en place (une seule fois)

### 1. Compte Expo et lien du projet

Dans un terminal, dans le dossier du projet :

```bash
npx eas-cli login          # compte gratuit sur https://expo.dev
npx eas-cli init           # relie le projet à Expo : ajoute "projectId" dans app.json
```

Puis choisissez le nom de la démo (le sous-domaine, **définitif**) :
sur https://expo.dev → votre projet → **Hosting** → choisir le nom (ex. `zoko-demo`).

Committez et poussez la modification de `app.json` :

```bash
git add app.json
git commit -m "Relier le projet à Expo"
```

### 2. Jeton Expo

Sur https://expo.dev/settings/access-tokens → **Create token** → copiez-le.

### 3. Secret GitHub (un seul)

Sur GitHub : dépôt **zokoLogistics** → **Settings** → **Secrets and variables** → **Actions** →
**New repository secret** :

| Nom | Valeur |
|---|---|
| `EXPO_TOKEN` | le jeton de l'étape 2 |

L'adresse Supabase et la clé publishable sont écrites dans
[`.github/workflows/deploy-demo.yml`](../.github/workflows/deploy-demo.yml) : ce ne sont pas des
secrets (elles sont de toute façon visibles dans le site publié ; les données sont protégées par les
règles RLS). Pour utiliser un autre projet Supabase, créez des secrets `EXPO_PUBLIC_SUPABASE_URL` et
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` : ils remplacent ces valeurs.

Ne mettez jamais dans le code la clé *secret* / *service_role* de Supabase, ni le jeton Expo.

### 4. Supabase : adresse de la démo

La démo utilise le même projet Supabase que votre `.env.local`.
Pour que les liens envoyés par e-mail (confirmation de compte) ramènent vers la démo :

Supabase → **Authentication** → **URL Configuration** :

- **Site URL** : `https://zoko.expo.app`
- **Redirect URLs** : ajoutez `https://zoko.expo.app/**`

Les migrations de `supabase/migrations/` doivent être exécutées dans le SQL Editor
(le déploiement affiche un avertissement s'il en manque une).

### 5. Premier déploiement

Poussez sur `main` (`git push`), ou lancez-le à la main : onglet **Actions** → **Deploy demo** →
**Run workflow**. Comptez quelques minutes. Le lien apparaît à la fin de l'étape
« Publish to Expo Hosting », et sur https://expo.dev → votre projet → Hosting.

## À savoir

- **Base de données réelle** : la démo utilise votre projet Supabase. Les réservations et comptes
  créés par les testeurs apparaissent dans le tableau de bord.
- **Accès au tableau de bord** pour un testeur : il fait « Demander un accès » sur
  `/admin/register`, puis un admin l'accepte dans **Équipe**.
- **Si un déploiement échoue** : onglet **Actions** sur GitHub → cliquez sur l'exécution en rouge →
  le message d'erreur indique l'étape (secret manquant, erreur de code…).
- **Limites du plan gratuit Expo Hosting** : largement suffisantes pour une démo
  (100 000 requêtes par mois).
- **iPhone** : la démo web s'ouvre dans Safari. Une app iPhone installable demande un compte
  Apple Developer payant.
