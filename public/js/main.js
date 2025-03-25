document.addEventListener('DOMContentLoaded', function() {
    const fileInput = document.getElementById('emailFile');
    const dropZone = document.getElementById('dropZone');
    const selectedFileName = document.getElementById('selectedFileName');
    const emailForm = document.getElementById('emailForm');
    const submitButton = document.getElementById('submitButton');
    const loadingSpinner = document.getElementById('loadingSpinner');
    
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
        emailForm.addEventListener('submit', function(e) {
            if (fileInput && fileInput.files.length === 0) {
                e.preventDefault();
                
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
            
            // Afficher le spinner de chargement
            if (loadingSpinner) {
                loadingSpinner.style.display = 'flex';
            }
            
            // Modifier le bouton de soumission
            if (submitButton) {
                const buttonText = submitButton.querySelector('span');
                if (buttonText) {
                    buttonText.textContent = 'Traitement en cours...';
                }
                
                submitButton.disabled = true;
                
                // Remplacer l'icône par un spinner
                const icon = submitButton.querySelector('i');
                if (icon) {
                    icon.classList.remove('bi-check2-circle');
                    icon.classList.add('bi-arrow-repeat', 'spin');
                } else {
                    // Ajouter un spinner s'il n'y a pas d'icône
                    const spinner = document.createElement('span');
                    spinner.className = 'spinner-border spinner-border-sm me-2';
                    spinner.setAttribute('role', 'status');
                    submitButton.prepend(spinner);
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