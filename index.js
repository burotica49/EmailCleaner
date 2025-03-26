const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const xlsx = require('xlsx');
const validator = require('validator');
const EmailValidator = require('email-deep-validator');
const dns = require('dns');
const util = require('util');
const dnsPromises = dns.promises;

const app = express();
const port = process.env.PORT || 8883;

// Configuration
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Configuration de Multer pour les téléchargements de fichiers
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /txt|xlsx|csv/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname || mimetype) {
      return cb(null, true);
    } else {
      cb('Erreur: Seuls les fichiers .txt, .xlsx ou .csv sont autorisés!');
    }
  }
});

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

// Fonction pour extraire des emails d'un fichier
async function extractEmails(filePath) {
  try {
    const fileExt = path.extname(filePath).toLowerCase();
    let emails = [];

    if (fileExt === '.txt' || fileExt === '.csv') {
      const fileContent = await fs.readFile(filePath, 'utf8');
      const lines = fileContent.split(/\r?\n/);
      
      lines.forEach(line => {
        // Pour CSV on peut avoir plusieurs colonnes
        const parts = line.split(',');
        parts.forEach(part => {
          const trimmedPart = part.trim();
          if (validator.isEmail(trimmedPart)) {
            emails.push(trimmedPart);
          }
        });
      });
    } else if (fileExt === '.xlsx') {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
      
      data.forEach(row => {
        if (Array.isArray(row)) {
          row.forEach(cell => {
            if (typeof cell === 'string' && validator.isEmail(cell.trim())) {
              emails.push(cell.trim());
            }
          });
        }
      });
    }

    // Éliminer les doublons
    return [...new Set(emails)];
  } catch (error) {
    console.error('Erreur lors de l\'extraction des emails:', error);
    throw error;
  }
}

// Fonction pour vérifier un email
async function verifyEmail(email) {
  try {
    const emailValidator = new EmailValidator();
    const result = { 
      email, 
      isValid: false, 
      syntax: false, 
      mx: false, 
      disposable: false, 
      probablyInvalid: false, 
      messages: [] 
    };

    // Vérification de la syntaxe
    if (!validator.isEmail(email, {
      allow_display_name: false,
      require_display_name: false, 
      allow_utf8_local_part: true, 
      require_tld: true,
      ignore_max_length: false,
      allow_ip_domain: false, 
      allow_underscores: false, 
      domain_specific_validation: true, 
      blacklisted_chars: '', 
      host_blacklist: []
    })) {
      result.messages.push('Syntaxe d\'email invalide');
      return result;
    }
    
    result.syntax = true;

    // Vérification du domaine disposable
    const disposableDomains = [
      'mailinator.com', 'yopmail.com', 'tempmail.com', 'guerrillamail.com',
      'temp-mail.org', '10minutemail.com', 'throwawaymail.com', 'trashmail.com'
    ];
    
    const domain = email.split('@')[1];
    if (disposableDomains.includes(domain)) {
      result.disposable = true;
      result.messages.push('Email jetable détecté');
    }

    // Vérification des enregistrements MX
    let mxValid = false;
    try {
      const mxRecords = await dnsPromises.resolveMx(domain);
      if (mxRecords && mxRecords.length > 0) {
        result.mx = true;
        mxValid = true;
      } else {
        result.messages.push('Aucun enregistrement MX trouvé pour le domaine');
      }
    } catch (error) {
      result.messages.push('Erreur DNS: ' + error.message);
    }

    // Vérification plus approfondie (optionnelle)
    let deepVerificationSucceeded = false;
    try {
      const { validDomain, validMailbox } = await emailValidator.verify(email);
      if (validDomain) {
        result.mx = true;
        mxValid = true;
      }
      
      if (validMailbox) {
        deepVerificationSucceeded = true;
      } else if (validMailbox === false) {
        // Seulement si validMailbox est explicitement false (pas undefined)
        result.probablyInvalid = true;
        result.messages.push('Boîte mail probablement invalide');
      }
    } catch (error) {
      // Ne pas considérer un échec de la vérification approfondie comme un critère d'invalidité
      result.messages.push('Vérification approfondie échouée: ' + error.message);
      // Nous continuons avec les autres critères
    }

    // Vérifier si un message contient "Boîte mail probablement invalide"
    if (result.messages.some(msg => msg.includes('Boîte mail probablement invalide'))) {
      result.probablyInvalid = true;
    }

    // Déterminer la validité globale
    // Un email est considéré valide s'il a une syntaxe correcte et des MX records valides
    // et qu'il n'est pas un email jetable et pas probablement invalide
    if (result.syntax && mxValid && !result.disposable && !result.probablyInvalid) {
      result.isValid = true;
    }
    
    // Si la vérification approfondie a réussi, cela renforce notre confiance
    if (deepVerificationSucceeded) {
      result.isValid = true;
      result.probablyInvalid = false; // Annuler le probablement invalide si vérification profonde ok
    }

    return result;
  } catch (error) {
    console.error('Erreur lors de la vérification de l\'email:', error);
    return { 
      email, 
      isValid: false, 
      syntax: false, 
      mx: false, 
      disposable: false, 
      probablyInvalid: false,
      messages: ['Erreur lors de la vérification: ' + error.message] 
    };
  }
}

// Route pour le traitement des fichiers
app.post('/verify', upload.single('emailFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('Aucun fichier n\'a été téléchargé.');
  }

  try {
    const emails = await extractEmails(req.file.path);
    
    if (emails.length === 0) {
      return res.status(400).send('Aucune adresse email valide n\'a été trouvée dans le fichier.');
    }

    // Limiter le nombre d'emails pour la démo (facultatif)
    const maxEmails = 5000;
    const emailsToVerify = emails.slice(0, maxEmails);
    
    // Vérifier les emails
    const verificationPromises = emailsToVerify.map(email => verifyEmail(email));
    const results = await Promise.all(verificationPromises);
    
    // Générer des statistiques
    const stats = {
      total: results.length,
      valid: results.filter(r => r.isValid).length,
      invalid: results.filter(r => !r.isValid).length,
      disposable: results.filter(r => r.disposable).length,
      probablyInvalid: results.filter(r => r.probablyInvalid).length,
      syntaxErrors: results.filter(r => !r.syntax).length,
      mxErrors: results.filter(r => !r.mx).length
    };

    // Nettoyer le fichier après traitement
    await fs.unlink(req.file.path);

    // Renvoyer les résultats et les statistiques
    res.render('results', { results, stats });
  } catch (error) {
    console.error('Erreur lors du traitement du fichier:', error);
    res.status(500).send('Erreur lors du traitement du fichier: ' + error.message);
  }
});

// Démarrer le serveur
app.listen(port, () => {
  console.log(`Serveur démarré sur http://localhost:${port}`);
}); 