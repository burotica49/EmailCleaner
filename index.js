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
const cookieParser = require('cookie-parser');
const winston = require('winston');

// Configuration du logger
const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `${timestamp} ${level}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.File({ 
            filename: 'email-verification.log',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Lire la version depuis package.json
const packageJson = require('./package.json');
const appVersion = packageJson.version;

const app = express();
const port = process.env.PORT || 8883;

// Map pour stocker les progressions
const progressMap = new Map();

// Map pour stocker les résultats temporaires
const resultsMap = new Map();

// Configuration
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(cookieParser());
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
  res.render('index', { version: appVersion });
});

// Route pour obtenir la progression
app.get('/progress/:sessionId', (req, res) => {
    const progress = progressMap.get(req.params.sessionId) || { progress: 0, processed: 0, total: 0 };
    res.json(progress);
});

// Route pour afficher les résultats
app.get('/results', (req, res) => {
    try {
        const resultsData = req.cookies.emailResults;
        if (!resultsData) {
            return res.redirect('/');
        }

        const { results, stats } = JSON.parse(resultsData);
        
        // Nettoyer le cookie après récupération des données
        res.clearCookie('emailResults');
        
        res.render('results', { results, stats, version: appVersion });
    } catch (error) {
        console.error('Erreur lors de la lecture des résultats:', error);
        res.redirect('/');
    }
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
    logger.error('Erreur lors de l\'extraction des emails:', error);
    throw error;
  }
}

// Fonction pour vérifier un email
async function verifyEmail(email) {
  try {
    logger.info(`\nVérification de l'email: ${email}`);
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
    logger.debug('- Vérification de la syntaxe...');
    const syntaxValid = validator.isEmail(email, {
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
    });

    if (!syntaxValid) {
      logger.debug('  → Syntaxe invalide');
      result.messages.push('Syntaxe d\'email invalide');
      return result;
    }
    
    logger.debug('  → Syntaxe valide');
    result.syntax = true;

    // Vérification du domaine disposable
    const disposableDomains = [
      'mailinator.com', 'yopmail.com', 'tempmail.com', 'guerrillamail.com',
      'temp-mail.org', '10minutemail.com', 'throwawaymail.com', 'trashmail.com'
    ];
    
    const domain = email.split('@')[1];
    logger.debug(`- Vérification du domaine: ${domain}`);
    if (disposableDomains.includes(domain)) {
      logger.debug('  → Domaine jetable détecté');
      result.disposable = true;
      result.messages.push('Email jetable détecté');
    }

    // Vérification des enregistrements MX
    logger.debug('- Vérification des enregistrements MX...');
    let mxValid = false;
    try {
      const mxRecords = await dnsPromises.resolveMx(domain);
      if (mxRecords && mxRecords.length > 0) {
        logger.debug(`  → ${mxRecords.length} enregistrements MX trouvés`);
        logger.debug('  → Serveurs MX: ' + mxRecords.map(r => r.exchange).join(', '));
        result.mx = true;
        mxValid = true;
      } else {
        logger.debug('  → Aucun enregistrement MX trouvé');
        result.messages.push('Aucun enregistrement MX trouvé pour le domaine');
      }
    } catch (error) {
      logger.error(`  → Erreur DNS: ${error.message}`);
      result.messages.push('Erreur DNS: ' + error.message);
    }

    // Vérification plus approfondie
    logger.debug('- Vérification approfondie...');
    let deepVerificationSucceeded = false;
    try {
      const emailValidator = new EmailValidator({
        verifyDomain: true,
        verifyMailbox: true,
        timeout: 10000,
        smtpTimeout: 10000,
        dnsTimeout: 5000,
        maxConnections: 5,
        port: 587,
        verifyMailbox: true,
        secure: false,
        requireTLS: true
      });

      // logger.debug('Configuration email-validator:', {
      //   timeout: 10000,
      //   smtpTimeout: 10000,
      //   dnsTimeout: 5000,
      //   maxConnections: 5,
      //   port: 587,
      //   verifyMailbox: true,
      //   secure: false,
      //   requireTLS: true
      // });

      const { validDomain, validMailbox } = await emailValidator.verify(email);
      logger.debug(`  → Domaine valide: ${validDomain}`);
      logger.debug(`  → Boîte mail valide: ${validMailbox}`);
      logger.debug(`  → Type de retour validMailbox: ${typeof validMailbox}`);

      if (validDomain) {
        result.mx = true;
        mxValid = true;
      }
      
      if (validMailbox === true) {
        // Boîte mail explicitement valide
        deepVerificationSucceeded = true;
        result.probablyInvalid = false;
      } else if (validMailbox === false) {
        // Boîte mail explicitement invalide
        result.probablyInvalid = true;
        result.messages.push('Boîte mail probablement invalide');
      } else if (validMailbox === null) {
        // Vérification impossible (timeout, blocage, etc.)
        logger.debug('  → Vérification approfondie impossible');
        // On ne modifie pas probablyInvalid, on se base sur les autres critères
      }

    } catch (error) {
      logger.error(`  → Erreur vérification approfondie: ${error.message}`);
      result.messages.push('Vérification approfondie échouée: ' + error.message);
    }

    // Vérifier si un message contient "Boîte mail probablement invalide"
    if (result.messages.some(msg => msg.includes('Boîte mail probablement invalide'))) {
      result.probablyInvalid = true;
    }

    // Déterminer la validité globale
    if (result.syntax && mxValid && !result.disposable && !result.probablyInvalid) {
      result.isValid = true;
    }
    
    if (deepVerificationSucceeded) {
      result.isValid = true;
      result.probablyInvalid = false;
    }

    logger.info('- Résultat final:', {
      isValid: result.isValid,
      syntax: result.syntax,
      mx: result.mx,
      disposable: result.disposable,
      probablyInvalid: result.probablyInvalid,
      messages: result.messages
    });

    return result;
  } catch (error) {
    logger.error('Erreur lors de la vérification de l\'email:', error);
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
        return res.status(400).json({ error: 'Aucun fichier n\'a été téléchargé.' });
    }

    const sessionId = Date.now().toString();
    progressMap.set(sessionId, { progress: 0, processed: 0, total: 0 });

    try {
        const emails = await extractEmails(req.file.path);
        
        if (emails.length === 0) {
            progressMap.delete(sessionId);
            return res.status(400).json({ error: 'Aucune adresse email valide n\'a été trouvée dans le fichier.' });
        }

        logger.info(`Session ${sessionId}: ${emails.length} emails trouvés`);

        // Envoyer l'ID de session immédiatement
        res.json({ sessionId });

        // Limiter le nombre d'emails pour la démo
        const maxEmails = 5000;
        const emailsToVerify = emails.slice(0, maxEmails);
        
        // Mettre à jour le total immédiatement
        progressMap.set(sessionId, { progress: 0, processed: 0, total: emailsToVerify.length });

        // Créer une promesse pour le traitement des emails
        const processEmails = async () => {
            try {
                const results = [];
                let processedCount = 0;
                
                for (const email of emailsToVerify) {
                    const result = await verifyEmail(email);
                    results.push(result);
                    processedCount++;
                    
                    // Mettre à jour la progression
                    const progress = Math.round((processedCount / emailsToVerify.length) * 100);
                    progressMap.set(sessionId, { 
                        progress, 
                        processed: processedCount, 
                        total: emailsToVerify.length 
                    });
                    
                    // Ajouter un délai de 100ms entre chaque vérification
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

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

                logger.info(`Session ${sessionId}: Traitement terminé`, stats);

                // Nettoyer le fichier après traitement
                await fs.unlink(req.file.path);

                // Stocker les résultats dans la Map
                resultsMap.set(sessionId, { results, stats });

                // Mettre à jour la progression avec l'URL de redirection
                progressMap.set(sessionId, { 
                    progress: 100, 
                    processed: emailsToVerify.length, 
                    total: emailsToVerify.length,
                    redirect: `/complete/${sessionId}`
                });

                // Définir un timeout pour nettoyer les données
                setTimeout(() => {
                    resultsMap.delete(sessionId);
                    progressMap.delete(sessionId);
                }, 3600000); // 1 heure

            } catch (error) {
                logger.error(`Session ${sessionId}: Erreur lors du traitement des emails:`, error);
                progressMap.set(sessionId, { 
                    progress: 100,
                    processed: emailsToVerify.length,
                    total: emailsToVerify.length,
                    error: 'Erreur lors du traitement du fichier: ' + error.message 
                });
            }
        };

        // Démarrer le traitement en arrière-plan
        processEmails();

    } catch (error) {
        logger.error('Erreur lors du traitement du fichier:', error);
        progressMap.delete(sessionId);
        res.status(500).json({ 
            error: 'Erreur lors du traitement du fichier: ' + error.message 
        });
    }
});

// Route pour la complétion du traitement
app.get('/complete/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    const resultsData = resultsMap.get(sessionId);

    if (!resultsData) {
        logger.warn('Aucun résultat trouvé pour la session:', sessionId);
        return res.redirect('/');
    }

    logger.info('Résultats trouvés pour la session:', sessionId);
    const { results, stats } = resultsData;

    // Définir le cookie avec les résultats
    res.cookie('emailResults', JSON.stringify({ results, stats }), {
        maxAge: 3600000, // 1 heure
        httpOnly: true,
        sameSite: 'strict',
        path: '/'
    });

    // Nettoyer les données
    resultsMap.delete(sessionId);
    progressMap.delete(sessionId);

    // Rediriger vers la page de résultats
    res.redirect('/results');
});

// Démarrer le serveur
app.listen(port, () => {
    logger.info(`Serveur démarré sur http://localhost:${port}`);
}); 