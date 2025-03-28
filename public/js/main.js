document.addEventListener('DOMContentLoaded', function() {
    const fileInput = document.getElementById('emailFile');
    const dropZone = document.getElementById('dropZone');
    const selectedFileName = document.getElementById('selectedFileName');
    const emailForm = document.getElementById('emailForm');
    const submitButton = document.getElementById('submitButton');
    const loadingSpinner = document.getElementById('loadingSpinner');
    const progressBar = document.getElementById('verificationProgress');
    const progressDetails = document.getElementById('progressDetails');
    
    // Fonction pour mettre à jour l'affichage du nom de fichier
    function updateFileName(file) {
        if (file) {
            const fileSize = (file.size / 1024).toFixed(2);
            let fileUnit = 'KB';
            let displaySize = fileSize;
            
            if (fileSize > 1024) {
                displaySize = (fileSize / 1024).toFixed(2);
                fileUnit = 'MB';
            }
            
            selectedFileName.innerHTML = `
                <div class="d-flex align-items-center">
                    <i class="bi bi-file-earmark-text me-2 text-primary"></i>
                    <div class="flex-grow-1 text-truncate">
                        <strong>${file.name}</strong>
                    </div>
                    <span class="badge bg-light text-muted ms-2">${displaySize} ${fileUnit}</span>
                </div>
            `;
            selectedFileName.classList.add('mt-3', 'p-2', 'border', 'rounded', 'bg-light');
            
            // Mise à jour du style de la zone de dépôt
            dropZone.querySelector('.drop-text').textContent = 'Fichier sélectionné';
            dropZone.classList.add('border-success');
            dropZone.querySelector('.upload-icon i').classList.remove('bi-cloud-arrow-up-fill');
            dropZone.querySelector('.upload-icon i').classList.add('bi-file-earmark-check-fill', 'text-success');
            
            // Animer le bouton de soumission pour attirer l'attention
            submitButton.classList.add('animate__animated', 'animate__pulse');
            setTimeout(() => {
                submitButton.classList.remove('animate__animated', 'animate__pulse');
            }, 1000);
        } else {
            selectedFileName.innerHTML = '';
            selectedFileName.classList.remove('mt-3', 'p-2', 'border', 'rounded', 'bg-light');
            
            // Réinitialiser la zone de dépôt
            dropZone.querySelector('.drop-text').textContent = 'Glissez votre fichier ici';
            dropZone.classList.remove('border-success');
            dropZone.querySelector('.upload-icon i').classList.add('bi-cloud-arrow-up-fill');
            dropZone.querySelector('.upload-icon i').classList.remove('bi-file-earmark-check-fill', 'text-success');
        }
    }
    
    // Gestion des événements de la zone de dépôt
    if (dropZone && fileInput) {
        // Rendre la zone de dépôt interactive
        dropZone.addEventListener('click', () => fileInput.click());
        
        // Événements de glisser-déposer
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.add('dragover');
            });
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.remove('dragover');
            });
        });
        
        // Déposer un fichier
        dropZone.addEventListener('drop', (e) => {
            if (e.dataTransfer.files.length) {
                fileInput.files = e.dataTransfer.files;
                updateFileName(e.dataTransfer.files[0]);
            }
        });
        
        // Changer un fichier via l'input standard
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length) {
                updateFileName(fileInput.files[0]);
            } else {
                updateFileName(null);
            }
        });
    }
    
    // Gestion de la soumission du formulaire
    if (emailForm) {
        emailForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            if (fileInput && fileInput.files.length === 0) {
                // Animation d'erreur de la zone de dépôt
                dropZone.classList.add('border-danger');
                setTimeout(() => dropZone.classList.remove('border-danger'), 2000);
                
                // Afficher un message d'erreur
                selectedFileName.innerHTML = `
                    <div class="alert alert-danger py-2 mb-0">
                        <i class="bi bi-exclamation-triangle-fill me-2"></i>
                        Veuillez sélectionner un fichier à analyser.
                    </div>
                `;
                selectedFileName.classList.add('mt-3');
                
                return false;
            }

            // Afficher la barre de progression
            if (loadingSpinner) {
                loadingSpinner.style.display = 'flex';
                // Réinitialiser la barre de progression
                if (progressBar) {
                    progressBar.style.width = '0%';
                    progressBar.setAttribute('aria-valuenow', 0);
                    progressBar.textContent = '0%';
                }
                if (progressDetails) {
                    progressDetails.textContent = 'Démarrage de la vérification...';
                }
            }
            
            // Modifier le bouton de soumission
            if (submitButton) {
                const buttonText = submitButton.querySelector('span');
                if (buttonText) {
                    buttonText.textContent = 'Traitement en cours...';
                }
                submitButton.disabled = true;
            }

            // Créer les données du formulaire
            const formData = new FormData(emailForm);

            try {
                // Envoyer le formulaire
                const response = await fetch(emailForm.action, {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Erreur lors de l\'envoi du fichier');
                }

                const data = await response.json();
                if (data.error) {
                    throw new Error(data.error);
                }

                // Démarrer la vérification de progression
                if (data.sessionId) {
                    let completed = false;
                    let redirectAttempted = false;

                    const checkProgress = async () => {
                        if (completed) return;

                        try {
                            const progressResponse = await fetch(`/progress/${data.sessionId}`);
                            if (!progressResponse.ok) {
                                throw new Error('Erreur lors de la récupération de la progression');
                            }

                            const progressData = await progressResponse.json();
                            console.log('Progress data:', progressData); // Debug log
                            
                            if (progressBar) {
                                progressBar.style.width = `${progressData.progress}%`;
                                progressBar.setAttribute('aria-valuenow', progressData.progress);
                                progressBar.textContent = `${progressData.progress}%`;
                            }
                            if (progressDetails) {
                                progressDetails.textContent = `${progressData.processed} sur ${progressData.total} emails vérifiés`;
                            }

                            // Vérifier s'il y a une erreur
                            if (progressData.error) {
                                throw new Error(progressData.error);
                            }

                            // Vérifier s'il y a une redirection
                            if (progressData.redirect && !redirectAttempted) {
                                redirectAttempted = true;
                                completed = true;
                                console.log('Redirection URL trouvée:', progressData.redirect);
                                
                                // Ajouter un délai avant la redirection
                                setTimeout(() => {
                                    console.log('Exécution de la redirection vers:', progressData.redirect);
                                    window.location.href = progressData.redirect;
                                }, 500);
                                return;
                            }

                            // Continuer la vérification
                            if (!completed) {
                                if (progressData.progress < 100) {
                                    setTimeout(checkProgress, 1000);
                                } else if (!redirectAttempted) {
                                    console.log('100% atteint, attente de l\'URL de redirection...');
                                    setTimeout(checkProgress, 500);
                                }
                            }
                        } catch (error) {
                            console.error('Erreur lors de la vérification de la progression:', error);
                            if (progressDetails) {
                                progressDetails.textContent = error.message;
                            }
                            completed = true;
                            // Réactiver le bouton en cas d'erreur
                            if (submitButton) {
                                const buttonText = submitButton.querySelector('span');
                                if (buttonText) {
                                    buttonText.textContent = 'Vérifier les emails';
                                }
                                submitButton.disabled = false;
                            }
                        }
                    };

                    // Démarrer la vérification de progression
                    checkProgress();
                }
            } catch (error) {
                console.error('Erreur:', error);
                if (progressDetails) {
                    progressDetails.textContent = error.message;
                }
                if (submitButton) {
                    const buttonText = submitButton.querySelector('span');
                    if (buttonText) {
                        buttonText.textContent = 'Vérifier les emails';
                    }
                    submitButton.disabled = false;
                }
            }
        });
    }
    
    // Animation pour l'icône de rotation
    document.head.insertAdjacentHTML('beforeend', `
        <style>
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            .spin {
                animation: spin 1.5s linear infinite;
                display: inline-block;
            }
        </style>
    `);
    
    // Initialisation des popovers
    const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
    if (popoverTriggerList.length) {
        popoverTriggerList.map(function (popoverTriggerEl) {
            return new bootstrap.Popover(popoverTriggerEl, {
                html: true,
                delay: { show: 100, hide: 300 },
                trigger: 'hover'
            });
        });
    }
    
    // Fonction de recherche dans les résultats
    const searchEmailInput = document.getElementById('searchEmail');
    if (searchEmailInput) {
        searchEmailInput.addEventListener('keyup', function() {
            const searchValue = this.value.toLowerCase();
            const tableRows = document.querySelectorAll('tbody tr');
            
            tableRows.forEach(row => {
                const emailCell = row.querySelector('td:first-child');
                const email = emailCell.textContent.toLowerCase();
                
                if (email.includes(searchValue)) {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            });
        });
    }
    
    // Fonction d'export CSV
    const exportCsvButton = document.getElementById('exportCsv');
    if (exportCsvButton) {
        exportCsvButton.addEventListener('click', function() {
            // La fonction d'export est définie dans la vue results.ejs
            if (typeof exportResults === 'function') {
                exportResults();
            }
        });
    }
    
    // Ajuster les largeurs des barres de progression (page de résultats)
    const progressBars = {
        valid: document.querySelector('.progress-bar.bg-success'),
        invalid: document.querySelector('.progress-bar.bg-danger'),
        disposable: document.querySelector('.progress-bar.bg-warning'),
        probablyInvalid: document.querySelector('.progress-bar.bg-orange')
    };
    
    // Si nous sommes sur la page de résultats, animer les barres de progression
    if (progressBars.valid) {
        // Les valeurs sont définies dans le HTML via des data-attributes
        setTimeout(() => {
            Object.keys(progressBars).forEach(key => {
                const bar = progressBars[key];
                if (bar) {
                    const width = bar.getAttribute('data-percent') || '0';
                    bar.style.width = width + '%';
                }
            });
        }, 300);
    }
}); 