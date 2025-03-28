const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const xlsx = require('xlsx');
const validator = require('validator');
const emailValidator = require('deep-email-validator');
const dns = require('dns');
const util = require('util');
const dnsPromises = dns.promises;
const cookieParser = require('cookie-parser');
const winston = require('winston');

// Configuration du logger
// const logger = winston.createLogger({
//     level: 'debug',
//     format: winston.format.combine(
//         winston.format.timestamp(),
//         winston.format.printf(({ timestamp, level, message }) => {
//             return `${timestamp} ${level}: ${message}`;
//         })
//     ),
//     transports: [
//         new winston.transports.File({ 
//             filename: 'email-verification.log',
//             maxsize: 5242880, // 5MB
//             maxFiles: 5,
//         }),
//         new winston.transports.Console({
//             format: winston.format.combine(
//                 winston.format.colorize(),
//                 winston.format.simple()
//             )
//         })
//     ]
// });

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

// Route pour afficher les résultats (uniquement pour compatibilité ou accès direct)
app.get('/results', (req, res) => {
    res.redirect('/');
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
    // logger.error('Erreur lors de l\'extraction des emails:', error);
    throw error;
  }
}

// Fonction pour vérifier un email
async function verifyEmail(email) {
  try {
    // logger.info(`\nVérification de l'email: ${email}`);
    
    const result = { 
      email, 
      isValid: false,
      isSuspect: false,
      isInvalid: false,
      syntax: false, 
      mx: false, 
      disposable: false, 
      typo: false,
      smtpStatus: null,
      messages: [] 
    };

    // Vérification de la syntaxe
    // logger.debug('- Vérification de la syntaxe...');
    const syntaxValid = validator.isEmail(email, {
      allow_display_name: false,
      require_display_name: false, 
      allow_utf8_local_part: false, 
      require_tld: true,
      ignore_max_length: false,
      allow_ip_domain: false, 
      allow_underscores: false, 
      domain_specific_validation: true, 
      blacklisted_chars: '', 
      host_blacklist: []
    });

    if (!syntaxValid) {
      // logger.debug('  → Syntaxe invalide');
      result.messages.push('Syntaxe d\'email invalide');
      result.isInvalid = true;
      return result;
    }
    
    // logger.debug('  → Syntaxe valide');
    result.syntax = true;

    // Utilisation de deep-email-validator pour une vérification complète
    // logger.debug('- Vérification approfondie avec deep-email-validator...');
    
    const validation = await emailValidator.validate({
      email: email,
      sender: email,
      validateRegex: true,
      validateMx: true,
      validateTypo: true,
      validateDisposable: true,
      validateSMTP: true
    });

    // logger.debug('- Résultats de la validation approfondie:');
    // logger.debug(JSON.stringify(validation, null, 2));

    // Analyse des différentes vérifications
    if (validation.validators) {
      // Vérification regex
      if (validation.validators.regex) {
        result.syntax = validation.validators.regex.valid;
        if (!validation.validators.regex.valid) {
          result.messages.push('Format d\'email invalide');
          result.isInvalid = true;
        }
      }

      // Vérification MX
      if (validation.validators.mx) {
        result.mx = validation.validators.mx.valid;
        if (!validation.validators.mx.valid) {
          if (validation.validators.mx.reason) {
            result.messages.push('Erreur MX: ' + validation.validators.mx.reason);
          }
          result.isInvalid = true;
        }
      }
      
      // Vérification domaine jetable
      if (validation.validators.disposable) {
        result.disposable = !validation.validators.disposable.valid;
        if (!validation.validators.disposable.valid) {
          result.messages.push('Email jetable détecté');
          result.isSuspect = true;
        }
      }
      
      // Vérification SMTP
      if (validation.validators.smtp) {
        if (!validation.validators.smtp.valid) {
          const smtpReason = validation.validators.smtp.reason || '';
          
          // Classifier certaines erreurs SMTP comme suspectes
          if (smtpReason.includes('The mail transaction has failed for unknown causes') || 
              smtpReason.includes('Unrecognized SMTP response')) {
            result.isSuspect = true;
            result.smtpStatus = 'suspect';
          } 
          // Classifier d'autres erreurs SMTP comme invalides
          else if (smtpReason.includes('Mailbox not found') || 
                   smtpReason.includes('The mail address that you specified was not syntactically correct')) {
            result.isInvalid = true;
            result.smtpStatus = 'invalid';
          }
          // Pour toutes les autres erreurs SMTP, considérer comme suspect par défaut
          else {
            result.isSuspect = true;
            result.smtpStatus = 'suspect';
          }
          
          if (validation.validators.smtp.reason) {
            result.messages.push('Vérification SMTP: ' + validation.validators.smtp.reason);
          }
        } else {
          result.smtpStatus = 'valid';
        }
      }
      
      // Vérification des typos courantes
      if (validation.validators.typo) {
        result.typo = !validation.validators.typo.valid;
        if (!validation.validators.typo.valid) {
          result.messages.push('Possible typo détectée: ' + (validation.validators.typo.suggestion || ''));
          result.isSuspect = true;
        }
      }
    }

    // Détermination de la validité finale selon nos trois catégories
    if (!result.isInvalid && !result.isSuspect) {
      result.isValid = true;
    }

    // Logique de préséance: invalide > suspect > valide
    if (result.isInvalid) {
      result.isSuspect = false;
      result.isValid = false;
    } else if (result.isSuspect) {
      result.isValid = false;
    }

    // logger.info('- Résultat final:', {
    //   isValid: result.isValid,
    //   isSuspect: result.isSuspect,
    //   isInvalid: result.isInvalid,
    //   syntax: result.syntax,
    //   mx: result.mx,
    //   disposable: result.disposable,
    //   typo: result.typo,
    //   messages: result.messages
    // });

    return result;
  } catch (error) {
    // logger.error('Erreur lors de la vérification de l\'email:', error);
    return { 
      email, 
      isValid: false,
      isSuspect: false,
      isInvalid: true,
      syntax: false, 
      mx: false, 
      disposable: false,
      typo: false,
      smtpStatus: null,
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

        // logger.info(`Session ${sessionId}: ${emails.length} emails trouvés`);

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
                    suspect: results.filter(r => r.isSuspect).length,
                    invalid: results.filter(r => r.isInvalid).length,
                    disposable: results.filter(r => r.disposable).length,
                    syntaxErrors: results.filter(r => !r.syntax).length,
                    mxErrors: results.filter(r => !r.mx).length,
                    typoErrors: results.filter(r => r.typo).length
                };

                // logger.info(`Session ${sessionId}: Traitement terminé`, stats);

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
                // logger.error(`Session ${sessionId}: Erreur lors du traitement des emails:`, error);
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
        // logger.error('Erreur lors du traitement du fichier:', error);
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
        // logger.warn('Aucun résultat trouvé pour la session:', sessionId);
        return res.redirect('/');
    }

    // logger.info('Résultats trouvés pour la session:', sessionId);
    const { results, stats } = resultsData;

    // Rendre directement la page des résultats au lieu d'utiliser des cookies
    res.render('results', { results, stats, version: appVersion });
    
    // Nettoyer les données
    resultsMap.delete(sessionId);
    progressMap.delete(sessionId);
});

// Démarrer le serveur
app.listen(port, () => {
    // logger.info(`Serveur démarré sur http://localhost:${port}`);
}); 