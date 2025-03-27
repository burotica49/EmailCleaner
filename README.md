# Nettoyeur de Liste d'Emails

Application web pour nettoyer et valider des listes d'emails à partir de fichiers TXT, CSV ou XLSX. Cette application vérifie la validité de chaque adresse email et génère un rapport détaillé, semblable à celui fourni par usebouncer.com.

## Fonctionnalités

- Importation de listes d'emails à partir de fichiers TXT, CSV ou XLSX
- Validation de la syntaxe des adresses email
- Vérification des enregistrements MX des domaines
- Détection des adresses email jetables
- Génération de rapports détaillés avec statistiques
- Exportation des résultats au format CSV
- Interface utilisateur intuitive et responsive

## Installation

### Prérequis

- Node.js (v14 ou supérieur)
- npm (v6 ou supérieur)

### Étapes d'installation

1. Clonez ce dépôt :
   ```
   git clone https://github.com/burotica49/EmailCleaner.git
   cd EmailCleaner
   ```

2. Installez les dépendances :
   ```
   npm install
   ```

3. Démarrez l'application :
   ```
   node index.js
   ```

4. Accédez à l'application via votre navigateur à l'adresse :
   ```
   http://localhost:8882
   ```

5. Utilisation de PM2 pour un démarrage automatique (Facultatif)
   ```
   npm install -g pm2
   pm2 start index.js --name EmailCleaner
   pm2 startup
   pm2 save
   ```

## Utilisation

1. Sur la page d'accueil, téléchargez votre fichier d'emails (.txt, .xlsx ou .csv).
2. Cliquez sur le bouton "Vérifier les emails".
3. Attendez que le traitement soit terminé.
4. Consultez le rapport détaillé qui affiche :
   - Statistiques globales
   - Liste des emails avec leur statut
   - Détails de vérification pour chaque email
5. Exportez les résultats au format CSV si nécessaire.

## Structure des fichiers d'entrée

- **Fichiers TXT** : Une adresse email par ligne.
- **Fichiers CSV** : Les adresses email peuvent être dans n'importe quelle colonne.
- **Fichiers XLSX** : Les adresses email peuvent être dans n'importe quelle cellule.

## Limites

- Pour des raisons de performance, le nombre d'emails traités est limité à 5000.
- La vérification approfondie des boîtes mail peut être limitée par les restrictions des serveurs de messagerie.

## Licence

- Développement réalisé par la société Burotica 
- Licence Open Source

---

Créé avec ❤️ pour faciliter le nettoyage de vos listes de diffusion email. 
